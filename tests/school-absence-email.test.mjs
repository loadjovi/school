import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {runInNewContext} from "node:vm";

const moduleSource=readFileSync(new URL("../api/src/lib/schoolAbsenceMail.mjs",import.meta.url),"utf8");
const attendance=["sectionAttendance","ensembleAttendance","comprehensiveAttendance"].map(name=>readFileSync(new URL("../api/src/functions/"+name+".js",import.meta.url),"utf8"));
const schoolApi=readFileSync(new URL("../api/src/functions/schoolAccess.js",import.meta.url),"utf8");
const auditUi=readFileSync(new URL("../app/school-admin-activity.js",import.meta.url),"utf8");

function harness({lab=false,withRecipient=true,notificationsEnabled=true}={}){
 const data=new Map(),settings=new Map(),sent=[];
 const schoolId="sacred-heart";
 if(withRecipient)settings.set("SCHOOL|"+schoolId+"|schoolAccess",{emailsJson:JSON.stringify(["school@example.com"])});
 const FakeTableClient={fromConnectionString:(_,name)=>name==="SystemSettings"?{
  getEntity:async(p,k)=>{const x=settings.get(p+"|"+k);if(!x)throw {statusCode:404};return x}
 }:{
  createEntity:async row=>{const key=row.partitionKey+"|"+row.rowKey;if(data.has(key))throw {statusCode:409};data.set(key,row)},
  updateEntity:async row=>{const key=row.partitionKey+"|"+row.rowKey;data.set(key,{...data.get(key),...row})},
  async *listEntities({queryOptions}={}){const partition=String(queryOptions?.filter||"").split("'")[1];for(const item of data.values())if(!partition||item.partitionKey===partition)yield item}
 }};
 const FakeEmail=class{
  beginSend=async message=>{sent.push(message);return {pollUntilDone:async()=>({status:"Succeeded",id:"provider-1"})}}
 };
 const ctx={createHash,EmailClient:FakeEmail,TableClient:FakeTableClient,TableServiceClient:{fromConnectionString:()=>({createTable:async()=>{}})},
  tenantSchoolPartition:s=>s,defaultTenantId:()=>schoolId,getSystemSettings:async()=>({emailNotificationsEnabled:notificationsEnabled}),process:{env:{STORAGE_CONNECTION_STRING:"test-storage",ACS_EMAIL_CONNECTION_STRING:"test-email",ACS_EMAIL_SENDER:"robot@example.com",LAB_ENVIRONMENT:lab?"functional-uat":""}},
  console,Date,JSON,Set,Map,String,Number,Error,Promise,Array};
 const js=moduleSource.replace(/^import .+;$/gm,"").replace(/\bexport (async )?(function|const)\b/g,(_,asyncPart,kind)=>(asyncPart||"")+kind);
 const api=runInNewContext(js+";({dispatchSchoolAbsenceEmails,schoolAbsenceKey,schoolAbsenceMailContent,absenceNotificationCandidates,listSchoolAbsenceEmails})",ctx);
 return {api,data,sent,env:ctx.process.env};
}
const absent=(overrides={})=>({date:"2026-10-30",studentId:"1001",name:"虛構學生甲",status:"absent",classType:"section",groupName:"A",section:"小提一部",...overrides});

