import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createHmac} from "node:crypto";
import {normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson} from "../api/src/lib/musicLearningGoals.mjs";
import {validateParentLessonReview} from "../api/src/lib/privateLessonReview.mjs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const stripped=path=>read(path).replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const missing=()=>Object.assign(Error("missing"),{statusCode:404});
const schoolId="school-a",botUserId="U"+"a".repeat(32);
const mother="mother@example.invalid",father="father@example.invalid";
const userIds=new Map([[mother,"U"+"b".repeat(32)],[father,"U"+"c".repeat(32)]]);
const goals=["降 E 大調音階，慢速 60 BPM","第 18～24 小節換把練習","注意右手運弓與節奏"];
const content="今日課程：音階、換把與弓法";

function fixture(){
 const lesson={partitionKey:schoolId+"|student|student1",rowKey:"lesson1",studentId:"student1",teacher:mother,
  teacherName:"測試老師",eventDate:"2020-11-17",startTime:"18:00",endTime:"18:50",minutes:50,status:"scheduled",
  parentConfirmation:"not_required",etag:"v1"};
 const records=new Map([[lesson.rowKey,lesson]]),reviews=new Map(),outbound=[],emails=[];
 let access={role:"privateTeacher",email:mother,capabilities:{private:true}};
 const tenantStudentPartition=(school,id)=>school+"|student|"+id;
 const client={
  async getEntity(partition,id){const row=records.get(id);if(!row||partition!==row.partitionKey)throw missing();return {...row}},
  async updateEntity(patch,_mode,options={}){
   const row=records.get(patch.rowKey);
   if(!row)throw missing();
   if(options.etag&&options.etag!==row.etag)throw Object.assign(Error("conflict"),{statusCode:412});
   Object.assign(row,patch,{etag:"v"+(Number(row.etag.slice(1))+1)});
  }
 };
 const reviewStore={
  async createTable(){},
  async createEntity(row){const key=row.partitionKey+"|"+row.rowKey;if(reviews.has(key))throw Object.assign(Error("exists"),{statusCode:409});reviews.set(key,{...row})},
  async getEntity(partition,id){const row=reviews.get(partition+"|"+id);if(!row)throw missing();return {...row}}
 };
 const emailFormat=read("api/src/lib/email.js");
 const formatPrivateLessonNotice=runInNewContext(
  'const clean=(value,max=500)=>String(value??"").trim().slice(0,max),esc=value=>String(value).replaceAll("<","&lt;").replaceAll(">","&gt;");\n'+
  emailFormat.slice(emailFormat.indexOf("const privateLessonMailCopy="),emailFormat.indexOf("export async function sendPrivateLessonWorkflowEmail(")).replace(/^export /gm,"")+
  ";formatPrivateLessonNotice"
 );
 const common={console,createHmac,validateParentLessonReview,tenantStudentPartition,
  process:{env:{STORAGE_CONNECTION_STRING:"test",LAB_ENVIRONMENT:"functional-uat"}},
  getStudentAliasInfo:async id=>({canonicalStudentId:id,aliases:[id]}),ensureTenantTables:async()=>{},table:()=>client,
  getTenantLineRecipient:async(school,email,bot)=>school===schoolId&&bot===botUserId&&userIds.has(email)?{lineUserId:userIds.get(email)}:null,
  getMappedStudentsByEmail:async(email,school)=>school===schoolId&&userIds.has(email)?[{studentId:"student1"}]:[],
  workflowLineEnabled:()=>true,workflowLineRetryKey:()=>"retry",
  resolveTenantLineChannel:async school=>{assert.equal(school,schoolId);return {schoolId,botUserId,channelSecret:"secret",loginConfigured:true,appOrigin:"https://school-a.example.invalid",accessToken:"test"}},
  TableClient:{fromConnectionString:()=>reviewStore},
  pushLineMessage:async(userId,text,options)=>outbound.push({userId,text,options})};
 const line=runInNewContext(stripped("api/src/lib/linePrivateLesson.js")+";({notifyPrivateLessonLine,receivePrivateLessonReview})",common);
 let handler;
 runInNewContext(stripped("api/src/functions/privateLesson.js"),{
  ...common,...line,normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson,formatPrivateLessonNotice,URL,
  app:{http:(_,entry)=>{handler=entry.handler}},json:(data,status=200)=>({data,status}),
  getTenantContext:async()=>({schoolId,access}),getTenantDirectory:async()=>({timezone:"Asia/Taipei",systemName:"測試學校"}),
  ensurePrivateAccess:()=>true,ensureStudentAccess:()=>true,activityStudentId:row=>row.studentId,
  getTeacherDirectory:async()=>({teacherName:"測試老師"}),getStudentMaster:async()=>({studentName:"測試學生"}),
  getSystemSettings:async()=>({emailNotificationsEnabled:true}),
  listUserStudentMappings:async()=>[mother,father].map(parentEmail=>({parentEmail,studentId:"student1"})),
  sendPrivateLessonWorkflowEmail:async notice=>{emails.push(formatPrivateLessonNotice(notice));return {status:"accepted",recipientCount:2}}
 });
 const patch=(body={})=>handler({method:"PATCH",headers:{get:key=>key==="origin"?"https://school-a.example.invalid":null},
  json:async()=>({studentId:"student1",lessonId:"lesson1",...body})});
 function reviewCode(userId){const text=outbound.find(message=>message.userId===userId)?.text;return text?.match(/#個課評鑑 ([A-F0-9]{14}) 5/)[1]}
 async function readTeacherReviews(){
  let directoryHandler;
  runInNewContext(stripped("api/src/functions/teacherDirectory.js"),{
   app:{http:(_,entry)=>{directoryHandler=entry.handler}},getTenantContext:async()=>({schoolId,access:{role:"admin"}}),
   json:(data,status=200)=>({data,status}),isPrivateOnlyTeacher:()=>false,activityStudentId:row=>row.studentId,
   listActivityRange:async(kind,school)=>{assert.deepEqual([kind,school],["privateLesson",schoolId]);return [...records.values()]},
   listStudentMaster:async()=>[{rowKey:"student1",studentName:"測試學生",status:"active"}],
   listTeacherDirectory:async()=>[{rowKey:mother,teacherName:"測試老師",status:"active"}],getTeacherProfile:async()=>null
  });
  return directoryHandler({method:"GET",query:new URLSearchParams()});
 }
 return {patch,line,lesson,outbound,emails,reviewCode,readTeacherReviews,
  setParent:email=>{access={role:"parent",email,students:[{studentId:"student1"}]}}};
}

test("completing a lesson sends both parents the course content, all three goals and a personal LINE review code",async()=>{
 const h=fixture();
 const response=await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content,weeklyPracticeGoals:goals});
 assert.equal(response.status,200);
 assert.equal(h.lesson.status,"teacher_completed");
 assert.deepEqual(JSON.parse(h.lesson.weeklyPracticeGoalsJson),goals);
 assert.equal(h.outbound.length,2);
 assert.equal(h.emails.length,1);
 for(const {text,options} of h.outbound){
  assert.match(text,/個別課完成確認/);
  assert.ok(text.includes(content));
  for(const [index,goal] of goals.entries())assert.ok(text.includes((index+1)+". "+goal));
  assert.match(text,/#個課評鑑 [A-F0-9]{14} 5 請填寫您的想法/);
  assert.match(text,/家長自己的 LINE/);assert.match(text,/電腦／未看到按鈕/);assert.match(text,/才表示評鑑完成並寫入平台/);assert.match(text,/本堂評鑑截止/);
  assert.equal(options.quickReply.items.length,5);
  const code=text.match(/#個課評鑑 ([A-F0-9]{14}) 5/)[1];
  for(const [index,item] of options.quickReply.items.entries()){
   assert.equal(item.action.type,"postback");assert.equal(item.action.inputOption,"openKeyboard");
   assert.equal(item.action.fillInText,`#個課評鑑 ${code} ${index+1} `);
   assert.match(item.action.label,new RegExp(String(index+1)+" 星"));
  }
 }
 for(const goal of goals){
  assert.ok(h.emails[0].plainText.includes(goal));
  assert.ok(h.emails[0].html.includes(goal));
 }
 const a=h.reviewCode(userIds.get(mother)),b=h.reviewCode(userIds.get(father));
 assert.notEqual(a,b);
 await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content,weeklyPracticeGoals:goals});
 assert.equal(h.outbound.length,2);
});

