import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson} from "../src/lib/musicLearningGoals.mjs";

const privateLessonSource=readFileSync(new URL("../src/functions/privateLesson.js",import.meta.url),"utf8");
const emailSource=readFileSync(new URL("../src/lib/email.js",import.meta.url),"utf8");

function privateLessonHarness({failNotificationAudit=false}={}){
  const handlers={},errors=[],sent=[];
  let updates=0;
  const initialEntity={
    partitionKey:"school-a|student|student-1",rowKey:"lesson-1",schoolId:"school-a",studentId:"student-1",sessionId:"student-1|lesson-1",
    eventDate:"2026-11-12",startTime:"10:00",endTime:"10:50",minutes:50,status:"scheduled",actualAttendanceStatus:"present",
    lessonContent:"音階",teacher:"teacher@example.org",teacherName:"測試老師",parentConfirmation:"not_required",
    emailNotificationType:"scheduled",emailNotificationStatus:"accepted",emailNotificationRecipients:1,emailNotificationAcceptedCount:1,emailNotificationSentCount:1,emailNotificationFailedCount:0,
    emailNotificationResendCount:0,emailNotificationLastResentAt:"",emailNotificationLastResentBy:"",createdAt:"2026-11-12T02:00:00Z",updatedAt:"2026-11-12T02:00:00Z"
  };
  const stored={...initialEntity};
  const client={
    getEntity:async()=>({...stored}),
    updateEntity:async patch=>{
      updates+=1;
      if(failNotificationAudit&&updates===2)throw new Error("notification audit storage unavailable");
      Object.assign(stored,patch);
    },
    createEntity:async()=>{}
  };
  const context={
    app:{http:(name,config)=>{handlers[name]=config.handler}},
    getTenantContext:async()=>({access:{role:"privateTeacher",email:"teacher@example.org",displayName:"測試老師",capabilities:{private:true}},schoolId:"school-a"}),
    ensurePrivateAccess:()=>true,ensureStudentAccess:()=>true,getStudentAliasInfo:async id=>({canonicalStudentId:id,aliases:[id]}),
    json:(body,status=200)=>({status,jsonBody:body}),ensureTenantTables:async()=>{},table:()=>client,rowKey:()=>"unused",listByStudent:async()=>[],
    getTeacherDirectory:async()=>({teacherName:"測試老師"}),listUserStudentMappings:async()=>[{parentEmail:"parent@example.org",studentId:"student-1"}],
    getStudentMaster:async()=>({studentName:"測試學生"}),getTenantDirectory:async()=>({timezone:"Asia/Taipei",systemName:"測試平台"}),
    tenantStudentPartition:(school,id)=>`${school}|student|${id}`,activityStudentId:row=>row.studentId,
    sendPrivateLessonWorkflowEmail:async options=>{sent.push(options);return {status:"accepted",recipientCount:1,acceptedCount:1,sentCount:0,failedCount:0}},
    getSystemSettings:async()=>({emailNotificationsEnabled:true}),normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson,
    process:{env:{}},console:{...console,error:(...args)=>errors.push(args)},Date,Intl,URL,JSON,Set,Map,String,Number,Error,Promise,Array,Object
  };
  const source=privateLessonSource.slice(privateLessonSource.indexOf("const attendanceStatuses=")).replace(/\bexport\s+/g,"");
  runInNewContext(source,context);
  const request=()=>({method:"PATCH",headers:{get:name=>name==="origin"?"https://example.test":null},json:async()=>({studentId:"student-1",lessonId:"lesson-1",action:"complete_lesson",lessonContent:"音階 D 大調",attendanceStatus:"present",weeklyPracticeGoals:[]})});
  return {handler:handlers.privateLesson,request,get entity(){return stored},sent,errors,get updates(){return updates}};
}

test("completed lesson remains successful when the notification audit write fails",async()=>{
  const h=privateLessonHarness({failNotificationAudit:true});
  const result=await h.handler(h.request());
  assert.equal(result.status,200);
  assert.equal(result.jsonBody.ok,true);
  assert.equal(result.jsonBody.notificationAuditPersisted,false);
  assert.equal(result.jsonBody.item.workflowStatus,"awaiting_parent");
  assert.equal(h.entity.status,"teacher_completed");
  assert.equal(h.entity.parentConfirmation,"pending");
  assert.equal(h.sent.length,1);
  assert.equal(h.errors.length,1);
});

test("retry after a partial completion is idempotent and never sends a duplicate email",async()=>{
  const h=privateLessonHarness({failNotificationAudit:true});
  await h.handler(h.request());
  const retry=await h.handler(h.request());
  assert.equal(retry.status,200);
  assert.equal(retry.jsonBody.ok,true);
  assert.equal(retry.jsonBody.alreadyCompleted,true);
  assert.equal(retry.jsonBody.item.workflowStatus,"awaiting_parent");
  assert.equal(retry.jsonBody.emailNotification.status,"unknown");
  assert.equal(h.sent.length,1);
});

test("private-lesson email returns after provider acceptance without polling for final delivery",async()=>{
  const queued=[];
  class FakeEmailClient{
    async beginSend(message){
      queued.push(message);
      return {getOperationState:()=>({status:"running"}),pollUntilDone:async()=>{throw new Error("must not poll")}};
    }
  }
  const context={EmailClient:FakeEmailClient,process:{env:{ACS_EMAIL_CONNECTION_STRING:"test",ACS_EMAIL_SENDER:"robot@example.org"}},console,URL,JSON,Set,String,Number,Error,Promise,Array,Object};
  const source=emailSource.slice(emailSource.indexOf("function clean(")).replace(/\bexport\s+/g,"");
  const api=runInNewContext(source+";({sendPrivateLessonWorkflowEmail})",context);
  const result=await api.sendPrivateLessonWorkflowEmail({recipients:["parent@example.org"],eventType:"completed",schoolName:"測試平台",studentName:"測試學生",teacherName:"測試老師",lessonDate:"2026-11-12",startTime:"10:00",endTime:"10:50",appUrl:"https://example.test/"});
  assert.equal(queued.length,1);
  assert.equal(result.status,"accepted");
  assert.equal(result.acceptedCount,1);
  assert.equal(result.sentCount,0);
  assert.equal(result.failedCount,0);
});
