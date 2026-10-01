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
  const result=sectionRecorderSummary(rows,new Map([["a@example.org","接課老師"],["admin@example.org","校方人員"]]));
  assert.equal(result.length,1);
  const entry=result[0];
  assert.equal(entry.eventDate,"2026-10-01");
  assert.equal(entry.groupName,"B");
  assert.equal(entry.section,"小提一部");
  assert.deepEqual(entry.mergedSections,["小提二部"]);
  assert.deepEqual([entry.recorded,entry.present,entry.late,entry.leave,entry.absent],[3,1,1,1,0]);
  assert.deepEqual(entry.recorders,[
    {email:"a@example.org",name:"接課老師",role:"teacher",count:2},
    {email:"admin@example.org",name:"校方人員",role:"admin",count:1}
  ]);
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
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},sectionRecorderSummary,json:(body,status=200)=>({status,jsonBody:body}),getTenantContext:async()=>({access:{role},schoolId:"school-a"}),ensureTenantTables:async()=>{},listActivityRange:async(key,schoolId,start,end)=>{assert.equal(key,"section");assert.equal(schoolId,"school-a");assert.equal(start,"2026-10-01");assert.equal(end,"2026-10-31");return rows},activityStudentId:r=>r.studentId,getStudentAliasInfo:async id=>({canonicalStudentId:id}),getTeacherDirectory:async()=>({teacherName:"王老師"}),Map,Set,Date};
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

test("school admin dashboard shows who actually took attendance, including administrator assistance",()=>{
  const root={innerHTML:""},main={},state={me:{role:"admin"},page:"admin",adminOps:{date:"2026-10-01",settings:{emailNotificationsEnabled:false,emailServiceConfigured:false},followup:{date:"2026-10-01",courseSummary:[{key:"section",label:"B團分部課",groups:["B"],time:"17:40–18:30",expected:2,recorded:2,attended:2,sectionRecorders:[{groupName:"B",section:"小提一部",recorders:[{name:"王老師",role:"teacher",count:1},{name:"陳主任",role:"admin",count:1}]}]}],privateLessonDetails:[],items:[],counts:{},attendanceCounts:{}},sectionSummaryOpen:true,sectionMonth:"2026-10",sectionSummary:{month:"2026-10",items:[{eventDate:"2026-10-01",groupName:"B",section:"小提一部",recorded:2,present:2,recorders:[{name:"王老師",role:"teacher",count:1},{name:"陳主任",role:"admin",count:1}]}]}}};
  const context={state,window:null,document:{querySelector:selector=>selector===".main"?main:null,getElementById:id=>id==="adminOperations"?root:null},render:()=>{},setTimeout:callback=>callback(),esc:value=>String(value),api:async()=>{},toast:()=>{}};
  context.window=context;
  const src=readFileSync(new URL("../../app/admin-operations.js",import.meta.url),"utf8");
  runInNewContext(src,context);
  assert.match(root.innerHTML,/實際點名者/);
  assert.match(root.innerHTML,/王老師（老師） 1 人/);
  assert.match(root.innerHTML,/陳主任（校方管理員代點名） 1 人/);
  assert.match(root.innerHTML,/分部課點名總表/);
});