test("a LINE rating reaches the teacher review summary and web confirmation preserves the original reviewer",async()=>{
 const h=fixture();
 await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content,weeklyPracticeGoals:goals});
 const code=h.reviewCode(userIds.get(mother)),channel={schoolId,botUserId};
 const review="老師耐心示範換把，孩子知道回家要如何練習";
 assert.match(await h.line.receivePrivateLessonReview(channel,userIds.get(father),"#個課評鑑 "+code+" 5 "+review),/失效/);
 assert.equal(h.lesson.teacherRating,undefined);
 assert.match(await h.line.receivePrivateLessonReview(channel,userIds.get(mother),"#個課評鑑 "+code+" 5 "+review),/已記錄.*5 星/);
 const original={rating:h.lesson.teacherRating,review:h.lesson.teacherReview,by:h.lesson.teacherRatedBy,at:h.lesson.teacherRatedAt};
 assert.equal(original.rating,5);
 assert.equal(original.review,review);
 assert.equal(original.by,mother);
 assert.ok(original.at);
 const directory=await h.readTeacherReviews(),teacher=directory.data.items[0];
 assert.equal(teacher.ratingAverage,5);
 assert.equal(teacher.ratingCount,1);
 assert.equal(teacher.recentReviews[0].studentName,"測試學生");
 assert.equal(teacher.recentReviews[0].reviewerEmail,mother);
 assert.equal(teacher.recentReviews[0].lessonId,"lesson1");
 const fatherCode=h.reviewCode(userIds.get(father));
 assert.match(await h.line.receivePrivateLessonReview(channel,userIds.get(father),"#個課評鑑 "+fatherCode+" 4 另一筆回饋"),/已收到評鑑/);
 h.setParent(father);
 assert.equal((await h.patch({action:"confirmed",teacherRating:4,teacherReview:"另一筆回饋"})).status,409);
 assert.equal((await h.patch({action:"confirmed",teacherRating:0,teacherReview:""})).status,200);
 assert.equal(h.lesson.status,"present");
 assert.deepEqual({rating:h.lesson.teacherRating,review:h.lesson.teacherReview,by:h.lesson.teacherRatedBy,at:h.lesson.teacherRatedAt},original);
});

