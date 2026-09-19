import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import {
  defaultTenantId,
  ensureDefaultTenant,
  ensureTenantTables,
  table,
  tenantIdValue,
  tenantParentPartition,
  tenantSchoolPartition,
  tenantStudentPartition,
  writeGlobalAudit
} from "../lib/storage.js";

const MIGRATION_ID="phase2-tenant-scope-v1";
const CUTOVER_LOCKED=true;
const DATASETS=[
  {name:"StudentMaster",label:"學生主檔",sourceKey:"studentMaster",targetKey:"tenantStudentMaster",kind:"school",legacyPartition:"STUDENT"},
  {name:"StudentRegistration",label:"家長申請",sourceKey:"registrations",targetKey:"tenantRegistrations",kind:"school",legacyPartition:"REG"},
  {name:"UserStudentMap",label:"家長 Gmail 綁定",sourceKey:"userStudentMap",targetKey:"tenantUserStudentMap",kind:"parent"},
  {name:"StudentHistory",label:"學生異動歷史",sourceKey:"studentHistory",targetKey:"tenantStudentHistory",kind:"student"},
  {name:"SemesterEnrollment",label:"學期正式名單",sourceKey:"semesterEnrollment",targetKey:"tenantSemesterEnrollment",kind:"term"},
  {name:"TeacherDirectory",label:"老師帳號",sourceKey:"teacherDirectory",targetKey:"tenantTeacherDirectory",kind:"school",legacyPartition:"TEACHER"},
  {name:"TeacherProfile",label:"老師權限",sourceKey:"teacherProfile",targetKey:"tenantTeacherProfile",kind:"school",legacyPartition:"TEACHER"},
  {name:"AcademicYearBatch",label:"學年度批次紀錄",sourceKey:"academicYearBatch",targetKey:"tenantAcademicYearBatch",kind:"school",legacyPartition:"BATCH"},
  {name:"PracticeLog",label:"自主練習",sourceKey:"practice",targetKey:"tenantPractice",kind:"student"},
  {name:"SectionAttendance",label:"分部課",sourceKey:"section",targetKey:"tenantSection",kind:"student"},
  {name:"EnsembleAttendance",label:"合奏課",sourceKey:"ensemble",targetKey:"tenantEnsemble",kind:"student"},
  {name:"ComprehensiveAttendance",label:"綜合課",sourceKey:"comprehensive",targetKey:"tenantComprehensive",kind:"student"},
  {name:"PrivateLesson",label:"個別課",sourceKey:"privateLesson",targetKey:"tenantPrivateLesson",kind:"student"}
];

