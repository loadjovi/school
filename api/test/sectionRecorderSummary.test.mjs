import test from "node:test";
import assert from "node:assert/strict";
import { sectionRecorderSummary } from "../src/lib/sectionRecorderSummary.js";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("section recorder summary uses the latest student status and lists all actual recorders",()=>{
  const base={eventDate:"2026-10-01",groupName:"B",section:"小提一部"};
  const rows=[
    {...base,studentId:"1",status:"absent",teacher:"old@example.org",teacherName:"舊老師",createdAt:"2026-10-01T08:00:00Z",rowKey:"1"},
    {...base,studentId:"1",status:"present",teacher:"a@example.org",createdAt:"2026-10-01T08:10:00Z",rowKey:"2"},
    {...base,studentId:"2",status:"late",teacher:"admin@example.org",actorRole:"admin",createdAt:"2026-10-01T08:11:00Z",rowKey:"3"},
    {...base,studentId:"3",section:"小提二部",mergeTargetSection:"小提一部",status:"leave",teacher:"a@example.org",createdAt:"2026-10-01T08:12:00Z",rowKey:"4"},
    {...base,studentId:"4",status:"cancelled",teacher:"old@example.org",createdAt:"2026-10-01T08:13:00Z",rowKey:"5"}
  ];
  const result=sectionRecorderSummary(rows,new Map([["a@example.org","接課老師"],["admin@example.org","校方人員"]]),new Map([["2",{name:"林同學"}]]));
  assert.equal(result.length,1);
  const entry=result[0];
  assert.equal(entry.eventDate,"2026-10-01");
  assert.equal(entry.groupName,"B");
  assert.equal(entry.section,"小提一部");
  assert.deepEqual(entry.mergedSections,["小提二部"]);
  assert.deepEqual([entry.recorded,entry.present,entry.late,entry.leave,entry.absent],[3,1,1,1,0]);
  assert.deepEqual(entry.lateStudents,[{studentId:"2",name:"林同學",sourceSection:"小提一部"}]);
  assert.deepEqual(entry.absentStudents,[]);
  assert.deepEqual(entry.recorders,[
    {email:"a@example.org",name:"接課老師",role:"teacher",count:2},
    {email:"admin@example.org",name:"校方人員",role:"admin",count:1}
  ]);
});

test("section student alerts follow corrections and identify the original section of a merged class",()=>{
  const base={eventDate:"2026-10-02",groupName:"B",section:"小提一部",teacher:"teacher@example.org"};
  const rows=[
    {...base,studentId:"1",status:"absent",createdAt:"2026-10-02T08:00:00Z",rowKey:"1"},
    {...base,studentId:"1",status:"late",createdAt:"2026-10-02T08:20:00Z",rowKey:"2"},
    {...base,studentId:"2",section:"中提",mergeTargetSection:"小提一部",status:"absent",createdAt:"2026-10-02T08:25:00Z",rowKey:"3"},
    {...base,studentId:"3",status:"late",createdAt:"2026-10-02T08:10:00Z",rowKey:"4"},
    {...base,studentId:"3",status:"cancelled",createdAt:"2026-10-02T08:30:00Z",rowKey:"5"}
  ];
  const students=new Map([["1",{name:"王同學"}],["2",{name:"張同學"}],["3",{name:"李同學"}]]);
  const [entry]=sectionRecorderSummary(rows,new Map(),students);
  assert.deepEqual([entry.recorded,entry.late,entry.absent],[2,1,1]);
  assert.deepEqual(entry.lateStudents,[{studentId:"1",name:"王同學",sourceSection:"小提一部"}]);
  assert.deepEqual(entry.absentStudents,[{studentId:"2",name:"張同學",sourceSection:"中提"}]);
});

test("same teacher on two sections stays in two classes and the latest cancellation removes a student",()=>{
  const rows=[
    {studentId:"1",eventDate:"2026-10-02",groupName:"A",section:"大提",status:"present",teacher:"one@example.org",createdAt:"2026-10-02T01:00:00Z",rowKey:"1"},
    {studentId:"1",eventDate:"2026-10-02",groupName:"A",section:"大提",status:"cancelled",teacher:"one@example.org",createdAt:"2026-10-02T02:00:00Z",rowKey:"2"},
    {studentId:"2",eventDate:"2026-10-02",groupName:"A",section:"中提",status:"present",teacher:"one@example.org",createdAt:"2026-10-02T02:00:00Z",rowKey:"3"}
  ];
  const result=sectionRecorderSummary(rows);
  assert.deepEqual(result.map(x=>x.section),["中提"]);
  assert.equal(result[0].recorders[0].count,1);
});

test("monthly section summary is school-admin only and uses recorded teacher identity",async()=>{
  const handlers={};
  const source=readFileSync(new URL("../src/functions/attendanceReport.js",import.meta.url),"utf8");
  let role="teacher";
  const rows=[{studentId:"1",eventDate:"2026-10-01",groupName:"B",section:"小提一部",status:"present",teacher:"t@example.org",createdAt:"2026-10-01T09:00:00Z",rowKey:"1"}];
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},sectionRecorderSummary,json:(body,status=200)=>({status,jsonBody:body}),getTenantContext:async()=>({access:{role},schoolId:"school-a"}),ensureTenantTables:async()=>{},listActivityRange:async(key,schoolId,start,end)=>{assert.equal(key,"section");assert.equal(schoolId,"school-a");assert.equal(start,"2026-10-01");assert.equal(end,"2026-10-31");return rows},listStudentMaster:async(status,schoolId)=>{assert.equal(status,"");assert.equal(schoolId,"school-a");return [{rowKey:"1",studentName:"學生甲",groupName:"B",section:"小提一部"}]},activityStudentId:r=>r.studentId,getStudentAliasInfo:async id=>({canonicalStudentId:id}),getTeacherDirectory:async()=>({teacherName:"王老師"}),Map,Set,Date};
  runInNewContext(source.slice(source.indexOf("function clean(")),context);
  const request=month=>({query:new URLSearchParams({month})});
  assert.equal((await handlers.sectionRecorderSummary(request("2026-10"))).status,403);
  role="admin";
  assert.equal((await handlers.sectionRecorderSummary(request("2026-13"))).status,400);
  const response=await handlers.sectionRecorderSummary(request("2026-10"));
  assert.equal(response.status,200);
  assert.equal(response.jsonBody.items.length,1);
  assert.equal(response.jsonBody.items[0].recorders[0].name,"王老師");
});

