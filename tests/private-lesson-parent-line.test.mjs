import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson} from "../api/src/lib/musicLearningGoals.mjs";
import {validateParentLessonReview} from "../api/src/lib/privateLessonReview.mjs";
import {buildPrivateLessonNoticeCard} from "../api/src/lib/privateLessonLineCards.mjs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const strip=source=>source.replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
function booking({emailEnabled=false,teacherEmail="teacher@example.invalid",parents=["mother@example.invalid","father@example.invalid"],unbound=[]}={}){
 const schoolId="school-a",messages=[],mail=[],staff=[],created=[];
 const client={async createEntity(entity){created.push({...entity})},async updateEntity(){},async getEntity(){}};
 const emailFormat=read("api/src/lib/email.js");
 const formatPrivateLessonNotice=runInNewContext(
  'const clean=(value,max=300)=>String(value??"").trim().slice(0,max),esc=value=>String(value);\n'+
  emailFormat.slice(emailFormat.indexOf("const privateLessonMailCopy="),emailFormat.indexOf("export async function sendPrivateLessonWorkflowEmail(")).replace(/^export /gm,"")+
  ";formatPrivateLessonNotice"
 );
 const recipients=new Map(parents.map((email,index)=>[email,unbound.includes(email)?null:{lineUserId:"U"+String(index+1).repeat(32)}]));
 const notifyPrivateLessonLine=runInNewContext(strip(read("api/src/lib/linePrivateLesson.js"))+";notifyPrivateLessonLine",{
  workflowLineEnabled:()=>true,workflowLineRetryKey:()=> "retry",buildPrivateLessonNoticeCard,
  process:{env:{LAB_ENVIRONMENT:"functional-uat"}},console,
  resolveTenantLineChannel:async school=>{assert.equal(school,schoolId);return {loginConfigured:true,botUserId:"school-bot",appOrigin:"https://school-a.example.invalid",accessToken:"test"}},
  getTenantLineRecipient:async(school,email,bot)=>{assert.equal(school,schoolId);assert.equal(bot,"school-bot");return recipients.get(email)},
  pushLineMessage:async(id,message)=>messages.push({id,message,text:typeof message==="string"?message:message.fallbackText})
 });
 let handler;
 runInNewContext(strip(read("api/src/functions/privateLesson.js")),{
  app:{http:(_,entry)=>{handler=entry.handler}},
  getTenantContext:async()=>({schoolId,access:{role:"privateTeacher",email:teacherEmail,capabilities:{private:true}}}),
  ensurePrivateAccess:()=>true,
  getStudentAliasInfo:async id=>({canonicalStudentId:id,aliases:[id]}),
  json:(data,status=200)=>({data,status}),ensureTenantTables:async()=>{},table:()=>client,rowKey:()=>"lesson-id",listByStudent:async()=>[],
  getTeacherDirectory:async()=>({teacherName:"測試老師"}),
  listUserStudentMappings:async(status,school)=>{
   assert.equal(status,"active");assert.equal(school,schoolId);
   return [...parents.map(parentEmail=>({studentId:"student-1",parentEmail})),{studentId:"other-student",parentEmail:"unrelated@example.invalid"}];
  },
  getStudentMaster:async()=>({studentName:"測試同學"}),
  getTenantDirectory:async()=>({timezone:"Asia/Taipei",systemName:"測試學校"}),
  tenantStudentPartition:(school,id)=>school+"|student|"+id,activityStudentId:row=>row.studentId,
  getSystemSettings:async()=>({emailNotificationsEnabled:emailEnabled}),
  sendPrivateLessonWorkflowEmail:async notice=>{mail.push(notice);return {status:"accepted",recipientCount:notice.recipients.length}},
  notifyAdminTodo:async(...args)=>{staff.push(args)},notifyPrivateLessonLine,formatPrivateLessonNotice,
  normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson,validateParentLessonReview,process:{env:{}},console,URL
 });
 const submit=()=>handler({method:"POST",headers:{get:name=>name==="origin"?"https://school-a.example.invalid":null},
  json:async()=>({studentId:"student-1",lessonDate:"2099-11-20",startTime:"18:00",endTime:"18:50",lessonContent:"練習音階"})});
 return {submit,messages,mail,staff,created,recipients};
}

test("a teacher booking notifies only both linked parents even when Email is disabled",async()=>{
 const h=booking(),result=await h.submit();
 assert.equal(result.status,201);
 assert.equal(result.data.emailNotification.status,"disabled");
 assert.equal(result.data.lineNotification.status,"accepted");
 assert.equal(h.created.length,1);
 assert.equal(h.messages.length,2);
 assert.equal(h.mail.length,0);
 assert.equal(h.staff.length,0);
 for(const {message,text} of h.messages){
  assert.equal(message.type,"flex");
  const visible=JSON.stringify(message.contents);
  for(const value of ["測試同學","測試老師","2099-11-20","18:00","18:50"])assert.ok(visible.includes(value),value);
  assert.ok(visible.includes('"type":"uri"'));assert.ok(visible.includes('school-a.example.invalid'));
  assert.match(text,/個別課預約通知/);
  assert.match(text,/測試同學/);
  assert.match(text,/測試老師/);
  assert.match(text,/2099-11-20/);
  assert.match(text,/18:00～18:50/);
  assert.match(text,/school-a.example.invalid/);
  assert.doesNotMatch(text,/後台待辦|待辦事項/);
 }
});

test("an actor who is also the pupil's parent still receives the parent booking notice",async()=>{
 const email="parent-teacher@example.invalid";
 const h=booking({teacherEmail:email,parents:[email]}),result=await h.submit();
 assert.equal(result.status,201);
 assert.equal(result.data.lineNotification.status,"accepted");
 assert.equal(h.messages.length,1);
 assert.equal(h.staff.length,0);
});

test("unbound parents cannot cause an unrelated staff notification, and linked aliases deduplicate",async()=>{
 const h=booking({emailEnabled:true,unbound:["father@example.invalid"]});
 const first=await h.submit();
 assert.equal(first.data.lineNotification.status,"accepted");
 assert.equal(h.messages.length,1);
 assert.equal(h.mail.length,1);
 assert.equal(h.staff.length,0);
 h.recipients.set("father@example.invalid",h.recipients.get("mother@example.invalid"));
 await h.submit();
 assert.equal(h.messages.length,2);
 h.recipients.clear();
 const last=await h.submit();
 assert.equal(last.data.lineNotification.status,"not_bound");
 assert.equal(h.messages.length,2);
 assert.equal(h.staff.length,0);
});