function pk(entity){return String(entity?.partitionKey??entity?.PartitionKey??"")}
function rk(entity){return String(entity?.rowKey??entity?.RowKey??"")}
function cleanEntity(entity={}){
  const out={};
  for(const [key,value] of Object.entries(entity)){
    if(["etag","timestamp","PartitionKey","RowKey"].includes(key)||value===undefined)continue;
    out[key]=value;
  }
  out.partitionKey=pk(entity);out.rowKey=rk(entity);return out;
}
function belongsToDefaultTenant(entity,schoolId){const explicit=tenantIdValue(entity?.schoolId);return !explicit||explicit===schoolId}
function isScoped(def,entity,schoolId){
  const partition=pk(entity);
  if(def.kind==="school")return partition===schoolId;
  return partition.startsWith(`${schoolId}|${def.kind}|`);
}
function isLegacy(def,entity,schoolId){
  if(!belongsToDefaultTenant(entity,schoolId)||isScoped(def,entity,schoolId))return false;
  const partition=pk(entity);
  if(def.kind==="school")return partition===def.legacyPartition;
  if(def.kind==="parent")return !partition.includes("|parent|");
  if(def.kind==="student")return !partition.includes("|student|");
  if(def.kind==="term")return !partition.includes("|term|");
  return false;
}
function targetPartition(def,entity,schoolId){
  if(def.kind==="school")return tenantSchoolPartition(schoolId);
  if(def.kind==="parent")return tenantParentPartition(schoolId,entity.parentEmail||pk(entity));
  if(def.kind==="student")return tenantStudentPartition(schoolId,entity.studentId||pk(entity));
  if(def.kind==="term")return `${tenantSchoolPartition(schoolId)}|term|${pk(entity)}`;
  throw new Error(`未知的 Tenant 鍵值類型：${def.kind}`);
}
function scopedCopy(def,source,schoolId){
  const entity=cleanEntity(source),sourcePartition=pk(source);
  entity.partitionKey=targetPartition(def,source,schoolId);entity.rowKey=rk(source);entity.schoolId=schoolId;
  if(def.name==="StudentMaster"&&!entity.studentId)entity.studentId=entity.rowKey;
  if(["TeacherDirectory","TeacherProfile"].includes(def.name)&&!entity.teacherEmail)entity.teacherEmail=entity.rowKey;
  if(def.kind==="parent"&&!entity.parentEmail)entity.parentEmail=sourcePartition.toLowerCase();
  if(def.kind==="student"&&!entity.studentId)entity.studentId=sourcePartition;
  return entity;
}
function entityKey(entity){return `${pk(entity)}\u0000${rk(entity)}`}
function sameEntity(expected,actual){const cleanActual=cleanEntity(actual);return Object.entries(expected).every(([key,value])=>JSON.stringify(cleanActual[key])===JSON.stringify(value))}
async function listRows(key){const rows=[];for await(const entity of table(key).listEntities())rows.push(entity);return rows}
async function inspectDataset(def,schoolId){
  const [sourceRows,targetRows]=await Promise.all([listRows(def.sourceKey),listRows(def.targetKey)]),legacy=sourceRows.filter(entity=>isLegacy(def,entity,schoolId)),scoped=targetRows.filter(entity=>isScoped(def,entity,schoolId));
  const expected=legacy.map(entity=>scopedCopy(def,entity,schoolId)),legacyKeys=new Set(expected.map(entityKey)),scopedKeys=new Set(scoped.map(entityKey)),scopedByKey=new Map(scoped.map(entity=>[entityKey(entity),entity]));
  const missing=[...legacyKeys].reduce((count,key)=>count+(scopedKeys.has(key)?0:1),0),extra=[...scopedKeys].reduce((count,key)=>count+(legacyKeys.has(key)?0:1),0);
  const mismatched=expected.reduce((count,entity)=>{const actual=scopedByKey.get(entityKey(entity));return count+(!actual||sameEntity(entity,actual)?0:1)},0);
  return {name:def.name,label:def.label,legacy:legacy.length,scoped:scoped.length,missing,extra,mismatched,ready:missing===0&&extra===0&&mismatched===0};
}
function totalsFor(items=[]){return items.reduce((totals,item)=>({legacy:totals.legacy+Number(item.legacy||0),scoped:totals.scoped+Number(item.scoped||0),missing:totals.missing+Number(item.missing||0),extra:totals.extra+Number(item.extra||0),mismatched:totals.mismatched+Number(item.mismatched||0),upserted:totals.upserted+Number(item.upserted||0)}),{legacy:0,scoped:0,missing:0,extra:0,mismatched:0,upserted:0})}
async function inspectAll(schoolId){const items=await Promise.all(DATASETS.map(def=>inspectDataset(def,schoolId)));return {items,totals:totalsFor(items),verified:items.every(item=>item.ready===true)}}
async function upsertInChunks(client,entities=[]){
  let count=0;
  for(let i=0;i<entities.length;i+=20){const chunk=entities.slice(i,i+20);await Promise.all(chunk.map(entity=>client.upsertEntity(entity,"Replace")));count+=chunk.length}
  return count;
}
async function backfillAll(schoolId){
  const upserted=new Map();
  for(const def of DATASETS){
    const rows=await listRows(def.sourceKey),legacy=rows.filter(entity=>isLegacy(def,entity,schoolId));
    upserted.set(def.name,await upsertInChunks(table(def.targetKey),legacy.map(entity=>scopedCopy(def,entity,schoolId))));
  }
  const result=await inspectAll(schoolId);
  result.items=result.items.map(item=>({...item,upserted:upserted.get(item.name)||0}));
  result.totals=totalsFor(result.items);return result;
}
function parseSummary(value){try{return JSON.parse(String(value||""))}catch{return null}}
async function getMarker(schoolId){
  try{return await table("tenantMigration").getEntity(schoolId,MIGRATION_ID)}catch(error){if(error.statusCode===404)return null;throw error}
}
async function saveMarker(schoolId,status,action,actorEmail,summary){
  const now=new Date().toISOString(),old=await getMarker(schoolId);
  const entity={partitionKey:schoolId,rowKey:MIGRATION_ID,migrationId:MIGRATION_ID,schoolId,status,lastAction:action,summary:JSON.stringify(summary),createdAt:old?.createdAt||now,updatedAt:now,updatedBy:String(actorEmail||"").slice(0,160)};
  if(status==="backfilled")entity.backfilledAt=now;else if(old?.backfilledAt)entity.backfilledAt=old.backfilledAt;
  if(status==="verified")entity.verifiedAt=now;else if(old?.verifiedAt)entity.verifiedAt=old.verifiedAt;
  await table("tenantMigration").upsertEntity(entity,"Replace");return entity;
}
function markerView(marker,schoolId){const markerStatus=String(marker?.status||"not_started");return {ok:true,migrationId:MIGRATION_ID,schoolId,status:CUTOVER_LOCKED&&markerStatus==="verified"?"cutover":markerStatus,lastAction:String(marker?.lastAction||""),updatedAt:String(marker?.updatedAt||""),updatedBy:String(marker?.updatedBy||""),backfilledAt:String(marker?.backfilledAt||""),verifiedAt:String(marker?.verifiedAt||""),summary:parseSummary(marker?.summary),cutoverLocked:CUTOVER_LOCKED,cutoverStage:"operational-data",secondTenantsRemainSetup:true}}