test("daily school admin courses include named absent and late students from the same school",async()=>{
  const handlers={},source=readFileSync(new URL("../src/functions/attendanceReport.js",import.meta.url),"utf8");
  const date="2026-10-02",schoolId="school-a";
  const masters=[
    {rowKey:"1",studentName:"林同學",groupName:"B",section:"小提一部",status:"active"},
    {rowKey:"2",studentName:"張同學",groupName:"B",section:"小提一部",status:"active"}
  ];
  const records=[
    {studentId:"1",eventDate:date,groupName:"B",section:"小提一部",status:"late",teacher:"teacher@example.org",createdAt:"2026-10-02T09:00:00Z",rowKey:"1"},
    {studentId:"2",eventDate:date,groupName:"B",section:"小提一部",status:"absent",teacher:"teacher@example.org",createdAt:"2026-10-02T09:00:00Z",rowKey:"2"}
  ];
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},sectionRecorderSummary,json:(body,status=200)=>({status,jsonBody:body}),getTenantContext:async()=>({access:{role:"admin"},schoolId}),ensureTenantTables:async()=>{},listStudentMaster:async(_,sid)=>{assert.equal(sid,schoolId);return masters},listUserStudentMappings:async(_,sid)=>{assert.equal(sid,schoolId);return []},listActivityRange:async(key,sid,_start,_end,day)=>{assert.equal(sid,schoolId);assert.equal(day,date);return key==="section"?records:[]},activityStudentId:r=>r.studentId,getStudentAliasInfo:async id=>({canonicalStudentId:id}),getTeacherDirectory:async()=>({teacherName:"王老師"}),resolveSchoolCourses:async(sid,day)=>{assert.equal(sid,schoolId);assert.equal(day,date);return [{courseType:"section",scheduleId:"section-b",courseName:"B團分部課",groupName:"B",section:"小提一部",startTime:"17:40",endTime:"18:30",effectiveStatus:"active"}]},Map,Set,Date};
  runInNewContext(source.slice(source.indexOf("function clean(")),context);
  const response=await handlers.dailyFollowup({method:"GET",query:new URLSearchParams({date})});
  assert.equal(response.status,200);
  const [course]=response.jsonBody.courseSummary;
  assert.equal(course.absent,1);
  assert.equal(course.late,1);
  assert.equal(course.studentAlerts.absent[0].name,"張同學");
  assert.equal(course.studentAlerts.late[0].name,"林同學");
  assert.equal(course.sectionRecorders[0].recorders[0].name,"王老師");
});

test("school admin dashboard shows who actually took attendance, including administrator assistance",()=>{
  const root={innerHTML:""},main={},state={me:{role:"admin"},page:"admin",adminOps:{date:"2026-10-01",settings:{emailNotificationsEnabled:false,emailServiceConfigured:false},followup:{date:"2026-10-01",courseSummary:[{key:"section",label:"B團分部課",groups:["B"],time:"17:40–18:30",expected:2,recorded:2,attended:1,sectionRecorders:[{groupName:"B",section:"小提一部",recorders:[{name:"王老師",role:"teacher",count:1},{name:"陳主任",role:"admin",count:1}]}],studentAlerts:{late:[{studentId:"1",name:"林同學",groupName:"B",section:"小提一部"}],absent:[{studentId:"2",name:"張同學",groupName:"B",section:"小提一部"}]}}],privateLessonDetails:[],items:[],counts:{},attendanceCounts:{}},sectionSummaryOpen:true,sectionMonth:"2026-10",sectionSummary:{month:"2026-10",items:[{eventDate:"2026-10-01",groupName:"B",section:"小提一部",recorded:2,present:0,late:1,absent:1,lateStudents:[{studentId:"1",name:"林同學",sourceSection:"小提一部"}],absentStudents:[{studentId:"2",name:"張同學",sourceSection:"中提"}],recorders:[{name:"王老師",role:"teacher",count:1},{name:"陳主任",role:"admin",count:1}]}]}}};
  const context={state,window:null,document:{querySelector:selector=>selector===".main"?main:null,getElementById:id=>id==="adminOperations"?root:null},render:()=>{},setTimeout:callback=>callback(),esc:value=>String(value),api:async()=>{},toast:()=>{}};
  context.window=context;
  const src=readFileSync(new URL("../../app/admin-operations.js",import.meta.url),"utf8");
  runInNewContext(src,context);
  assert.match(root.innerHTML,/實際點名者/);
  assert.match(root.innerHTML,/王老師（老師） 1 人/);
  assert.match(root.innerHTML,/陳主任（校方管理員代點名） 1 人/);
  assert.match(root.innerHTML,/分部課點名總表/);
  assert.match(root.innerHTML,/缺席 1/);
  assert.match(root.innerHTML,/張同學（中提）/);
  assert.match(root.innerHTML,/遲到 1/);
  assert.match(root.innerHTML,/林同學（B團／小提一部）/);
});