test("LINE reviews require a usable star value and actual text and never update another school's lesson",async()=>{
 const h=fixture();
 await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content,weeklyPracticeGoals:goals});
 const code=h.reviewCode(userIds.get(mother)),userId=userIds.get(mother),channel={schoolId,botUserId};
 for(const suffix of ["0 想法","6 想法","5","5 請填寫您的想法"]){
  await h.line.receivePrivateLessonReview(channel,userId,"#個課評鑑 "+code+" "+suffix);
  assert.equal(h.lesson.teacherRating,undefined);
 }
 assert.match(await h.line.receivePrivateLessonReview({...channel,schoolId:"another-school"},userId,"#個課評鑑 "+code+" 5 謝謝老師"),/失效/);
 assert.equal(h.lesson.teacherRating,undefined);
});

test("HTML notification escapes course suggestions while the LINE text retains what the teacher typed",async()=>{
 const h=fixture(),goal='<b>音階</b> & 運弓';
 await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content,weeklyPracticeGoals:[goal]});
 assert.ok(h.outbound[0].text.includes(goal));
 assert.ok(h.emails[0].html.includes("&lt;b&gt;音階&lt;/b&gt;"));
 assert.ok(!h.emails[0].html.includes("<b>音階</b>"));
});


test("every quick-reply star value remains a draft until real text is sent and is stored under the correct parent",async()=>{
 for(const rating of [1,2,3,4,5]){
  const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
  const notification=h.outbound.find(x=>x.userId===userIds.get(mother)),action=notification.options.quickReply.items[rating-1].action;
  assert.equal(h.lesson.teacherRating,undefined);
  const reply=await h.line.receivePrivateLessonReview({schoolId,botUserId},notification.userId,action.fillInText+"老師教學內容很清楚，希望多示範弓法");
  assert.equal(h.lesson.teacherRating,rating);assert.equal(h.lesson.teacherRatedBy,mother);
  assert.equal(h.lesson.parentConfirmation,"pending");assert.match(reply,/已記錄/);assert.ok(reply.includes(`${rating}/5`));assert.match(reply,/您的評語：老師教學/);
 }
});

test("invalid or unchanged placeholder reviews return copyable guidance without writing an evaluation",async()=>{
 const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
 const code=h.reviewCode(userIds.get(mother));
 for(const suffix of ["5","6 評語","5 請填寫您的想法"]){
  const reply=await h.line.receivePrivateLessonReview({schoolId,botUserId},userIds.get(mother),`#個課評鑑 ${code} ${suffix}`);
  assert.ok(reply.includes(`#個課評鑑 ${code} 5 請填寫您的想法`));assert.match(reply,/實際評語/);assert.equal(h.lesson.teacherRating,undefined);
 }
});

test("a star-button postback alone cannot submit a rating or confirm lesson completion",async()=>{
 let handler,calls=0;
 runInNewContext(stripped("api/src/functions/lineWebhook.js"),{
  app:{http:(name,entry)=>{if(name==="tenantLineWebhook")handler=entry.handler}},json:(data,status=200)=>({data,status}),Buffer,console,
  tenantIdValue:x=>x,defaultTenantId:()=>schoolId,
  resolveTenantLineChannel:async()=>({schoolId,botUserId,configured:true,loginConfigured:true,channelSecret:"secret",accessToken:"test"}),
  verifyLineSignature:()=>true,receivePrivateLessonReview:async()=>{calls++},
  table:()=>{throw Error("must not write a rating")}
 });
 const payload={destination:botUserId,events:[{type:"postback",source:{type:"user",userId:userIds.get(mother)},postback:{data:"lesson-review:0123456789ABCD:5"}}]};
 const result=await handler({params:{schoolId},headers:new Headers(),arrayBuffer:async()=>Buffer.from(JSON.stringify(payload))});
 assert.equal(result.status,200);
 assert.equal(calls,0);
});
