import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createHmac} from "node:crypto";
import {normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson} from "../api/src/lib/musicLearningGoals.mjs";
import {validateParentLessonReview} from "../api/src/lib/privateLessonReview.mjs";
import {buildPrivateLessonNoticeCard,buildPrivateReviewResponseCard} from "../api/src/lib/privateLessonLineCards.mjs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const stripped=path=>read(path).replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const missing=()=>Object.assign(Error("missing"),{statusCode:404});
const schoolId="school-a",botUserId="U"+"a".repeat(32);
const mother="mother@example.invalid",father="father@example.invalid";
const userIds=new Map([[mother,"U"+"b".repeat(32)],[father,"U"+"c".repeat(32)]]);
const goals=["降 E 大調音階，慢速 60 BPM","第 18～24 小節換把練習","注意右手運弓與節奏"];
const content="今日課程：音階、換把與弓法";
const nodes=value=>value&&typeof value==="object"?[value,...Object.values(value).flatMap(nodes)]:[];
const cardText=message=>nodes(message.contents).filter(node=>node.type==="text").map(node=>node.text).join("\n");

function fixture(){
 const lesson={partitionKey:schoolId+"|student|student1",rowKey:"lesson1",studentId:"student1",teacher:mother,
  teacherName:"測試老師",eventDate:"2020-11-17",startTime:"18:00",endTime:"18:50",minutes:50,status:"scheduled",
  parentConfirmation:"not_required",etag:"v1"};
 const records=new Map([[lesson.rowKey,lesson]]),reviews=new Map(),outbound=[],emails=[];
 let failPush=false,failUpdate=false;
 let access={role:"privateTeacher",email:mother,capabilities:{private:true}};
 const tenantStudentPartition=(school,id)=>school+"|student|"+id;
 const client={
  async getEntity(partition,id){const row=records.get(id);if(!row||partition!==row.partitionKey)throw missing();return {...row}},
  async updateEntity(patch,_mode,options={}){
   if(failUpdate){failUpdate=false;throw Object.assign(Error("concurrent update"),{statusCode:412})}
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
 const common={console,createHmac,validateParentLessonReview,tenantStudentPartition,buildPrivateLessonNoticeCard,buildPrivateReviewResponseCard,
  process:{env:{STORAGE_CONNECTION_STRING:"test",LAB_ENVIRONMENT:"functional-uat"}},
  getStudentAliasInfo:async id=>({canonicalStudentId:id,aliases:[id]}),ensureTenantTables:async()=>{},table:()=>client,
  getTenantLineRecipient:async(school,email,bot)=>school===schoolId&&bot===botUserId&&userIds.has(email)?{lineUserId:userIds.get(email)}:null,
  getMappedStudentsByEmail:async(email,school)=>school===schoolId&&userIds.has(email)?[{studentId:"student1",name:"測試學生"}]:[],
  workflowLineEnabled:()=>true,workflowLineRetryKey:(_school,event,user)=>event+":"+user,
  resolveTenantLineChannel:async school=>{assert.equal(school,schoolId);return {schoolId,botUserId,channelSecret:"secret",loginConfigured:true,appOrigin:"https://school-a.example.invalid",accessToken:"test"}},
  TableClient:{fromConnectionString:()=>reviewStore},
  pushLineMessage:async(userId,message,options)=>{if(failPush)throw Error("provider unavailable");outbound.push({userId,message,text:typeof message==="string"?message:message.fallbackText,options})}};
 const line=runInNewContext(stripped("api/src/lib/linePrivateLesson.js")+";({notifyPrivateLessonLine,receivePrivateLessonReview})",common);
 let handler;
 runInNewContext(stripped("api/src/functions/privateLesson.js"),{
  ...common,...line,normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson,formatPrivateLessonNotice,URL,
  app:{http:(_,entry)=>{handler=entry.handler}},json:(data,status=200)=>({data,status}),
  getTenantContext:async()=>({schoolId,access}),getTenantDirectory:async()=>({timezone:"Asia/Taipei",systemName:"測試學校"}),
  ensurePrivateAccess:()=>true,ensureStudentAccess:()=>true,activityStudentId:row=>row.studentId,
  listByStudent:async(_kind,id)=>[...records.values()].filter(x=>x.studentId===id),
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
 return {patch,line,lesson,outbound,emails,reviews,reviewCode,readTeacherReviews,
  get:()=>handler({method:"GET",query:new URLSearchParams(),headers:{get:()=>null}}),
  setAccess:value=>{access=value},failPush:value=>{failPush=value},failNextUpdate:()=>{failUpdate=true},
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
 for(const {message,text,options} of h.outbound){
  assert.equal(message.type,"flex");
  const visible=cardText(message);
  for(const value of ["測試學生","測試老師","2020-11-17","18:00","18:50",content,...goals])assert.ok(visible.includes(value),value);
  assert.doesNotMatch(visible,/https:\/\/|#個課評鑑 [A-F0-9]{14}/);
  assert.match(text,/個別課完成確認/);
  assert.ok(text.includes(content));
  for(const [index,goal] of goals.entries())assert.ok(text.includes((index+1)+". "+goal));
  assert.match(text,/#個課評鑑 [A-F0-9]{14} 5 請填寫您的想法/);
  assert.match(text,/家長自己的 LINE/);assert.match(text,/未見按鈕/);assert.match(text,/傳送，即確認完成上課/);assert.match(text,/截止：/);
  assert.equal(options.quickReply.items.length,5);
  const code=text.match(/#個課評鑑 ([A-F0-9]{14}) 5/)[1];
  const starActions=nodes(message.contents).filter(node=>node.type==="button"&&node.action?.type==="postback").map(node=>node.action);
  assert.equal(starActions.length,5);
  for(const [index,action] of starActions.entries()){
   assert.equal(action.data,`lesson-review:${code}:${index+1}`);assert.equal(action.inputOption,"openKeyboard");
   assert.equal(action.fillInText,`#個課評鑑 ${code} ${index+1} `);
  }
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

test("a LINE review confirms completion and reaches parent records and the teacher review summary",async()=>{
 const h=fixture();
 await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content,weeklyPracticeGoals:goals});
 const code=h.reviewCode(userIds.get(mother)),channel={schoolId,botUserId};
 const review="老師耐心示範換把，孩子知道回家要如何練習";
 assert.match(await h.line.receivePrivateLessonReview(channel,userIds.get(father),"#個課評鑑 "+code+" 5 "+review),/失效/);
 assert.equal(h.lesson.teacherRating,undefined);
 const receipt=await h.line.receivePrivateLessonReview(channel,userIds.get(mother),"#個課評鑑 "+code+" 5 "+review,{cards:true});
 assert.match(receipt.fallbackText,/已記錄.*5 星/);assert.equal(receipt.type,"flex");
 assert.match(cardText(receipt),/測試學生/);assert.match(cardText(receipt),/★★★★★（5\/5）/);assert.ok(cardText(receipt).includes(review));
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
 assert.equal((await h.patch({action:"confirmed",teacherRating:0,teacherReview:""})).status,409);
 const parent=await h.get();
 assert.equal(parent.data.pendingCount,0);assert.equal(parent.data.items[0].workflowStatus,"completed");
 assert.equal(parent.data.items[0].parentConfirmedVia,"line");assert.equal(parent.data.items[0].teacherReview,review);
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
  assert.equal(h.lesson.parentConfirmation,"confirmed");assert.equal(h.lesson.parentConfirmedBy,mother);
  assert.equal(h.lesson.status,"present");assert.ok(h.lesson.finalizedAt);assert.ok(h.lesson.updatedAt);
  assert.match(reply,/已確認.*完成上課/);assert.match(reply,/不需再到網頁確認/);assert.match(reply,/已記錄/);assert.ok(reply.includes(`${rating}/5`));assert.match(reply,/您的評語：老師教學/);
 }
});

test("invalid or unchanged placeholder reviews return copyable guidance without writing an evaluation",async()=>{
 const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
 const code=h.reviewCode(userIds.get(mother));
 for(const suffix of ["5","6 評語","5 請填寫您的想法"]){
  const reply=await h.line.receivePrivateLessonReview({schoolId,botUserId},userIds.get(mother),`#個課評鑑 ${code} ${suffix}`);
  assert.ok(reply.includes(`#個課評鑑 ${code} 5 請填寫您的想法`));assert.match(reply,/實際評語/);assert.equal(h.lesson.teacherRating,undefined);
  const card=await h.line.receivePrivateLessonReview({schoolId,botUserId},userIds.get(mother),`#個課評鑑 ${code} ${suffix}`,{cards:true});
  assert.equal(card.type,"flex");assert.match(cardText(card),/星等/);assert.match(cardText(card),/實際評語/);
  assert.doesNotMatch(cardText(card),new RegExp(code));assert.equal(h.lesson.teacherRating,undefined);
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

test("a parent text webhook confirms a late lesson once and preserves the other parent's identity",async()=>{
 const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"late",lessonContent:content});
 const code=h.reviewCode(userIds.get(father)),text=`#個課評鑑 ${code} 4 老師解說清楚`;
 let handler;const replies=[];
 runInNewContext(stripped("api/src/functions/lineWebhook.js"),{
  app:{http:(name,entry)=>{if(name==="tenantLineWebhook")handler=entry.handler}},json:(data,status=200)=>({data,status}),Buffer,console,
  tenantIdValue:x=>x,defaultTenantId:()=>schoolId,
  resolveTenantLineChannel:async()=>({schoolId,botUserId,configured:true,loginConfigured:true,channelSecret:"secret",accessToken:"test"}),
  verifyLineSignature:()=>true,parseActivityLineBinding:()=>null,
  receivePrivateLessonReview:h.line.receivePrivateLessonReview,replyLineMessage:async(_token,message)=>replies.push(message)
 });
 const payload={destination:botUserId,events:[{type:"message",source:{type:"user",userId:userIds.get(father)},message:{type:"text",text},replyToken:"reply"}]};
 const request={params:{schoolId},headers:new Headers(),arrayBuffer:async()=>Buffer.from(JSON.stringify(payload))};
 assert.equal((await handler(request)).status,200);
 assert.equal(replies[0].type,"flex");
 const success=cardText(replies[0]);
 assert.ok(success.includes("2020-11-17"));assert.ok(success.includes("18:00"));assert.ok(success.includes("18:50"));
 assert.ok(success.includes("老師解說清楚"));assert.match(success,/4/);assert.match(success,/確認|完成/);
 assert.equal(h.lesson.status,"late");assert.equal(h.lesson.parentConfirmation,"confirmed");
 assert.equal(h.lesson.parentConfirmedBy,father);assert.equal(h.lesson.teacherRatedBy,father);
 const etag=h.lesson.etag,confirmed=h.lesson.parentConfirmedAt;
 await handler(request);
 assert.equal(replies[1].type,"flex");assert.match(cardText(replies[1]),/已收到評鑑/);assert.equal(h.lesson.etag,etag);assert.equal(h.lesson.parentConfirmedAt,confirmed);
});

test("stale writes cannot partially record an evaluation or finalize a lesson",async()=>{
 const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
 const text=`#個課評鑑 ${h.reviewCode(userIds.get(mother))} 5 謝謝老師`;
 h.failNextUpdate();
 assert.match(await h.line.receivePrivateLessonReview({schoolId,botUserId},userIds.get(mother),text),/重新送出/);
 assert.equal(h.lesson.teacherRating,undefined);assert.equal(h.lesson.parentConfirmation,"pending");assert.equal(h.lesson.finalizedAt,undefined);
 assert.match(await h.line.receivePrivateLessonReview({schoolId,botUserId},userIds.get(mother),text),/已確認/);
 assert.equal(h.lesson.parentConfirmation,"confirmed");assert.equal(h.lesson.teacherRating,5);
});

test("a previously recorded review can finalize its pending lesson only for the original parent and same feedback",async()=>{
 const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
 Object.assign(h.lesson,{teacherRating:5,teacherReview:"謝謝老師",teacherRatedAt:"2026-11-19T00:00:00.000Z",teacherRatedBy:mother});
 const original=h.lesson.teacherRatedAt;
 const fatherText=`#個課評鑑 ${h.reviewCode(userIds.get(father))} 5 謝謝老師`;
 assert.match(await h.line.receivePrivateLessonReview({schoolId,botUserId},userIds.get(father),fatherText),/已收到評鑑/);
 assert.equal(h.lesson.parentConfirmation,"pending");
 const motherText=`#個課評鑑 ${h.reviewCode(userIds.get(mother))} 5 謝謝老師`;
 assert.match(await h.line.receivePrivateLessonReview({schoolId,botUserId},userIds.get(mother),motherText),/已確認/);
 assert.equal(h.lesson.parentConfirmation,"confirmed");assert.equal(h.lesson.teacherRatedAt,original);
});

test("expired, cancelled, superseded and group-chat reviews never finalize the course",async()=>{
 for(const change of [h=>{for(const row of h.reviews.values())row.expiresAt=Date.now()-1},h=>{h.lesson.status="cancelled"},h=>{h.lesson.completedAt="2000-01-01T00:00:00Z"}]){
  const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
  const text=`#個課評鑑 ${h.reviewCode(userIds.get(mother))} 5 謝謝老師`;
  change(h);assert.match(await h.line.receivePrivateLessonReview({schoolId,botUserId},userIds.get(mother),text),/失效/);
  assert.equal(h.lesson.parentConfirmation,"pending");assert.equal(h.lesson.teacherRating,undefined);
 }
 const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
 assert.match(await h.line.receivePrivateLessonReview({schoolId,botUserId},"",`#個課評鑑 ${h.reviewCode(userIds.get(mother))} 5 謝謝老師`),/一對一/);
 assert.equal(h.lesson.parentConfirmation,"pending");
});

test("LINE resend sends current content and star buttons to both parents without resending Email or changing completion",async()=>{
 const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"late",lessonContent:content,weeklyPracticeGoals:goals});
 const completed=h.lesson.completedAt,firstKey=h.outbound[0].options.retryKey;
 await h.patch({action:"update_weekly_practice_goals",weeklyPracticeGoals:["新的運弓練習"]});
 const result=await h.patch({action:"resend_line"});
 assert.equal(result.status,200);assert.equal(result.data.lineNotification.status,"accepted");
 assert.equal(result.data.item.lineNotificationResendCount,1);assert.ok(result.data.item.lineNotificationLastResentAt);
 assert.equal(h.outbound.length,4);assert.equal(h.emails.length,1);
 assert.equal(h.lesson.completedAt,completed);assert.equal(h.lesson.status,"teacher_completed");assert.equal(h.lesson.parentConfirmation,"pending");
 for(const message of h.outbound.slice(2)){
  assert.match(message.text,/新的運弓練習/);assert.equal(message.options.quickReply.items.length,5);
  assert.notEqual(message.options.retryKey,firstKey);
 }
 assert.equal((await h.patch({action:"resend_line"})).status,429);assert.equal(h.outbound.length,4);
});

test("LINE resend rejects parent and unrelated teacher access and unavailable review states",async()=>{
 const h=fixture();assert.equal((await h.patch({action:"resend_line"})).status,409);
 await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
 h.setParent(mother);assert.equal((await h.patch({action:"resend_line"})).status,403);
 h.setAccess({role:"privateTeacher",email:"unrelated@example.invalid",capabilities:{private:true}});
 assert.equal((await h.patch({action:"resend_line"})).status,403);
 h.setAccess({role:"admin",email:"admin@example.invalid"});
 h.lesson.completedAt="2000-01-01T00:00:00Z";assert.equal((await h.patch({action:"resend_line"})).status,409);
 h.lesson.parentConfirmation="confirmed";h.lesson.status="present";assert.equal((await h.patch({action:"resend_line"})).status,409);
 assert.equal(h.outbound.length,2);
});

test("provider and concurrency failures are reported without claiming delivery or overwriting lesson state",async()=>{
 const h=fixture();await h.patch({action:"complete_lesson",attendanceStatus:"present",lessonContent:content});
 h.failNextUpdate();assert.equal((await h.patch({action:"resend_line"})).status,409);assert.equal(h.outbound.length,2);
 h.failPush(true);const result=await h.patch({action:"resend_line"});
 assert.equal(result.data.lineNotification.status,"failed");assert.equal(h.lesson.lineNotificationStatus,"failed");
 assert.equal(h.lesson.parentConfirmation,"pending");assert.equal(h.lesson.teacherRating,undefined);assert.equal(h.emails.length,1);
});