app.http("tenantMigration",{methods:["GET","POST"],authLevel:"anonymous",route:"tenant-migration",handler:async request=>{
  const access=await getAccess(request);
  if(!access.authenticated)return json({error:"Unauthorized"},401);
  if(access.role!=="globalAdmin"||access.capabilities?.globalAdmin!==true)return json({error:"僅限 Global Admin 執行 Tenant 資料遷移"},403);
  const schoolId=defaultTenantId();
  try{
    await ensureTenantTables();await ensureDefaultTenant(access.email);
    if(request.method==="GET")return json(markerView(await getMarker(schoolId),schoolId));
    if(CUTOVER_LOCKED)return json({error:"Tenant 資料已切換為正式讀寫來源；為避免舊表覆寫新資料，回填工具已鎖定。",cutoverLocked:true},409);
    let body;try{body=await request.json()}catch{return json({error:"JSON 格式不正確"},400)}
    const action=String(body?.action||"").trim().toLowerCase();
    if(!["preview","backfill","verify"].includes(action))return json({error:"action 必須為 preview、backfill 或 verify"},400);
    const summary=action==="backfill"?await backfillAll(schoolId):await inspectAll(schoolId);
    const status=action==="preview"?"previewed":action==="backfill"?(summary.verified?"backfilled":"backfill_incomplete"):(summary.verified?"verified":"verification_failed");
    const marker=await saveMarker(schoolId,status,action,access.email,summary);
    await writeGlobalAudit({actorEmail:access.email,action:`tenant_migration_${action}`,schoolId,details:{migrationId:MIGRATION_ID,status,totals:summary.totals}});
    return json({...markerView(marker,schoolId),summary});
  }catch(error){
    console.error("Tenant migration failed:",error?.message||String(error));
    return json({error:"Tenant 資料遷移失敗："+(error?.message||String(error))},500);
  }
}});
