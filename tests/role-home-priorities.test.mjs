import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {isImportantAnnouncement,uniqueAnnouncementEvents} from "../api/src/lib/lineLatestAnnouncementsFormat.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const strip=source=>source.replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const now=Date.parse("2026-11-19T09:00:00+08:00");
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]);
const student={studentId:"990101",name:"測試學生",groupName:"A",instrument:"中提琴"};
const event=(id,extra={})=>({eventId:id,eventDate:"2026-12-09",title:id,startTime:"09:00",endTime:"12:00",status:"active",visibleToParents:true,...extra});
function feed({role="parent",rows=[],groupName="A",fails=false}={}){
 let handler;const calls=[];
 runInNewContext(strip(read("api/src/functions/parentHomeUpdates.js")),{
  app:{http:(_,route)=>{handler=route.handler}},Date:FixedDate,console,
  getTenantContext:async()=>({schoolId:"school-a",access:{role,students:[{...student,groupName}]}}),
  json:(data,status=200)=>({data,status}),isImportantAnnouncement,uniqueAnnouncementEvents,
  calendarEventsForStudent:async(...args)=>{calls.push(args);if(fails)throw Error("unavailable");return rows}
 });
 return {calls,get:id=>handler({query:new URLSearchParams({studentId:id||student.studentId})})};
}

test("parent updates use only the enrolled child and school, deduplicate reminders, and hide ended or private events",async()=>{
 const h=feed({rows:[event("普通活動"),event("重要集合通知",{note:"攜帶樂器",updatedAt:"2026-11-19"}),event("重要集合通知",{note:"duplicate"}),event("已結束",{eventDate:"2026-11-19",endTime:"08:00"}),event("不公開",{visibleToParents:false}),event("取消",{status:"cancelled"}),event("跨日",{eventDate:"2026-11-18",endDate:"2026-11-20"})]});
 const result=await h.get();assert.equal(result.status,200);
 assert.deepEqual(Array.from(result.data.events,x=>x.title),["跨日","重要集合通知","普通活動"]);
 assert.deepEqual(Array.from(result.data.announcements,x=>x.title),["重要集合通知"]);
 assert.equal(h.calls[0][0],"school-a");assert.equal(h.calls[0][1],"2026-11-19");assert.equal(h.calls[0][3].studentId,student.studentId);
 assert.equal(result.headers["Cache-Control"],"no-store");
 const denied=feed();assert.equal((await denied.get("unrelated-student")).status,403);assert.equal(denied.calls.length,0);
 const teacher=feed({role:"teacher"});assert.equal((await teacher.get()).status,403);assert.equal(teacher.calls.length,0);
 const unknown=feed({groupName:""});assert.equal((await unknown.get()).data.events.length,0);assert.equal(unknown.calls.length,0);
 assert.equal((await feed({fails:true}).get()).status,503);
});

function parentHome(){
 const pending=[],registrations=[];
 const ctx={Date:FixedDate,console,state:{me:{role:"parent",email:"parent@example.invalid",schoolId:"school-a"},page:"home",student,students:[student],practice:[],summary:{today:"2026-11-19",todayCourses:[{label:"A團分部課",time:"17:40～18:30"}]}},
  home:()=>"",nav:()=>"",navBtn:()=>"",go:async()=>{},refreshStudent:async()=>{},render:()=>{},esc,
  sessionStorage:{getItem:key=>key==="school_context_id"?"school-a":"",setItem(){}},localStorage:{getItem:()=>null},
  setTimeout:fn=>{pending.push(fn);return pending.length},clearTimeout(){},
  addEventListener(){},document:{getElementById:()=>null},location:{origin:"https://school-a.example.invalid"},
  getParentActivityRegistrations:()=>registrations,
  api:async()=>({events:[event("交流活動",{sourceModule:"fieldTrip",sourceActivityId:"exchange"})],announcements:[event("攜帶物品提醒",{note:"帶譜 <script>"})]})
 };
 ctx.window=ctx;
 for(const file of ["app/parent-activity-notice.js","app/parent-home-summary.js"])runInNewContext(read(file),ctx);
 ctx.home();return {ctx,registrations,pending};
}

