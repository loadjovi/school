import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../app/private-lesson-confirmation.js",import.meta.url),"utf8");
const esc=value=>String(value??"").replaceAll("<","&lt;").replaceAll(">","&gt;");
function part(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to)}

test("parent home replaces the pending form with saved LINE completion and escaped review",()=>{
 const row={lessonId:"lesson1",studentId:"student1",workflowStatus:"completed",parentConfirmedVia:"line",parentConfirmedAt:new Date().toISOString(),teacherReview:"<script>review</script>"};
 const context={state:{me:{role:"parent"},student:{studentId:"student1"}},window:{},sortedLessons:()=>[row],workflow:x=>x.workflowStatus,parentActivePanel:()=>"",parentLessonSummary:x=>esc(x.teacherReview)};
 runInNewContext(part('  window.privateLessonParentPanels=', '  function currentWeeklyLearningGoals()'),context);
 const html=context.window.privateLessonParentPanels("home");
 assert.match(html,/個課已確認/);assert.match(html,/已透過 LINE 完成確認，不需再次操作/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 context.state.me.role="teacher";assert.equal(context.window.privateLessonParentPanels("home"),"");context.state.me.role="parent";
 row.parentConfirmedAt="2000-01-01T00:00:00Z";assert.equal(context.window.privateLessonParentPanels("home"),"");
});

test("parent lesson summary keeps content and review safe, with notification metadata collapsed",()=>{
 const summary=runInNewContext(part('  function parentLessonSummary(', '  function parentReviewControls(')+';parentLessonSummary',{
  esc,teacherLabel:()=>"測試老師",ratingStars:()=>"★★★★☆",workflow:()=>"awaiting_parent",
  emailStatusLine:()=>"Email 已受理發送",lineStatusLine:()=>"LINE 準備發送"
 });
 const html=summary({lessonDate:"2026-11-20",startTime:"18:00",endTime:"19:00",minutes:60,lessonContent:"<script>課程</script>",weeklyPracticeGoals:["<img>練習一","練習二","練習三"],teacherRating:4,teacherReview:"<script>評語</script>"});
 assert.match(html,/上課內容/);assert.match(html,/4\/5/);assert.match(html,/&lt;script&gt;課程/);assert.match(html,/&lt;img&gt;練習一/);assert.doesNotMatch(html,/<script>|<img>/);
 assert.match(html,/<details class="parent-lesson-details"><summary>查看通知紀錄<\/summary>/);
 assert.doesNotMatch(html,/<details[^>]* open/);assert.doesNotMatch(html,/已完成確認|已結案/);
});

test("only the waiting parent card exposes the teacher's LINE resend action",()=>{
 const context={state:{expandedPrivateLessonId:"lesson1"},prefersLine:()=>false,workflow:x=>x.workflowStatus,workflowClass:{},workflowText:{},
  needsLessonCatchup:()=>false,lessonDomKey:x=>x,currentStudentName:()=>"測試學生",studentMetaLine:()=>"",weeklyGoalEditor:()=>"",teacherGoalPracticePanel:()=>"",teacherLessonHeader:()=>"",lessonSummary:()=>"",esc};
 const row=runInNewContext(part('  function teacherLessonRow(x){','  window.toggleTeacherPrivateLesson=')+';teacherLessonRow',context);
 assert.match(row({lessonId:"lesson1",studentId:"student1",workflowStatus:"awaiting_parent"}),/重發完課 LINE 通知/);
 assert.doesNotMatch(row({lessonId:"lesson1",studentId:"student1",workflowStatus:"completed"}),/重發完課 LINE 通知/);
});

test("rapid clicks produce one LINE request and provider failure is never labeled delivered",async()=>{
 const messages=[],requests=[];let release;
 const context={window:{},prefersLine:()=>false,currentStudentName:()=>"測試學生",confirm:()=>true,
  toast:text=>messages.push(text),loadPrivateLessons:async()=>{},render:()=>{},
  api:async(_path,args)=>{requests.push(JSON.parse(args.body));return new Promise(resolve=>{release=resolve})}};
 runInNewContext(part('  const lineResendsInFlight=', '  window.cancelPrivateLessonTeacher='),context);
 const first=context.window.resendPrivateLessonLine("student1","lesson1");
 await context.window.resendPrivateLessonLine("student1","lesson1");
 assert.equal(requests.length,1);assert.equal(requests[0].action,"resend_line");
 release({lineNotification:{status:"failed"}});await first;
 assert.match(messages.at(-1),/發送失敗/);assert.doesNotMatch(messages.at(-1),/已寄送|已受理/);
 const second=context.window.resendPrivateLessonLine("student1","lesson1");
 release({lineNotification:{status:"accepted"}});await second;
 assert.match(messages.at(-1),/已受理.*家長自己的 LINE/);
 context.prefersLine=()=>true;
 const unbound=context.window.resendPrivateLessonLine("student1","lesson1");
 release({lineNotification:{status:"not_bound"},emailNotification:{status:"disabled"},mailAcceptedCount:0,lineAcceptedCount:0});await unbound;
 assert.match(messages.at(-1),/沒有可用的 LINE 收件綁定/);
 assert.doesNotMatch(messages.at(-1),/Email|已受理/);
});

test("LINE-only and Email-only resend confirmations match their actual API actions",async()=>{
 const prompts=[],requests=[],messages=[],noticeCalls=[];
 const context={window:{},state:{privateLessons:[{lessonId:"lesson1",workflowStatus:"awaiting_parent"}]},
  workflow:x=>x.workflowStatus,prefersLine:()=>true,currentStudentName:()=>"測試學生",confirm:text=>{prompts.push(text);return true},
  toast:text=>messages.push(text),notifyToast:(...args)=>noticeCalls.push(args),loadPrivateLessons:async()=>{},render:()=>{},
  api:async(_path,args)=>{const body=JSON.parse(args.body);requests.push(body);return body.action==="resend_email"?{emailNotification:{status:"accepted",acceptedCount:1},item:{lineNotificationStatus:"disabled"}}:{lineNotification:{status:"unconfirmed"}}}};
 runInNewContext(part('  window.resendPrivateLessonEmail=', '  window.cancelPrivateLessonTeacher='),context);
 await context.window.resendPrivateLessonEmail("student1","lesson1");
 assert.equal(requests.at(-1).action,"resend_email");assert.match(prompts.at(-1),/Email.*本次不發送 LINE/);assert.doesNotMatch(prompts.at(-1),/LINE 優先|改寄/);
 assert.equal(noticeCalls[0][2].emailOnly,true);
 await context.window.resendPrivateLessonLine("student1","lesson1");
 assert.equal(requests.at(-1).action,"resend_line");assert.match(prompts.at(-1),/LINE.*本次不寄 Email/);assert.doesNotMatch(prompts.at(-1),/改寄 Email|LINE 優先/);
 assert.match(messages.at(-1),/LINE 發送結果待確認/);assert.doesNotMatch(messages.at(-1),/Email|已受理|已送達/);
});

test("completion toasts use the actual LINE result instead of blaming disabled Email",()=>{
 const messages=[],context={toast:text=>messages.push(text)};
 const notify=runInNewContext(part('  function notifyToast(', '  function sortedLessons(')+';notifyToast',context);
 for(const [status,expected] of [["unconfirmed",/LINE 發送結果待確認/],["pending",/LINE 通知待處理/],["not_bound",/LINE 收件綁定/],["failed",/LINE 發送失敗/],["accepted",/LINE 已受理.*收件待確認/]]){
  notify({item:{lineNotificationStatus:status},emailNotification:{status:"disabled"}},"已完成老師端登記");
  assert.match(messages.at(-1),/已完成老師端登記/);assert.match(messages.at(-1),expected);
  assert.doesNotMatch(messages.at(-1),/Email|已送達|已閱讀|寄送成功/);
 }
 notify({item:{lineNotificationStatus:"not_bound"},emailNotification:{status:"accepted",acceptedCount:2,recipientCount:2}},"已完成老師端登記");
 assert.match(messages.at(-1),/LINE 收件綁定.*Email 已受理 2 位/);
 notify({item:{lineNotificationStatus:"disabled"},emailNotification:{status:"failed"}},"Email 重寄作業完成",{emailOnly:true});
 assert.match(messages.at(-1),/Email 發送失敗/);assert.doesNotMatch(messages.at(-1),/LINE/);
});

test("a stale booking LINE acceptance cannot become the current failed completion result",()=>{
 const messages=[];
 const notify=runInNewContext(part('  function notifyToast(', '  function sortedLessons(')+';notifyToast',{toast:text=>messages.push(text)});
 notify({item:{lineNotificationStatus:"accepted",lineNotificationAt:"2026-11-24T02:00:00.000Z",emailNotificationAt:"2026-11-26T15:00:00.000Z"},
  emailNotification:{status:"failed"}},"已完成老師端登記");
 assert.match(messages.at(-1),/已完成老師端登記/);assert.match(messages.at(-1),/Email 發送失敗/);
 assert.doesNotMatch(messages.at(-1),/LINE 已受理|已送達|已通知家長/);
});

test("stored LINE audit statuses remain visible and never imply every parent received a message",()=>{
 const statusLine=runInNewContext(part('  function lineStatusLine(', '  function notifyToast(')+';lineStatusLine',{fmtEmailAt:()=>""});
 for(const [status,expected] of [["unconfirmed",/結果待確認/],["no_recipients",/沒有可通知/],["obsolete",/本次未發送/],["pending",/尚未確認受理/],["unknown",/待確認/],["future_status",/待確認/]]){
  const text=statusLine({lineNotificationStatus:status});assert.match(text,expected);assert.doesNotMatch(text,/已送達|已閱讀|寄送成功/);
 }
 assert.equal(statusLine({lineNotificationStatus:""}),"");
 const summary=runInNewContext(part('  function parentLessonSummary(', '  function parentReviewControls(')+';parentLessonSummary',{
  esc,teacherLabel:()=>"測試老師",ratingStars:()=>"",workflow:()=>"awaiting_parent",emailStatusLine:()=>"",lineStatusLine:statusLine
 });
 assert.match(summary({lessonDate:"2026-11-24",lineNotificationStatus:"accepted"}),/整堂課的彙總.*不代表每位收件人皆已收到或閱讀/);
});

test("parent pending panel offers a manual status refresh without requiring another confirmation",()=>{
 const context={state:{me:{role:"parent"},student:{studentId:"student1"}},sortedLessons:()=>[{workflowStatus:"awaiting_parent"}],workflow:x=>x.workflowStatus,parentLessonRow:()=>"<article>pending</article>"};
 const panel=runInNewContext(part('  function parentActivePanel(', '  function parentHistoryRow(')+';parentActivePanel',context);
 assert.match(panel("home"),/onclick="reloadPrivateLessons\(\)"/);
});
