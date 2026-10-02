import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const day=offset=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Date.now()+offset*86400000));
const read=name=>readFileSync(new URL(`../src/functions/${name}.js`,import.meta.url),"utf8");
const school={rowKey:"host",schoolName:"支援校",status:"active"},home={rowKey:"home",schoolName:"來源校",status:"active"};
const teacher={teacherEmail:"supply@example.org",teacherName:"支援老師",status:"active"};

function supportFixture(){
  const rows={tenantTeacherSupport:new Map(),globalTeacherEvent:new Map()},handlers={};let role="globalAdmin",seq=0;
  const table=name=>({createEntity:async x=>{rows[name].set(`${x.partitionKey}|${x.rowKey}`,x)},getEntity:async(pk,rk)=>{const x=rows[name].get(`${pk}|${rk}`);if(!x)throw {statusCode:404};return x},updateEntity:async x=>{const key=`${x.partitionKey}|${x.rowKey}`;rows[name].set(key,{...rows[name].get(key),...x})}});
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getAccess:async()=>({authenticated:true,role,capabilities:{globalAdmin:role==="globalAdmin"},email:"global@example.org"}),json:(jsonBody,status=200)=>({status,jsonBody}),ensureTenantTables:async()=>{},table,rowKey:prefix=>`${prefix}_${++seq}`,tenantIdValue:x=>String(x||""),listTenantDirectory:async()=>[school,home],getTenantDirectory:async id=>[school,home].find(x=>x.rowKey===id),listTeacherDirectory:async id=>id==="home"?[teacher]:[],getTeacherDirectory:async(email,id)=>id==="home"&&email===teacher.teacherEmail?teacher:null,listTeacherSupport:async(id,from="",to="")=>[...rows.tenantTeacherSupport.values()].filter(x=>x.schoolId===id&&(!from||x.endDate>=from)&&(!to||x.startDate<=to)),listGlobalTeacherEvents:async(from="",to="")=>[...rows.globalTeacherEvent.values()].filter(x=>(!from||x.eventDate>=from)&&(!to||x.eventDate<=to)),writeGlobalAudit:async()=>{}};
  const src=read("globalTeacherSupport");runInNewContext(src.slice(src.indexOf("const clean=")),context);
  return {call:(method,body)=>handlers.globalTeacherSupport({method,json:async()=>body}),rows,setRole:value=>{role=value}};
}

test("Global assignment is scoped, duplicate assignments fail, and revocation preserves its audit row",async()=>{
  const f=supportFixture();f.setRole("teacher");assert.equal((await f.call("GET")).status,403);f.setRole("globalAdmin");
  const input={action:"assign",sourceSchoolId:"home",targetSchoolId:"host",teacherEmail:teacher.teacherEmail,courseType:"section",groupName:"A",section:"小提一部",startDate:day(0),endDate:day(2),reason:"教師請假"};
  const created=await f.call("POST",input);assert.equal(created.status,201);
  assert.equal((await f.call("POST",input)).status,409);
  assert.equal((await f.call("GET")).jsonBody.schools.find(x=>x.schoolId==="host").assignments.length,1);
  assert.equal((await f.call("PATCH",{action:"revokeAssignment",targetSchoolId:"host",assignmentId:created.jsonBody.item.assignmentId})).status,200);
  assert.equal([...f.rows.tenantTeacherSupport.values()][0].status,"revoked");
});

test("joint event hours require per-teacher confirmation, and overlap is rejected",async()=>{
  const f=supportFixture(),input={action:"createEvent",title:"七校聯演",eventDate:day(-1),startTime:"09:00",endTime:"11:00",participants:[{schoolId:"home",email:teacher.teacherEmail}]};
  const created=await f.call("POST",input);assert.equal(created.status,201);assert.equal(created.jsonBody.item.participants[0].minutes,0);
  assert.equal((await f.call("POST",{...input,title:"重疊活動",startTime:"10:00",endTime:"12:00"})).status,409);
  const eventId=created.jsonBody.item.eventId;
  assert.equal((await f.call("PATCH",{action:"confirmEvent",eventId,minutesByTeacher:[{email:teacher.teacherEmail,minutes:0}]})).status,400);
  assert.equal((await f.call("PATCH",{action:"confirmEvent",eventId,minutesByTeacher:[{email:teacher.teacherEmail,minutes:90}]})).jsonBody.item.participants[0].minutes,90);
  assert.equal((await f.call("PATCH",{action:"cancelEvent",eventId})).jsonBody.item.status,"cancelled");
});

