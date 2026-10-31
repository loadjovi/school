import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {normalizeWeeklyGoals,readWeeklyGoals,isPublishedLesson,withinGoalWindow} from "../api/src/lib/musicLearningGoals.mjs";
const front=readFileSync(new URL("../app/private-lesson-confirmation.js",import.meta.url),"utf8");
const core=readFileSync(new URL("../app/app-v3.js",import.meta.url),"utf8");
const privateApi=readFileSync(new URL("../api/src/functions/privateLesson.js",import.meta.url),"utf8");
const practiceApi=readFileSync(new URL("../api/src/functions/practice.js",import.meta.url),"utf8");
const summaryApi=readFileSync(new URL("../api/src/functions/summary.js",import.meta.url),"utf8");
const testLesson=(overrides={})=>({lessonId:"private-A",studentId:"student1",lessonDate:"2026-10-29",workflowStatus:"awaiting_parent",
  weeklyPracticeGoals:["降 E 大調音階","第 18～24 小節換把練習"],teacherName:"測試個課老師",completedAt:"2026-10-29T10:00:00Z",...overrides});

test("weekly teacher goals bounded, sanitized and legacy JSON safe",()=>{
  assert.deepEqual(normalizeWeeklyGoals(["音階","  換把  ","換把",""]).goals,["音階","換把"]);
  assert.match(normalizeWeeklyGoals(["1","2","3","4"]).error,/最多/);
  assert.match(normalizeWeeklyGoals(["x".repeat(121)]).error,/120/);
  assert.match(normalizeWeeklyGoals([123]).error,/格式/);
  assert.deepEqual(readWeeklyGoals("not-json"),[]);
  assert.deepEqual(readWeeklyGoals('["音階","換把"]'),["音階","換把"]);
});
test("published private lesson and 14-day practice window are enforced",()=>{
  assert.equal(isPublishedLesson({status:"scheduled"}),false);
  assert.equal(isPublishedLesson({status:"teacher_completed"}),true);
  assert.equal(isPublishedLesson({status:"present",parentConfirmation:"confirmed"}),true);
  assert.equal(isPublishedLesson({status:"present",parentConfirmation:"issue"}),false);
  assert.equal(withinGoalWindow("2026-10-29","2026-10-31"),true);
  assert.equal(withinGoalWindow("2026-10-29","2026-11-12"),true);
  assert.equal(withinGoalWindow("2026-10-29","2026-11-13"),false);
  assert.equal(withinGoalWindow("2026-10-29","2026-10-28"),false);
});
function browserModel(){
 const state={me:{role:"parent"},student:{studentId:"student1"},privateLessons:[
   testLesson(),testLesson({lessonId:"other",studentId:"student2",lessonDate:"2026-10-30",weeklyPracticeGoals:["別人的目標"]}),
   testLesson({lessonId:"draft",lessonDate:"2026-10-30",workflowStatus:"scheduled",weeklyPracticeGoals:["尚未送出"]}),
   testLesson({lessonId:"old",lessonDate:"2026-09-20",weeklyPracticeGoals:["過期建議"]})
 ],practice:[
  {practiceDate:"2026-10-30",minutes:20,weeklyGoalText:"降 E 大調音階",weeklyGoalLessonId:"private-A",practiceContent:"慢練"},
  {practiceDate:"2026-10-31",minutes:15,weeklyGoalText:"降 E 大調音階",weeklyGoalLessonId:"private-A",practiceContent:"速度練習"}
 ]};
 const code=front.slice(front.indexOf("  function currentWeeklyLearningGoals(){"),front.indexOf("  const basePracticePage=practicePage;"));
 assert.ok(code.includes("weeklyGoalsParentPanel"));
 const ctx={state,today:()=>"2026-10-31",workflow:x=>x.workflowStatus,teacherLabel:x=>x.teacherName,
   esc:x=>String(x??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch])),
   Date,Math};
 vm.createContext(ctx);
 vm.runInContext(code+"\nthis.result={currentWeeklyLearningGoals,weeklyGoalsParentPanel,learningJourneyParentPanel}",ctx);
 return {state,methods:ctx.result};
}
test("parent sees recent published suggestions for their student, not future, stale or other-student goals",()=>{
 const {methods}=browserModel();
 assert.equal(methods.currentWeeklyLearningGoals().lessonId,"private-A");
 const page=methods.weeklyGoalsParentPanel();
 assert.match(page,/降 E 大調音階/);
 assert.match(page,/第 18～24 小節換把練習/);
 assert.match(page,/data-goal-lesson="private-A"/);
 assert.match(page,/data-goal-index="1"/);
 assert.doesNotMatch(page,/別人的目標|尚未送出|過期建議/);
});
test("optional goal-free practice works for students without lesson advice",()=>{
 const {state,methods}=browserModel();state.privateLessons=[];
 const html=methods.weeklyGoalsParentPanel();
 assert.match(html,/仍可正常自主練習/);
 assert.doesNotMatch(html,/name="weeklyGoalChoice"/);
});
test("linked practice appears in parent learning journey without implying grades",()=>{
 const {methods}=browserModel();
 const html=methods.learningJourneyParentPanel();
 assert.match(html,/我的音樂學習歷程/);
 assert.match(html,/本月已對應練習 2 次/);
 assert.match(html,/2026-10-30/);
 assert.match(html,/不代表已達成老師評量/);
});
test("teacher can save and complete all lesson editor modes with up to three weekly goal inputs",()=>{
 assert.match(front,/function weeklyGoalEditor\(x,scope\)/);
 assert.match(front,/id="\$\{scope\}WeeklyGoal_\$\{i\}"/);
 assert.equal(front.split('weeklyGoalEditor(x,"complete_"+k)').length-1,3);
 assert.match(front,/weeklyGoalEditor\(x,"active"\)/);
 assert.match(front,/update_weekly_practice_goals/);
 assert.match(front,/weeklyPracticeGoals:weeklyGoalsFromEditor\("active"\)/);
 assert.match(front,/weeklyPracticeGoals:weeklyGoalsFromEditor\("complete_"\+k\)/);
 assert.match(privateApi,/weeklyPracticeGoals:readWeeklyGoals\(e\.weeklyPracticeGoalsJson\)/);
 assert.match(privateApi,/entity\.weeklyPracticeGoalsUpdatedBy=String\(a\.email/);
});
test("practice goal submission validated by school/student partition, published status and course date",()=>{
 assert.match(core,/body\.weeklyGoal=\{lessonId:selectedGoal\.dataset\.goalLesson,index:Number\(selectedGoal\.dataset\.goalIndex\)\}/);
 assert.match(practiceApi,/tenantStudentPartition\(schoolId,id\),lessonId/);
 assert.match(practiceApi,/!isPublishedLesson\(lesson\)\|\|!withinGoalWindow/);
 assert.match(practiceApi,/weeklyGoalText:linkedGoal\?\.text\|\|""/);
 assert.match(practiceApi,/weeklyGoalLessonId:linkedGoal\?\.lessonId\|\|""/);
 assert.match(practiceApi,/weeklyGoalText:String\(x\.weeklyGoalText\|\|""\)/);
 assert.match(core,/老師建議：\$\{esc\(x\.weeklyGoalText\)\}/);
});
test("current score remains based on qualified minutes, not weekly goals",()=>{
 assert.match(summaryApi,/practiceQualifiedDays:qualifiedDays/);
 assert.match(summaryApi,/privateMonthlyScore5/);
 assert.doesNotMatch(summaryApi,/weeklyGoalText|weeklyPracticeGoals/);
 assert.match(practiceApi,/PRACTICE_QUALIFIED_MINUTES/);
});