test("only actual group-class absences qualify, never leave or private lessons",()=>{
 const h=harness();
 const xs=h.api.absenceNotificationCandidates([absent(),absent(),absent({studentId:"2",status:"leave"}),absent({studentId:"3",classType:"privateLesson"})]);
 assert.equal(xs.length,1);assert.equal(xs[0].studentId,"1001");
 assert.match(h.api.schoolAbsenceMailContent({date:"2026-10-30",students:xs,appUrl:""}).plainText,/標記已知悉/);
});
test("one notification per recipient and student/course/date, repeated saves are silent",async()=>{
 const h=harness();
 const first=await h.api.dispatchSchoolAbsenceEmails({schoolId:"sacred-heart",date:"2026-10-30",items:[absent()]});
 assert.equal(first.sent,1);assert.equal(h.sent.length,1);
 const second=await h.api.dispatchSchoolAbsenceEmails({schoolId:"sacred-heart",date:"2026-10-30",items:[absent()]});
 assert.equal(second.sent,0);assert.equal(second.skipped,1);assert.equal(h.sent.length,1);
 assert.equal(h.data.size,1);
 const entries=await h.api.listSchoolAbsenceEmails("sacred-heart",{from:"2026-10-30",to:"2026-10-30"});
 assert.equal(entries[0].status,"sent");assert.equal(entries[0].recipient,"school@example.com");
});
test("new student is added to delivery history; tenant and lesson keys cannot collide",async()=>{
 const h=harness();
 await h.api.dispatchSchoolAbsenceEmails({schoolId:"sacred-heart",date:"2026-10-30",items:[absent()]});
 await h.api.dispatchSchoolAbsenceEmails({schoolId:"sacred-heart",date:"2026-10-30",items:[absent({studentId:"1002"})]});
 assert.equal(h.sent.length,2);
 assert.notEqual(h.api.schoolAbsenceKey(absent(),"staff@example.com"),h.api.schoolAbsenceKey(absent({classType:"ensemble"}),"staff@example.com"));
 const other=await h.api.listSchoolAbsenceEmails("other-school",{from:"2026-10-30",to:"2026-10-30"});
 assert.equal(other.length,0);
});
test("LAB is recorded as suppressed without sending real mail",async()=>{
 const h=harness({lab:true});
 const result=await h.api.dispatchSchoolAbsenceEmails({schoolId:"sacred-heart",date:"2026-10-30",items:[absent()]});
 assert.equal(result.sent,0);assert.equal(h.sent.length,0);
 const records=await h.api.listSchoolAbsenceEmails("sacred-heart",{from:"2026-10-30",to:"2026-10-30"});
 assert.equal(records[0].status,"lab_suppressed");
});
test("disabled school email notifications are recorded but do not send",async()=>{
 const h=harness({notificationsEnabled:false});
 await h.api.dispatchSchoolAbsenceEmails({schoolId:"sacred-heart",date:"2026-10-30",items:[absent()]});
 assert.equal(h.sent.length,0);
 const xs=await h.api.listSchoolAbsenceEmails("sacred-heart",{from:"2026-10-30",to:"2026-10-30"});
 assert.equal(xs[0].status,"disabled");
});
test("no recipients is recorded and does not invent a successful notification",async()=>{
 const h=harness({withRecipient:false});
 const result=await h.api.dispatchSchoolAbsenceEmails({schoolId:"sacred-heart",date:"2026-10-30",items:[absent()]});
 assert.equal(result.sent,0);assert.equal(h.sent.length,0);
 const records=await h.api.listSchoolAbsenceEmails("sacred-heart",{from:"2026-10-30",to:"2026-10-30"});
 assert.equal(records[0].status,"no_recipient");
});
test("three teaching attendance routes dispatch after writes, never before the saved record",()=>{
 for(const source of attendance){
  assert.match(source,/dispatchSchoolAbsenceEmails\(\{schoolId,date:sessionDate,items:newAbsences/);
  assert.match(source,/!oldRows\.some\(x=>x\.status==="absent"\)/);
  assert.match(source,/catch\(error\)\{console\.error\("school absence mail audit failed"/);
 }
});
test("admin-only query displays email delivery separately from acknowledgement",()=>{
 assert.match(schoolApi,/if\(a\.role!=="admin"\)return json\(\{error:"Forbidden"\},403\)/);
 assert.match(schoolApi,/listSchoolAbsenceEmails\(schoolId,\{from,to\}\)/);
 assert.match(schoolApi,/type:"school_absence_email"/);
 assert.match(auditUi,/school_absence_email:"學生缺席 Email 發送紀錄"/);
 assert.match(auditUi,/x\.recipient,x\.deliveryStatus/);
 assert.match(auditUi,/缺席通知寄出不代表學校已標記知悉/);
});