test("Global school access distinguishes active teachers, admin-only accounts, and disabled teachers",async()=>{
  const handlers={},sid="school-a";
  const admins=[
    {partitionKey:"teacher@example.org",schoolId:sid,role:"schoolAdmin",status:"active"},
    {partitionKey:"adminonly@example.org",schoolId:sid,role:"schoolAdmin",status:"active"},
    {partitionKey:"disabled@example.org",schoolId:sid,role:"schoolAdmin",status:"active"},
    {partitionKey:"revoked@example.org",schoolId:sid,role:"schoolAdmin",status:"inactive"}
  ];
  const teachers=[
    {teacherEmail:"teacher@example.org",teacherName:"老師甲",status:"active"},
    {teacherEmail:"teacheronly@example.org",teacherName:"老師乙",status:"active"},
    {teacherEmail:"disabled@example.org",teacherName:"老師丙",status:"inactive"}
  ];
  let global=true;
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getAccess:async()=>({authenticated:true,capabilities:{globalAdmin:global},email:"global@example.org"}),json:(body,status=200)=>({status,jsonBody:body}),tenantIdValue:x=>String(x||""),getTenantDirectory:async id=>id===sid?{rowKey:sid}:null,listTenantAdmins:async(id,status)=>{assert.equal(id,sid);assert.equal(status,"");return admins},listTeacherDirectory:async id=>{assert.equal(id,sid);return teachers},Map,Set};
  const src=read("tenantManagement");runInNewContext(src.slice(src.indexOf("function clean(")),context);
  const request={method:"GET",query:new URLSearchParams({schoolId:sid})};
  global=false;assert.equal((await handlers.tenantAdmins(request)).status,403);
  global=true;
  const response=await handlers.tenantAdmins(request);
  assert.equal(response.status,200);
  assert.deepEqual(response.jsonBody.items.map(x=>[x.email,x.teacherStatus]),[
    ["teacher@example.org","active"],["adminonly@example.org","none"],["disabled@example.org","inactive"],["revoked@example.org","none"]
  ]);
  assert.deepEqual(response.jsonBody.teachers.map(x=>[x.email,x.hasSchoolAdmin]),[
    ["teacher@example.org",true],["teacheronly@example.org",false],["disabled@example.org",true]
  ]);
});

test("Global dashboard shows school backend access beside teacher hours and in school management",async()=>{
  const sid="school-a",root={innerHTML:""};
  const admins=[{email:"teacher@example.org",status:"active",teacherName:"老師甲",teacherStatus:"active"},{email:"adminonly@example.org",status:"active",teacherName:"",teacherStatus:"none"}];
  const teachers=[{email:"teacher@example.org",teacherName:"老師甲",status:"active",hasSchoolAdmin:true},{email:"teacheronly@example.org",teacherName:"老師乙",status:"active",hasSchoolAdmin:false}];
  const report={month:"2026-10",schools:[{schoolId:sid,schoolName:"測試校",status:"active",teachers:[{teacherEmail:"teacher@example.org",teacherKey:"teacher@example.org",teacherName:"老師甲",totalMinutes:60,totalHours:1,hasSchoolAdmin:true,teacherAccountStatus:"active",course:{}}],schoolAdmins:admins,summary:{},courseSummary:{}}],totals:{}};
  const api=async url=>url.startsWith("/api/tenant-admins?")?{items:admins,teachers}:url.startsWith("/api/global-attendance?")?report:url==="/api/global-dashboard"?{schoolCount:1,schools:[{schoolId:sid,schoolName:"測試校",status:"active",teacherStatus:{active:2},todayAttendance:{},schoolAdminCount:2}]}:url==="/api/tenant-directory"?{items:[{schoolId:sid,schoolName:"測試校",status:"active"}]}:url==="/api/tenant-onboarding"?{items:[]}:url==="/api/global-teacher-support"?{schools:[],events:[]}:{};
  const state={page:"contextSelect",me:{role:"globalAdmin",capabilities:{globalAdmin:true},email:"global@example.org"}};
  const context={state,document:{getElementById:id=>id==="app"?root:id==="globalTenantStyles"?{}:null,querySelector:()=>null},sessionStorage:{getItem:()=>null},window:null,api,shell:x=>x,nav:()=>"",go:()=>{},render:()=>{},setTimeout:()=>{},esc:x=>String(x),Intl,Date};context.window=context;
  runInNewContext(readFileSync(new URL("../../app/global-tenant-admin.js",import.meta.url),"utf8"),context);
  await context.openGlobalTenant();
  assert.match(root.innerHTML,/僅後台帳號：adminonly@example.org/);
  assert.match(root.innerHTML,/測試校：老師＋學校後台/);
  await context.selectGlobalSchool(sid);
  assert.match(root.innerHTML,/僅學校後台（未建本校老師帳號）/);
  assert.match(root.innerHTML,/teacheronly@example.org｜只有老師權限/);
});

