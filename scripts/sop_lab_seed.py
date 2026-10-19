"""Generate a UAT-only, admin-authorized, idempotent SOP test fixture endpoint."""
from pathlib import Path

API_JS = r'''
import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
import {getLabReadiness,assertLabIsolation} from "../lib/labIsolation.mjs";
assertLabIsolation();

const scenarios=[
  {id:"990101",studentName:"測試甲同學",grade:"四年級",groupName:"A",instrument:"中提琴",section:"中提",classCode:"4A",size:"12",shirt:"PENDING_PARENT",uniform:"PUBLIC"},
  {id:"990102",studentName:"測試乙同學",grade:"五年級",groupName:"A",instrument:"小提琴",section:"小提一部",classCode:"5B",size:"S",shirt:"PENDING_SCHOOL",uniform:"PURCHASE"},
  {id:"990103",studentName:"測試丙同學",grade:"六年級",groupName:"A",instrument:"大提琴",section:"大提",classCode:"6A",size:"M",shirt:"RECEIVED",uniform:"PENDING"},
  {id:"990104",studentName:"測試丁同學",grade:"三年級",groupName:"B",instrument:"小提琴",section:"小提二部",classCode:"3A",size:"10",shirt:"PENDING_SCHOOL"},
  {id:"990105",studentName:"測試戊同學",grade:"二年級",groupName:"儲備",instrument:"小提琴",section:"小提一部",classCode:"2A",size:null,shirt:"PENDING_PARENT"}
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
function shirtEntity(s,schoolId){
 const base={kind:"regularUniform",historicalIssued:s.shirt==="RECEIVED",issuedQuantity:1,
  size:s.size,sizeStatus:s.size?"RECORDED":"PENDING_PARENT",
  source:"SOP_LAB_FIXTURE",fixtureId:fixturePrefix+s.id};
 if(s.shirt==="RECEIVED"){
  base.schoolIssuedAt="2026-10-15T10:00:00.000Z";base.parentConfirmedAt="2026-10-15T11:00:00.000Z";
 }
 return {partitionKey:schoolId,rowKey:s.id,payload:JSON.stringify(base),updatedAt:new Date().toISOString()};
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
app.http("sopLabFixtures",{
 methods:["GET","POST"],authLevel:"anonymous",route:"sop-lab/fixtures",
 handler:async request=>{
  const ready=getLabReadiness();
  if(!ready.ready||ready.environment!=="functional-uat"||ready.storageAccount!==process.env.LAB_EXPECTED_STORAGE_ACCOUNT)
   return json({error:"LAB 隔離未通過，拒絕操作"},503);
  const context=await getTenantContext(request);
  if(context.error)return context.error;
  if(context.access.role!=="admin")return json({error:"僅 LAB 學校管理員可建立測試資料"},403);
  if(request.method==="GET")return json({items:scenarios.map(({id,studentName,groupName,shirt,uniform})=>
    ({id,studentName,groupName,shirt,uniform:uniform||null})),schoolId:context.schoolId});
  const body=await request.json().catch(()=>({}));
  if(body?.confirmation!=="CREATE_SOP_FIXTURES")return json({error:"請確認建立 LAB 虛構資料"},400);
  const schoolId=context.schoolId;
  const students=await table("TenantStudentMaster");
  const shirts=await table("TenantTshirtHistoricalIssue");
  const uniforms=await table("TenantUniformEventRequest");
  const events=await table(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
  const result={created:0,existing:0,schoolId,students:scenarios.length};
  async function put(client,item){result[(await addIfMissing(client,item))==="created"?"created":"existing"]++}
  try{
   for(const s of scenarios){
    await put(students,demoStudent(s,schoolId));
    await put(shirts,shirtEntity(s,schoolId));
    if(s.uniform)await put(uniforms,competitionEntity(s,schoolId));
   }
   await put(events,eventEntity(schoolId));
   return json({ok:true,...result,message:"僅新增不存在的 SOP 測試紀錄；未覆蓋原有資料"});
  }catch(e){console.error("SOP fixture seed failed",e);return json({error:"建立部分失敗，請重新執行；已建立紀錄不會重複新增",...result},503)}
 }
});
'''
def install(api_root:Path):
    out=api_root/"src"/"functions"/"sopLabFixtures.js"
    out.write_text(API_JS.lstrip(),encoding="utf-8")
