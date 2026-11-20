import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../app/private-lesson-confirmation.js",import.meta.url),"utf8");
const esc=value=>String(value??"").replaceAll("<","&lt;").replaceAll(">","&gt;");
function part(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to)}

test("parent home replaces the pending form with saved LINE completion and escaped review",()=>{
 const row={lessonId:"lesson1",studentId:"student1",workflowStatus:"completed",parentConfirmedVia:"line",parentConfirmedAt:new Date().toISOString(),teacherReview:"<script>review</script>"};
 const context={state:{me:{role:"parent"},student:{studentId:"student1"}},window:{},sortedLessons:()=>[row],workflow:x=>x.workflowStatus,parentActivePanel:()=>"",lessonSummary:x=>esc(x.teacherReview)};
 runInNewContext(part('  window.privateLessonParentPanels=', '  function currentWeeklyLearningGoals()'),context);
 const html=context.window.privateLessonParentPanels("home");
 assert.match(html,/已透過 LINE 確認完成上課/);assert.match(html,/已結案，不需重複確認/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 context.state.me.role="teacher";assert.equal(context.window.privateLessonParentPanels("home"),"");context.state.me.role="parent";
 row.parentConfirmedAt="2000-01-01T00:00:00Z";assert.equal(context.window.privateLessonParentPanels("home"),"");
});

test("only the waiting parent card exposes the teacher's LINE resend action",()=>{
 const context={state:{expandedPrivateLessonId:"lesson1"},workflow:x=>x.workflowStatus,workflowClass:{},workflowText:{},
  needsLessonCatchup:()=>false,lessonDomKey:x=>x,currentStudentName:()=>"測試學生",studentMetaLine:()=>"",weeklyGoalEditor:()=>"",teacherLessonHeader:()=>"",lessonSummary:()=>"",esc};
 const row=runInNewContext(part('  function teacherLessonRow(x){','  window.toggleTeacherPrivateLesson=')+';teacherLessonRow',context);
 assert.match(row({lessonId:"lesson1",studentId:"student1",workflowStatus:"awaiting_parent"}),/重發完課 LINE 通知/);
 assert.doesNotMatch(row({lessonId:"lesson1",studentId:"student1",workflowStatus:"completed"}),/重發完課 LINE 通知/);
});

test("rapid clicks produce one LINE request and provider failure is never labeled delivered",async()=>{
 const messages=[],requests=[];let release;
 const context={window:{},currentStudentName:()=>"測試學生",confirm:()=>true,
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
});

test("parent pending panel offers a manual status refresh without requiring another confirmation",()=>{
 const context={state:{me:{role:"parent"},student:{studentId:"student1"}},sortedLessons:()=>[{workflowStatus:"awaiting_parent"}],workflow:x=>x.workflowStatus,parentLessonRow:()=>"<article>pending</article>"};
 const panel=runInNewContext(part('  function parentActivePanel(', '  function parentHistoryRow(')+';parentActivePanel',context);
 assert.match(panel("home"),/onclick="reloadPrivateLessons\(\)"/);
});
