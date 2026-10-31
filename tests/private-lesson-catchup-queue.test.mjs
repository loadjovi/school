import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../app/private-lesson-confirmation.js",import.meta.url),"utf8");
const backend=readFileSync(new URL("../api/src/functions/privateLesson.js",import.meta.url),"utf8");
const today="2026-10-30";
const lesson=(lessonId,lessonDate,workflowStatus,studentId="s1")=>({lessonId,lessonDate,workflowStatus,studentId,startTime:"18:00",endTime:"19:00",lessonContent:"",status:workflowStatus==="scheduled"?"scheduled":"teacher_completed",teacherName:"測試老師"});
const rows=[
 lesson("oct29","2026-10-29","scheduled"),
 lesson("oct31","2026-10-31","scheduled"),
 lesson("issue1","2026-10-25","issue","s2"),
 ...Array.from({length:57},(_,i)=>lesson("waiting"+i,"2026-10-28","awaiting_parent","p"+i)),
 lesson("closed","2026-10-21","completed")
];
const flow=x=>x.workflowStatus;
const catchup=x=>flow(x)==="scheduled"&&x.lessonDate<today;
const esc=x=>String(x??"");
const fragment=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b)};

test("teacher dashboard does not bury an old incomplete lesson behind 57 parent-pending records",()=>{
 const state={privateLessons:rows,activePrivateLessonId:"",showPrivateParentWaiting:false,showPrivateHistory:false};
 const box={innerHTML:""};
 const ctx={state,sortedLessons:()=>rows,workflow:flow,needsLessonCatchup:catchup,teacherLessonRow:x=>'<article data-lesson="'+x.lessonId+'"></article>',document:{getElementById:()=>box},window:{}};
 vm.createContext(ctx);
 vm.runInContext(fragment("  function teacherHistoryHtml(){","  window.reloadPrivateLessons=")+"\nthis.teacherHistoryHtml=teacherHistoryHtml;",ctx);
 const html=ctx.teacherHistoryHtml();
 assert.match(html,/老師需處理（3 筆，2 筆需補登或回覆）/);
 assert.match(html,/data-lesson="oct29"/);
 assert.match(html,/data-lesson="oct31"/);
 assert.match(html,/data-lesson="issue1"/);
 assert.match(html,/待家長確認（57 筆）/);
 assert.doesNotMatch(html,/data-lesson="waiting0"/);
 assert.doesNotMatch(html,/data-lesson="closed"/);
 ctx.window.togglePrivateParentWaiting();
 assert.match(box.innerHTML,/data-lesson="waiting0"/);
 assert.match(box.innerHTML,/data-lesson="waiting56"/);
 ctx.window.togglePrivateHistory();
 assert.match(box.innerHTML,/data-lesson="closed"/);
 assert.equal(rows.find(x=>x.lessonId==="waiting0").workflowStatus,"awaiting_parent");
});

test("quick student picker prioritizes an overdue October 29 lesson ahead of October 31 booking",()=>{
 const state={me:{privateStudentIds:["s1"]},students:[{studentId:"s1",name:"測試學生",groupName:"A",instrument:"小提琴"}],privateLessons:rows,activePrivateLessonId:"",privateBookingStudentId:"",suppressAutoPrivateLesson:true};
 const ctx={state,today:()=>today,nowTime:()=>"20:00",shiftDate:()=> "2026-10-31",teacherHistoryHtml:()=>"<div>tasks</div>",workflow:flow,needsLessonCatchup:catchup,esc,teacherAccount:()=>true,startPrivatePoll:()=>{},setTimeout:()=>{},currentStudentName:()=>""};
 vm.createContext(ctx);
 vm.runInContext("let privatePage;\n"+fragment("  privatePage=function(){","  function activeLessonHtml")+"\nthis.getPage=privatePage;",ctx);
 const html=ctx.getPage();
 assert.match(html,/尚未完課：2026-10-29/);
 assert.match(html,/openTeacherCatchup\('oct29'\)/);
 assert.match(html,/✏️ 補登此堂/);
 assert.match(html,/老師待補登／處理/);
 assert.match(html,/已交家長確認/);
 assert.match(html,/老師個課處理與紀錄/);
});

test("overdue class has an independent content editor and save control",()=>{
 const state={expandedPrivateLessonId:"oct29"};
 const ctx={state,workflow:flow,needsLessonCatchup:catchup,teacherLessonHeader:()=>"<header></header>",weeklyGoalEditor:()=>"<div>weekly goals</div>",studentMetaLine:()=>"",currentStudentName:()=> "測試學生",lessonDomKey:x=>x,lessonSummary:()=>"<section></section>",canChange:()=>false,canComplete:()=>true,today:()=>today,esc,workflowClass:{scheduled:"warn"},workflowText:{scheduled:"已預約"}};
 vm.createContext(ctx);
 vm.runInContext(fragment("  function teacherLessonRow(x){","  window.toggleTeacherPrivateLesson=")+"\nthis.getLessonRow=teacherLessonRow;",ctx);
 const html=ctx.getLessonRow(rows[0]);
 assert.match(html,/本堂尚未完成老師端登記/);
 assert.match(html,/completeContent_oct29/);
 assert.match(html,/先儲存上課內容/);
 assert.match(html,/savePrivateLessonContent\('s1','oct29'\)/);
 assert.match(html,/completePrivateLesson\('s1','oct29'\)/);
 assert.match(html,/新建立的下一堂預約不影響本筆紀錄/);
});

test("backend allows past scheduled lesson content updates but rejects future lesson modifications",()=>{
 const guard=backend.split("\n").find(s=>s.includes("須於個課開始後才能填寫"));
 assert.ok(guard,"must enforce lesson start time and allow historic scheduled sessions");
 const fun=vm.runInNewContext("(function(isAdmin,entity,clock){const json=(body,status)=>({body,status});"+guard+"return {allowed:true}})");
 assert.equal(fun(false,{eventDate:"2026-10-29",startTime:"18:00"},{date:today,time:"20:00"}).allowed,true);
 assert.equal(fun(false,{eventDate:"2026-10-31",startTime:"18:00"},{date:today,time:"20:00"}).status,409);
 assert.equal(fun(false,{eventDate:today,startTime:"21:00"},{date:today,time:"20:00"}).status,409);
 assert.equal(fun(true,{eventDate:"2026-10-31",startTime:"18:00"},{date:today,time:"20:00"}).allowed,true);
 assert.match(backend,/if\(isTeacher\)\{/);
 assert.match(backend,/只能異動自己建立的個別課預約/);
 assert.match(backend,/entity\.status="teacher_completed"/);
 assert.match(backend,/entity\.parentConfirmation="pending"/);
 assert.match(backend,/if\(!teacherCompletionStatuses\.has/);
});
