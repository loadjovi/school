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

// SAFE LAB-ONLY RESET: return the five named fixture students to a student-only
// starting point. The student master and test-account mappings stay intact;
// never clear other tenants, bank settings, stock, or production databases.
import {createHash,randomUUID} from "node:crypto";
const fixtureIds=new Set(scenarios.map(s=>s.id));
const available=async(t,schoolId,rowKey)=>{try{return await t.getEntity(schoolId,rowKey)}catch(e){if(e.statusCode===404)return null;throw e}};
const parsePayload=e=>{try{return JSON.parse(e.payload||"{}")}catch{return {}}};
const pkFilter=schoolId=>"PartitionKey eq '"+schoolId.replaceAll("'","''")+"'";
async function planReset(schoolId){
 const students=await table("TenantStudentMaster");
 const shirts=await table("TenantTshirtHistoricalIssue");
 const orders=await table("TenantUniformEventRequest");
 const configs=await table(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
 const targets=[],blockers=[];
 for(const s of scenarios){
  const row=await available(students,schoolId,s.id);
  if(!row||row.studentName!==s.studentName||row.updatedBy!=="SOP_LAB_FIXTURE"||row.schoolId!==schoolId){
   blockers.push("虛構學生 "+s.id+" 主檔不是未修改的 SOP LAB 匯入資料；停止還原");
   continue;
  }
  const shirt=await available(shirts,schoolId,s.id);
  if(shirt){
   const data=parsePayload(shirt);
   if(data.fixtureId!==fixturePrefix+s.id)blockers.push("團 T "+s.id+" 沒有原始虛構資料標記，不能自動刪除");
   else targets.push({name:"TenantTshirtHistoricalIssue",row:shirt});
  }
 }
 for await(const row of orders.listEntities({queryOptions:{filter:pkFilter(schoolId)}})){
  const data=parsePayload(row);
  if(!fixtureIds.has(String(data.studentId||"")))continue;
  if(["ORDERED","ARRIVED","READY_FOR_PICKUP","FULFILLED"].includes(data.status)||
     ["VERIFIED","REPORTED_UNVERIFIED"].includes(data.paymentStatus)){
   blockers.push("申請 "+row.rowKey+" 已進入採購、核帳或發放；請先人工核對庫存與財務紀錄");
   continue;
  }
  targets.push({name:"TenantUniformEventRequest",row});
 }
 const fixtureEvent=await available(configs,schoolId,"fieldTrip:sop_demo_activity");
 if(fixtureEvent){
  if(parsePayload(fixtureEvent).fixtureId!=="sop_demo_activity"){
   blockers.push("交流測試活動已被修改為非預設資料；本次不自動刪除");
  }else targets.push({name:process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig",row:fixtureEvent});
 }
 // Do not delete module configuration, parent test-account mappings or other activity records.
 // A request/first-shirt reset does not reverse inventory or bank movements.
 if(targets.length>70)blockers.push("異動筆數異常，超過 70 筆，必須人工核對");
 const fingerprint=targets.map(x=>[x.name,x.row.partitionKey,x.row.rowKey,x.row.etag].join(":")).sort();
 const previewToken=createHash("sha256").update(JSON.stringify({schoolId,fingerprint,blockers})).digest("hex");
 return {targets,blockers,previewToken,studentCount:scenarios.length,shirtCount:targets.filter(x=>x.name==="TenantTshirtHistoricalIssue").length,
  requestCount:targets.filter(x=>x.name==="TenantUniformEventRequest").length,
  eventCount:targets.filter(x=>x.name===(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig")).length};
}
app.http("sopLabResetToStudents",{
 methods:["GET","POST"],authLevel:"anonymous",route:"sop-lab/reset-students-only",
 handler:async request=>{
  const ready=getLabReadiness();
  if(!ready.ready||ready.environment!=="functional-uat"||ready.storageAccount!==process.env.LAB_EXPECTED_STORAGE_ACCOUNT)
   return json({error:"LAB 隔離未通過，禁止還原資料"},503);
  const context=await getTenantContext(request);
  if(context.error)return context.error;
  if(context.access.role!=="admin")return json({error:"僅 LAB 學校管理員可還原測試情境"},403);
  const schoolId=context.schoolId;
  try{
   const plan=await planReset(schoolId);
   const info={schoolId,studentCount:plan.studentCount,shirtCount:plan.shirtCount,
    requestCount:plan.requestCount,eventCount:plan.eventCount,blockers:plan.blockers,
    previewToken:plan.previewToken,
    message:"只還原固定 5 位 LAB 虛構學生的首次團 T 與未核帳申請。保留學生主檔、測試家長綁定、模組啟用設定、非虛構資料、歷史稽核；不處理採購／財務／庫存。"};
   if(request.method==="GET")return json(info);
   const body=await request.json().catch(()=>({}));
   if(plan.blockers.length)return json({error:"存在需要人工確認的異動；禁止部分還原",...info},409);
   if(body.confirmation!=="RESET_FIVE_LAB_STUDENTS_TO_IMPORT_ONLY"||
      body.schoolId!==schoolId||body.previewToken!==plan.previewToken)
    return json({error:"請先預覽目標，再以完整確認內容執行還原"},409);
   const batchId=randomUUID();
   // Back up every targeted row before any deletion. Audit is preserved.
   const backup=await table("TenantSopLabResetBackup");
   let index=0,deleted=0;
   for(const entry of plan.targets){
    const {etag,...fields}=entry.row;
    const serialized=JSON.stringify(fields);
    if(serialized.length>45000)return json({error:"備份資料超過安全上限，未執行刪除"},409);
    await backup.createEntity({partitionKey:schoolId,rowKey:batchId+"_"+String(index++).padStart(3,"0"),
      sourceTable:entry.name,sourcePartition:entry.row.partitionKey,sourceRowKey:entry.row.rowKey,
      snapshot:serialized,actor:String(context.access.email||"LAB Admin").slice(0,220),
      capturedAt:new Date().toISOString()});
   }
   try{
    for(const entry of plan.targets){
     const client=await table(entry.name);
     await client.deleteEntity(entry.row.partitionKey,entry.row.rowKey,{etag:entry.row.etag});
     deleted++;
    }
   }catch(e){
    console.error("SOP LAB reset incomplete",batchId,deleted,e);
    return json({error:"還原尚未全部完成，請重新預覽；備份批次 "+batchId,deleted,backupBatch:batchId},409);
   }
   return json({ok:true,deleted,backupBatch:batchId,studentCount:plan.studentCount,
    message:"已將 5 位虛構學生相關團 T／未核帳申請還原到匯入起點；學生主檔與測試家長登入綁定保留。請直接從家長首頁重新填寫尺寸。"});
  }catch(e){console.error("SOP LAB reset failed",e);return json({error:"LAB 還原失敗，未確認全部異動；請先重新預覽"},503)}
 }
});

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
  const result={created:0,existing:0,repaired:0,schoolId,students:scenarios.length};
  async function put(client,item){result[(await addIfMissing(client,item))==="created"?"created":"existing"]++}
  try{
   for(const s of scenarios){
    await put(students,demoStudent(s,schoolId));
    const shirtResult=await createOrRepairOriginalShirt(shirts,shirtEntity(s,schoolId),s);
    result[shirtResult]++;
    if(s.uniform)await put(uniforms,competitionEntity(s,schoolId));
   }
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
   return json({ok:true,...result,message:"新增缺少的 SOP 記錄，僅修補未經修改的第一版虛構團 T 資料；不覆蓋人工調整"});
  }catch(e){console.error("SOP fixture seed failed",e);return json({error:"建立部分失敗，請重新執行；已建立紀錄不會重複新增",...result},503)}
 }
});
'''
def install(api_root:Path):
    out=api_root/"src"/"functions"/"sopLabFixtures.js"
    out.write_text(API_JS.lstrip(),encoding="utf-8")