test("month-end report credits admin-entered class to substitute and performance to its home school",async()=>{
  const handlers={},sectionRow={studentId:"s1",rowKey:"s1",eventDate:"2026-09-29",groupName:"A",section:"小提一部",status:"present",minutes:45,teacher:"admin@example.org",teacherName:"行政",actorRole:"admin",createdAt:"2026-09-29T03:00:00Z"};
  const support={schoolId:"host",teacherEmail:teacher.teacherEmail,teacherName:teacher.teacherName,courseType:"section",groupName:"A",section:"小提一部",startDate:"2026-09-29",endDate:"2026-09-30",status:"active"};
  const event={rowKey:"joint",title:"七校聯演",eventDate:"2026-09-29",status:"confirmed",participants:JSON.stringify([{schoolId:"home",email:teacher.teacherEmail,teacherName:teacher.teacherName,minutes:90}])};
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getAccess:async()=>({authenticated:true,capabilities:{globalAdmin:true}}),json:(jsonBody,status=200)=>({status,jsonBody}),ensureTenantTables:async()=>{},listTenantDirectory:async()=>[school,home],listTeacherDirectory:async id=>id==="home"?[teacher]:[{teacherEmail:"owner@example.org",teacherName:"原任老師",status:"active"}],listTenantAdmins:async id=>[{partitionKey:id==="home"?teacher.teacherEmail:"adminonly@example.org",schoolId:id,role:"schoolAdmin",status:"active"}],listTeacherSupport:async id=>id==="host"?[support]:[],listGlobalTeacherEvents:async()=>[event],listActivityRange:async(type,id)=>type==="section"&&id==="host"?[sectionRow]:[],activityStudentId:x=>x.studentId,table:name=>({listEntities:async function*(){if(name==="tenantTeacherProfile")yield {teacherEmail:"owner@example.org",displayName:"原任老師",sectionAssignments:JSON.stringify([{groupName:"A",section:"小提一部"}])}}})};
  const src=read("tenantManagement");runInNewContext(src.slice(src.indexOf("function clean(")),context);
  const result=await handlers.globalAttendance({query:new URLSearchParams({month:"2026-09"})});assert.equal(result.status,200);
  const host=result.jsonBody.schools.find(x=>x.schoolId==="host"),homeReport=result.jsonBody.schools.find(x=>x.schoolId==="home");
  assert.equal(host.audit.find(x=>x.courseType==="section").teacherEmail,teacher.teacherEmail);
  assert.equal(homeReport.teachers.find(x=>x.teacherEmail===teacher.teacherEmail).course.performance.minutes,90);
  assert.equal(homeReport.teachers.find(x=>x.teacherEmail===teacher.teacherEmail).hasSchoolAdmin,true);
  assert.equal(host.schoolAdmins[0].teacherStatus,"none");
  assert.equal(result.jsonBody.totals.totalTeachingMinutes,135);
});

test("a same-school section merge counts one class and credits the receiving teacher",async()=>{
  const handlers={},receiving="receiver@example.org",absent="absent@example.org";
  const sectionRows=[
    {studentId:"target-student",rowKey:"t1",eventDate:"2026-09-29",groupName:"A",section:"小提二部",status:"present",minutes:45,teacher:"admin@example.org",actorRole:"admin",createdAt:"2026-09-29T03:00:00Z"},
    {studentId:"source-student",rowKey:"s1",eventDate:"2026-09-29",groupName:"A",section:"小提一部",mergeTargetSection:"小提二部",mergeTeacherEmail:receiving,mergeTeacherName:"接課老師",status:"present",minutes:45,teacher:"admin@example.org",actorRole:"admin",createdAt:"2026-09-29T03:00:00Z"}
  ];
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getAccess:async()=>({authenticated:true,capabilities:{globalAdmin:true}}),json:(jsonBody,status=200)=>({status,jsonBody}),ensureTenantTables:async()=>{},listTenantDirectory:async()=>[school],listTeacherDirectory:async()=>[{teacherEmail:receiving,teacherName:"接課老師",status:"active"},{teacherEmail:absent,teacherName:"請假老師",status:"active"}],listTenantAdmins:async()=>[],listTeacherSupport:async()=>[],listGlobalTeacherEvents:async()=>[],listActivityRange:async type=>type==="section"?sectionRows:[],activityStudentId:x=>x.studentId,table:name=>({listEntities:async function*(){if(name==="tenantTeacherProfile"){yield {teacherEmail:receiving,displayName:"接課老師",sectionAssignments:JSON.stringify([{groupName:"A",section:"小提二部"}])};yield {teacherEmail:absent,displayName:"請假老師",sectionAssignments:JSON.stringify([{groupName:"A",section:"小提一部"}])}}}})};
  runInNewContext(read("tenantManagement").slice(read("tenantManagement").indexOf("function clean(")),context);
  const result=await handlers.globalAttendance({query:new URLSearchParams({month:"2026-09"})});
  assert.equal(result.status,200);
  const report=result.jsonBody.schools[0];
  assert.equal(report.courseSummary.section.sessions,1);
  assert.equal(report.courseSummary.section.minutes,45);
  assert.equal(report.audit[0].teacherEmail,receiving);
  assert.equal(report.audit[0].section,"小提二部");
  assert.equal(report.audit[0].mergedSections[0],"小提一部");
  assert.equal(report.audit[0].attendance.total,2);
});