test("parent home prioritizes courses, upcoming activities, important news and a practice action before statistics",async()=>{
 const {ctx}=parentHome();await ctx.refreshParentHomeUpdates();
 const html=ctx.home();
 const order=["今日課程提醒",'id="parentUpcomingActivities"','id="parentLatestNews"','id="parentPracticeAction"','id="parentUniformEventsEntry"',"本月自主練習"];
 assert.ok(order.every((x,i)=>html.includes(x)&&(!i||html.indexOf(x)>html.indexOf(order[i-1]))));
 assert.match(html,/交流活動/);assert.match(html,/攜帶物品提醒/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(html,/立即自主練習打卡/);assert.match(html,/<details[^>]*><summary><b>查看本月學習進度與上課出勤/);
 const app=read("app/app-v3.js"),start=app.indexOf("function tenantServicesEntry()"),end=app.indexOf("async function renderLogin",start);
 runInNewContext(app.slice(start,end)+";window.service=tenantServicesEntry",ctx);
 ctx.state.me.capabilities={lineAccount:true,feeCollections:true};
 assert.match(ctx.service(),/^<details/);assert.doesNotMatch(ctx.service(),/<details[^>]* open/);
 const shell=runInNewContext(app.slice(app.indexOf("function shell("),app.indexOf("function parentSelfBindPanel("))+";shell",{state:ctx.state,esc,roleText:()=>"家長",nav:()=>"",tenantServicesEntry:ctx.service});
 const page=shell(html);assert.ok(page.indexOf('id="parentAccountSettings"')>page.indexOf("本月自主練習"));
});

test("today's parent course card includes that child's private lessons and excludes a sibling's lesson",async()=>{
 const {ctx}=parentHome();await ctx.refreshParentHomeUpdates();
 ctx.state.privateLessons=[{studentId:student.studentId,lessonDate:"2026-11-19",teacherName:"今日老師",startTime:"18:30",endTime:"19:30",workflowStatus:"awaiting_parent"},{studentId:"other",lessonDate:"2026-11-19",teacherName:"其他學生老師"}];
 const html=ctx.home().split('id="parentUpcomingActivities"')[0];
 assert.match(html,/今日老師/);assert.match(html,/待家長確認/);assert.match(html,/18:30～19:30/);assert.doesNotMatch(html,/其他學生老師/);
});

test("upcoming signup links follow dynamic groups and deadlines and keep an enrolled family's future event",async()=>{
 const {ctx,registrations}=parentHome();await ctx.refreshParentHomeUpdates();
 const config=(id,extra={})=>({id,module:"fieldTrip",title:id,enabled:true,targetGroups:"A",startAt:"2026-12-09T09:00:00+08:00",...extra});
 ctx.state.parentActivityConfigs=[config("open"),config("closed",{closeAt:"2026-11-18T09:00:00+08:00"}),config("enrolled",{closeAt:"2026-11-18T09:00:00+08:00"}),config("other-team",{targetGroups:"新團"}),config("old",{startAt:"2026-11-10T09:00:00+08:00"}),config("ended-today",{startAt:"2026-11-19T07:00:00+08:00",endAt:"2026-11-19T08:00:00+08:00"}),config("calendar-ended",{module:"calendarActivity",eventDate:"2026-11-19",endTime:"08:00"})];
 registrations.push({kind:"fieldTrip",activityId:"enrolled",registrationStatus:"REGISTERED"});
 const html=ctx.home().split('id="parentUpcomingActivities"')[1].split('id="parentLatestNews"')[0];
 assert.match(html,/open/);assert.match(html,/enrolled/);assert.doesNotMatch(html,/closed|other-team|>old<|ended-today|calendar-ended/);
 assert.match(html,/activity=fieldTrip%3Aopen/);assert.match(html,/已送出報名/);
});

test("a slow activity response cannot become the next child's or school's homepage content",async()=>{
 const {ctx}=parentHome();let release;
 ctx.api=()=>new Promise(resolve=>{release=resolve});const request=ctx.refreshParentHomeUpdates();
 ctx.state.student={...student,studentId:"990102"};ctx.home();
 release({events:[event("舊學生資料")],announcements:[]});await request;
 assert.doesNotMatch(ctx.home(),/舊學生資料/);
});

function teacherHome({privateOnly=false}={}){
 const app={innerHTML:""},calls=[],ctx={Date:FixedDate,console,esc,state:{me:{role:privateOnly?"privateTeacher":"teacher",email:"teacher@example.invalid",schoolId:"school-a",capabilities:{section:!privateOnly,private:true,privateOnly},assignments:[{groupName:"A",section:"中提"}],privateStudentIds:[student.studentId]},page:"teacherHome",students:[student],teacherSetup:{profile:{}}},
  document:{getElementById:id=>id==="app"?app:null},setTimeout:()=>1,nav:()=>"",navBtn:()=>"",render:()=>{},go:async page=>{ctx.state.page=page},shell:x=>x,
  api:async url=>{calls.push(url);if(url==="/api/private-lesson")return {items:[{studentId:student.studentId,lessonDate:"2026-11-19",startTime:"18:00",endTime:"19:00",workflowStatus:"scheduled"},{lessonDate:"2026-11-18",workflowStatus:"scheduled"},{workflowStatus:"issue"}]};if(url.startsWith("/api/school-schedule"))return {items:[{courseType:"section",groupName:"A",section:"中提",courseName:"分部課"}]};return {items:[],records:[]}}
 };
 ctx.window=ctx;ctx.__roleModuleBootstrap=true;
 runInNewContext(read("app/teacher-navigation.js"),ctx);
 return {ctx,app,calls};
}

test("teacher home has direct attendance and lesson actions, actual lesson status and collapsed practice tracking",async()=>{
 const {ctx,app}=teacherHome();await ctx.refreshTeacherHome();
 assert.match(app.innerHTML,/出勤與點名/);assert.match(app.innerHTML,/個課預約與完課/);
 assert.match(app.innerHTML,/今日 1 堂/);assert.match(app.innerHTML,/待補登 1 堂/);assert.match(app.innerHTML,/家長回報 1 筆/);
 assert.match(app.innerHTML,/18:00～19:00/);assert.match(app.innerHTML,/<details class="card"><summary><b>📚 學生練習追蹤/);
 const privateTeacher=teacherHome({privateOnly:true});await privateTeacher.ctx.refreshTeacherHome();
 assert.doesNotMatch(privateTeacher.app.innerHTML,/出勤與點名|今日點名完成度/);assert.match(privateTeacher.app.innerHTML,/今日 1 堂/);
});

test("teacher lesson read errors remain visible and returning home refreshes the status",async()=>{
 const {ctx,app,calls}=teacherHome();await ctx.refreshTeacherHome();
 const before=calls.filter(x=>x==="/api/private-lesson").length;await ctx.go("teacherHome");
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(x=>x==="/api/private-lesson").length,before+1);
 const base=ctx.api;ctx.api=async url=>{if(url==="/api/private-lesson")throw Error("unavailable");return base(url)};
 await ctx.refreshTeacherHome();assert.match(app.innerHTML,/個課狀態暫時無法讀取/);assert.doesNotMatch(app.innerHTML,/今日 0 堂/);
});
