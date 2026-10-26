"""Generate a UAT-only, admin-authorized, idempotent SOP test fixture endpoint."""
from pathlib import Path

API_JS = r'''
import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
import {getLabReadiness,assertLabIsolation} from "../lib/labIsolation.mjs";
import {handleLabDataTools,withLabDataLock} from "../lib/lab-data-tools.mjs";
import {seedPrivateExamples} from "../lib/lab-private-fixtures.mjs";
assertLabIsolation();

const scenarios=[
  {id:"990101",studentName:"測試甲同學",grade:"四年級",groupName:"A",instrument:"中提琴",section:"中提",classCode:"4A",size:"12",shirt:"PENDING_PARENT",uniform:"PUBLIC"},
  {id:"990102",studentName:"測試乙同學",grade:"五年級",groupName:"A",instrument:"小提琴",section:"小提一部",classCode:"5B",size:"S",shirt:"PENDING_SCHOOL",uniform:"PURCHASE"},
  {id:"990103",studentName:"測試丙同學",grade:"六年級",groupName:"A",instrument:"大提琴",section:"大提",classCode:"6A",size:"M",shirt:"RECEIVED",uniform:"PENDING"},
  {id:"990104",studentName:"測試丁同學",grade:"三年級",groupName:"B",instrument:"小提琴",section:"小提二部",classCode:"3A",size:"10",shirt:"PENDING_SCHOOL"},
  {id:"990105",studentName:"測試戊同學",grade:"二年級",groupName:"儲備",instrument:"小提琴",section:"小提一部",classCode:"2A",size:null,shirt:"PENDING_PARENT"},
  {id:"990106",studentName:"測試己同學",grade:"二年級",groupName:"儲備",instrument:"小提琴",section:"小提一部",classCode:"2A",size:null,shirt:"PENDING_PARENT"}
];
const fixturePrefix="sop_demo_";
const table=async name=>{
 const client=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);
 await client.createTable().catch(e=>{if(e.statusCode!==409)throw e});
 return client;
};
async function addIfMissing(client,entry){
 try{await client.createEntity(entry);return "created"}
 catch(e){if(e.statusCode===409)return "exists";throw e}
}
function demoStudent(s,schoolId){
 const at=new Date().toISOString();
 return {partitionKey:schoolId,rowKey:s.id,schoolId,studentId:s.id,studentNo:s.id,studentName:s.studentName,
  grade:s.grade,groupName:s.groupName,instrument:s.instrument,section:s.section,schoolYear:"115",
  classCode:s.classCode,semester:"1",status:"active",joinedAt:"2026-09-01",
  createdAt:at,updatedAt:at,updatedBy:"SOP_LAB_FIXTURE"};
}
// The first fixture version stored "SOP_LAB_FIXTURE" as the source even for
// parent-survey records. The real receipt APIs correctly reject that source.
// Match ONLY the original untouched fixture exactly before repairing it.
function originalShirtFixture(s){
 const old={kind:"regularUniform",historicalIssued:s.shirt==="RECEIVED",issuedQuantity:1,
  size:s.size,sizeStatus:s.size?"RECORDED":"PENDING_PARENT",
  source:"SOP_LAB_FIXTURE",fixtureId:fixturePrefix+s.id};
 if(s.shirt==="RECEIVED"){
  old.schoolIssuedAt="2026-10-15T10:00:00.000Z";old.parentConfirmedAt="2026-10-15T11:00:00.000Z";
 }
 return old;
}
function shirtPayload(s){
 const complete=s.shirt==="RECEIVED";
 const base={kind:"regularUniform",historicalIssued:complete,issuedQuantity:complete?1:0,
  size:s.size,sizeStatus:s.size?"PARENT_RECORDED":"PENDING_PARENT",
  source:complete?"PARENT_CONFIRMED_FIRST_PUBLIC":"PARENT_SIZE_SURVEY",
  fixtureId:fixturePrefix+s.id};
 // All four real-world stages are represented in five fake students:
 // size missing (990105), parent-sized/waiting school (990102,990104),
 // school handoff/waiting parent (990101), completed receipt (990103).
 if(s.id==="990101"||complete){
  base.schoolIssuedAt="2026-10-15T10:00:00.000Z";
  base.schoolIssuedBy="SOP_LAB_FIXTURE";
  base.schoolIssuedSize=s.size;
  base.schoolIssuedQuantity=1;
  base.schoolHandoffTo="SOP 虛構家長";
 }
 if(complete){
  base.received=true;
  base.receivedSize=s.size;
  base.receivedAt="2026-10-15T11:00:00.000Z";
  base.receivedBy="SOP_LAB_FIXTURE";
 }
 return base;
}
function shirtEntity(s,schoolId){
 return {partitionKey:schoolId,rowKey:s.id,payload:JSON.stringify(shirtPayload(s)),updatedAt:new Date().toISOString()};
}
async function createOrRepairOriginalShirt(client,item,s){
 try{await client.createEntity(item);return "created"}
 catch(e){if(e.statusCode!==409)throw e}
 const current=await client.getEntity(item.partitionKey,item.rowKey);
 let old;try{old=JSON.parse(current.payload||"{}")}catch{return "existing"}
 // No broad upsert. A changed size/status, another fixture version or a real
 // family/school action must never be replaced by a new sample template.
 if(JSON.stringify(old)!==JSON.stringify(originalShirtFixture(s)))return "existing";
 try{
  await client.updateEntity({...item,updatedAt:new Date().toISOString()},"Replace",{etag:current.etag});
  return "repaired";
 }catch(e){
  if(e.statusCode===412)return "existing"; // somebody edited it concurrently
  throw e;
 }
}
function competitionEntity(s,schoolId){
 const style=s.id==="990102"?"男":"女";
 const size=style==="男"?"S":"M";
 const payload={id:fixturePrefix+"competition_"+s.id,kind:"competitionUniform",studentId:s.id,
  style,size,acquisition:s.uniform,status:s.uniform==="PENDING"?"PENDING":"APPROVED",
  note:"SOP LAB 虛構測試資料",createdBy:"SOP_LAB_FIXTURE"};
 return {partitionKey:schoolId,rowKey:payload.id,payload:JSON.stringify(payload),updatedAt:new Date().toISOString()};
}
function eventEntity(schoolId){
 const payload={module:"fieldTrip",id:"sop_demo_activity",enabled:true,
  title:"SOP 測試｜弦樂團交流活動",name:"SOP 測試｜弦樂團交流活動",
  eventDate:"2027-01-16",startTime:"09:00",endTime:"12:00",
  location:"虛構測試教室",openAt:"2026-10-01T00:00:00.000Z",
  closeAt:"2027-01-15T00:00:00.000Z",fixtureId:"sop_demo_activity"};
 return {partitionKey:schoolId,rowKey:"fieldTrip:sop_demo_activity",
  payload:JSON.stringify(payload),updatedAt:new Date().toISOString(),updatedBy:"SOP_LAB_FIXTURE"};
}
async function seedEmptySchedule(schoolId,result){
 const schedules=await table(process.env.TENANT_SCHEDULE_TABLE||"TenantSchedule");
 const filter=`PartitionKey eq '${String(schoolId).replaceAll("'","''")}'`;
 for await(const _ of schedules.listEntities({queryOptions:{filter}})){result.scheduleDemo="kept_existing";return}
 const states=await table(process.env.TENANT_SCHEDULE_STATE_TABLE||"TenantScheduleState");
 let state=null;try{state=await states.getEntity(schoolId,"current")}catch(e){if(e.statusCode!==404)throw e}
 if(state?.status==="active"){result.scheduleDemo="kept_active_state";return}
 const at=new Date().toISOString();
 const demos=[
  {rowKey:"sop_course_section_20261025",courseType:"section",courseName:"示例 儲備團分部課",groupName:"儲備",recurrence:"weekly",weekday:5,startDate:"2026-10-30",endDate:"2026-11-20",sessionDate:"",startTime:"17:10",endTime:"18:30"},
  {rowKey:"sop_course_ensemble_20261025",courseType:"ensemble",courseName:"示例 A B團合奏課",groupName:"A,B",recurrence:"date",weekday:0,startDate:"",endDate:"",sessionDate:"2026-10-27",startTime:"12:30",endTime:"13:20"},
  {rowKey:"sop_course_comprehensive_20261025",courseType:"comprehensive",courseName:"示例 弦樂團體活動",groupName:"A,B,儲備",recurrence:"date",weekday:0,startDate:"",endDate:"",sessionDate:"2026-10-30",startTime:"08:45",endTime:"10:15"}
 ];
 for(const demo of demos){const status=await addIfMissing(schedules,{partitionKey:schoolId,schoolId,...demo,section:"",location:"示例團練教室",status:"active",note:"SOP LAB 虛構教學案例",updatedAt:at,updatedBy:"SOP_LAB_FIXTURE"});result[status==="created"?"created":"existing"]++}
 const status=await addIfMissing(states,{partitionKey:schoolId,rowKey:"current",schoolId,status:"draft",updatedAt:at,updatedBy:"SOP_LAB_FIXTURE"});result[status==="created"?"created":"existing"]++;
 result.scheduleDemo="created_three_draft_courses";
}
app.http("sopLabFixtures",{
 methods:["GET","POST"],authLevel:"anonymous",route:"sop-lab/fixtures",
 handler:async request=>{
  const ready=getLabReadiness();
  if(!ready.ready||ready.environment!=="functional-uat"||ready.storageAccount!==process.env.LAB_EXPECTED_STORAGE_ACCOUNT)
   return json({error:"LAB 隔離未通過，拒絕操作"},503);
  const context=await getTenantContext(request);
  if(context.error)return context.error;
  if(context.access.role!=="admin")return json({error:"僅 LAB 學校管理員可建立測試資料"},403);
  if(request.method==="GET"&&request.query?.get("view")==="database")return handleLabDataTools(request,context);
  if(request.method==="GET")return json({items:scenarios.map(({id,studentName,groupName,shirt,uniform})=>
    ({id,studentName,groupName,shirt,uniform:uniform||null})),schoolId:context.schoolId});
  const body=await request.json().catch(()=>({}));
  if(["RESET_LAB_DATA","RESTORE_LAB_DATA"].includes(body.action))return handleLabDataTools(request,context,body);
  if(body.action==="CREATE_PRIVATE_FIXTURES"){
   if(body.confirmation!=="CREATE_PRIVATE_FIXTURES")return json({error:"請確認建立 LAB 個課案例"},400);
   const result={created:0,existing:0};
   try{return await withLabDataLock(context.schoolId,async()=>{
    await seedPrivateExamples({table,addIfMissing,schoolId:context.schoolId,result});
    return json({ok:true,...result,message:"已補齊個課虛構案例；既有老師綁定及紀錄保持不變"});
   })}catch(e){return json({error:e.message},[400,409].includes(e.statusCode)?e.statusCode:503)}
  }
  if(body?.confirmation!=="CREATE_SOP_FIXTURES")return json({error:"請確認建立 LAB 虛構資料"},400);
  const schoolId=context.schoolId;
  const students=await table("TenantStudentMaster");
  const shirts=await table("TenantTshirtHistoricalIssue");
  const uniforms=await table("TenantUniformEventRequest");
  const events=await table(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
  const result={created:0,existing:0,repaired:0,schoolId,students:scenarios.length};
  async function put(client,item){result[(await addIfMissing(client,item))==="created"?"created":"existing"]++}
  try{return await withLabDataLock(schoolId,async()=>{
   for(const s of scenarios){
    await put(students,demoStudent(s,schoolId));
    const shirtResult=await createOrRepairOriginalShirt(shirts,shirtEntity(s,schoolId),s);
    result[shirtResult]++;
    if(s.uniform)await put(uniforms,competitionEntity(s,schoolId));
   }
   await seedEmptySchedule(schoolId,result);
   await seedPrivateExamples({table,addIfMissing,schoolId,result});
   await put(events,eventEntity(schoolId));
   // Parent pages require an explicit enabled module configuration.
   // Create only if absent. Never toggle an existing admin-defined setting.
   for(const module of ["regularUniform","competitionUniform"]){
    const config={partitionKey:schoolId,rowKey:module+":default",
      payload:JSON.stringify({module,id:"default",enabled:true,
        fixtureId:"sop_demo_"+module}),updatedAt:new Date().toISOString(),
      updatedBy:"SOP_LAB_FIXTURE"};
    await put(events,config);
   }
   return json({ok:true,...result,message:"新增缺少的 SOP 與個課虛構案例，僅修補未經修改的第一版虛構團 T 資料；不覆蓋人工調整"});
  });
  }catch(e){console.error("SOP fixture seed failed",e);return json({error:"建立部分失敗，請重新執行；已建立紀錄不會重複新增",...result},503)}
 }
});
'''
def install(api_root:Path):
    out=api_root/"src"/"functions"/"sopLabFixtures.js"
    out.write_text(API_JS.lstrip(),encoding="utf-8")
