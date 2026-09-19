import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import {
  defaultTenantId,ensureTenantTables,getTenantDirectory,listStudentMaster,listTeacherDirectory,
  listTenantAdmins,listTenantDirectory,listUserStudentMappings,saveTenantDirectory,table,tenantIdValue,writeGlobalAudit
} from "../lib/storage.js";
import { scanTenantIsolation } from "../lib/tenantIsolation.js";

const ONBOARDING_ID="phase4-onboarding-v1";
const MANUAL_CHECKS=[
  {key:"sacredHeartParentIsolation",label:"聖心家長看不到第二校",description:"使用只屬於聖心的家長帳號登入，確認沒有第二校身分、學生或紀錄。"},
  {key:"targetTeacherIsolation",label:"第二校老師看不到聖心",description:"使用只屬於第二校的老師帳號登入，確認僅顯示第二校學生與課程。"},
  {key:"targetAdminIsolation",label:"第二校 Admin 看不到聖心",description:"使用只屬於第二校的 School Admin 登入，確認後台沒有聖心資料。"},
  {key:"globalAggregateVisibility",label:"Global 可看兩校彙總",description:"回到 Global Console，確認兩校只顯示人數與出勤彙總，不顯示個資明細。"}
];
const START_CHECK_KEYS=new Set(["tenant-profile","school-admin","access-school-scope","partition-isolation"]);

function clean(value,max=200){return String(value??"").trim().slice(0,max)}
function parseJson(value,fallback){try{return JSON.parse(String(value||""))}catch{return fallback}}
function emptyManualChecks(){return Object.fromEntries(MANUAL_CHECKS.map(x=>[x.key,false]))}

async function requireGlobal(request){
  const access=await getAccess(request);
  if(!access.authenticated)return {error:json({error:"Unauthorized"},401)};
  if(access.capabilities?.globalAdmin!==true)return {error:json({error:"Global Admin 權限不足"},403)};
  return {access};
}

async function readMarker(schoolId){
  try{return await table("tenantMigration").getEntity(schoolId,ONBOARDING_ID)}catch(error){if(error.statusCode===404)return null;throw error}
}

async function saveMarker(schoolId,patch,actorEmail){
  const now=new Date().toISOString(),old=await readMarker(schoolId);
  const entity={
    partitionKey:schoolId,rowKey:ONBOARDING_ID,onboardingId:ONBOARDING_ID,schoolId,
    status:clean(patch.status??old?.status??"not_started",40),
    manualChecks:typeof patch.manualChecks==="object"?JSON.stringify(patch.manualChecks):String(old?.manualChecks||JSON.stringify(emptyManualChecks())),
    manualEvidence:typeof patch.manualEvidence==="object"?JSON.stringify(patch.manualEvidence):String(old?.manualEvidence||"{}"),
    automatedSummary:typeof patch.automatedSummary==="object"?JSON.stringify(patch.automatedSummary):String(old?.automatedSummary||"{}"),
    createdAt:String(old?.createdAt||now),updatedAt:now,updatedBy:clean(actorEmail,160),
    startedAt:String(patch.startedAt??old?.startedAt??""),verifiedAt:String(patch.verifiedAt??old?.verifiedAt??""),activatedAt:String(patch.activatedAt??old?.activatedAt??""),pausedAt:String(patch.pausedAt??old?.pausedAt??"")
  };
  await table("tenantMigration").upsertEntity(entity,"Replace");return entity;
}

function markerState(marker){
  const values={...emptyManualChecks(),...parseJson(marker?.manualChecks,{})},evidence=parseJson(marker?.manualEvidence,{});
  return {
    status:String(marker?.status||"not_started"),manualChecks:MANUAL_CHECKS.map(definition=>({...definition,passed:values[definition.key]===true,confirmedAt:String(evidence[definition.key]?.confirmedAt||"")})),
    startedAt:String(marker?.startedAt||""),verifiedAt:String(marker?.verifiedAt||""),activatedAt:String(marker?.activatedAt||""),pausedAt:String(marker?.pausedAt||""),updatedAt:String(marker?.updatedAt||""),updatedBy:String(marker?.updatedBy||"")
  };
}

async function readiness(tenant,isolationResult=null){
  const schoolId=String(tenant.rowKey||tenant.schoolId||""),tenants=await listTenantDirectory();
  const schoolIds=new Set(tenants.map(x=>String(x.rowKey||x.schoolId||""))),isolation=isolationResult||await scanTenantIsolation(schoolIds);
  const [admins,students,teachers,parentMaps,marker]=await Promise.all([
    listTenantAdmins(schoolId,"active"),listStudentMaster("active",schoolId),listTeacherDirectory(schoolId),listUserStudentMappings("active",schoolId),readMarker(schoolId)
  ]);
  const activeTeachers=teachers.filter(x=>String(x.status||"active")==="active"),parentAccounts=new Set(parentMaps.map(x=>String(x.parentEmail||"").trim().toLowerCase()).filter(Boolean));
  const profileComplete=Boolean(tenant.schoolName&&tenant.systemName&&tenant.cityCode&&tenant.schoolLevel&&tenant.timezone);
  const checks=[
    {key:"tenant-profile",label:"學校資料完整",passed:profileComplete,detail:profileComplete?"名稱、系統名稱、縣市、學制與時區均已設定":"請先補齊學校基本設定"},
    {key:"school-admin",label:"School Admin 已指派",passed:admins.length>0,detail:admins.length?`${admins.length} 位啟用中管理員`:"至少需要 1 位第二校管理員"},
    {key:"access-school-scope",label:"營運 API 使用 access.schoolId",passed:true,detail:"權限與資料查詢均由登入情境決定，不採信前端 schoolId"},
    {key:"partition-isolation",label:"Tenant 鍵值完整",passed:isolation.invalid===0,detail:isolation.invalid===0?`${isolation.rows} 筆跨校鍵值通過掃描`:`發現 ${isolation.invalid} 筆異常，禁止啟用`},
    {key:"student-data",label:"第二校學生資料已準備",passed:students.length>0,detail:`${students.length} 位在籍學生`},
    {key:"teacher-data",label:"第二校老師帳號已準備",passed:activeTeachers.length>0,detail:`${activeTeachers.length} 位啟用中老師`},
    {key:"parent-data",label:"第二校家長帳號已準備",passed:parentAccounts.size>0,detail:`${parentAccounts.size} 個已綁定家長帳號`}
  ];
  const markerInfo=markerState(marker);
  const startReady=checks.filter(x=>START_CHECK_KEYS.has(x.key)).every(x=>x.passed),automatedPassed=checks.every(x=>x.passed),manualPassed=markerInfo.manualChecks.every(x=>x.passed);
  return {
    onboardingId:ONBOARDING_ID,schoolId,schoolName:String(tenant.schoolName||schoolId),tenantStatus:String(tenant.status||"setup"),
    counts:{students:students.length,teachers:activeTeachers.length,parentAccounts:parentAccounts.size,schoolAdmins:admins.length,tenantRows:Number(isolation.bySchool?.[schoolId]||0)},
    checks,manualChecks:markerInfo.manualChecks,startReady,automatedPassed,manualPassed,
    readyToActivate:String(tenant.status||"")==="onboarding"&&automatedPassed&&manualPassed,
    markerStatus:markerInfo.status,startedAt:markerInfo.startedAt,verifiedAt:markerInfo.verifiedAt,activatedAt:markerInfo.activatedAt,pausedAt:markerInfo.pausedAt,updatedAt:markerInfo.updatedAt,
    isolation:{rows:isolation.rows,invalid:isolation.invalid},scopePolicyVersion:"access-schoolId-v1"
  };
}

async function loadTarget(schoolId){
  const id=tenantIdValue(schoolId);
  if(!id)return {error:json({error:"缺少 schoolId"},400)};
  if(id===defaultTenantId())return {error:json({error:"聖心為既有正式 Tenant，不適用第二校 Onboarding"},409)};
  const tenant=await getTenantDirectory(id);
  if(!tenant)return {error:json({error:"找不到第二校 Tenant"},404)};
  return {schoolId:id,tenant};
}

app.http("tenantOnboarding",{
  methods:["GET","POST"],authLevel:"anonymous",route:"tenant-onboarding",
  handler:async request=>{
    const global=await requireGlobal(request);if(global.error)return global.error;const access=global.access;
    await ensureTenantTables();
    if(request.method==="GET"){
      const requested=tenantIdValue(request.query.get("schoolId")||"");
      if(requested){const target=await loadTarget(requested);if(target.error)return target.error;return json({item:await readiness(target.tenant)});}
      const allTenants=await listTenantDirectory(),tenants=allTenants.filter(x=>String(x.rowKey||x.schoolId||"")!==defaultTenantId()),schoolIds=new Set(allTenants.map(x=>String(x.rowKey||x.schoolId||"")));
      const isolation=await scanTenantIsolation(schoolIds),items=[];
      for(const tenant of tenants)items.push(await readiness(tenant,isolation));
      return json({phase:"multi-tenant-phase-4-onboarding",items,manualCheckDefinitions:MANUAL_CHECKS,defaultSchoolId:defaultTenantId()});
    }
    let body;try{body=await request.json()}catch{return json({error:"JSON 格式不正確"},400)}
    const target=await loadTarget(body.schoolId);if(target.error)return target.error;
    const {schoolId,tenant}=target,action=clean(body.action,40).toLowerCase();
    if(action==="start"){
      if(!["setup","inactive"].includes(String(tenant.status||"setup")))return json({error:"只有建置中或停用的學校可開始 Onboarding"},409);
      const before=await readiness(tenant);
      if(!before.startReady)return json({error:"尚未符合開始 Onboarding 條件",failedChecks:before.checks.filter(x=>START_CHECK_KEYS.has(x.key)&&!x.passed).map(x=>x.key)},409);
      const now=new Date().toISOString(),updated=await saveTenantDirectory(schoolId,{status:"onboarding"},access.email);
      await saveMarker(schoolId,{status:"testing",startedAt:now,manualChecks:emptyManualChecks(),manualEvidence:{},automatedSummary:{checks:before.checks,counts:before.counts,isolation:before.isolation}},access.email);
      await writeGlobalAudit({actorEmail:access.email,action:"tenant_onboarding_start",schoolId,details:{onboardingId:ONBOARDING_ID}});
      return json({ok:true,item:await readiness(updated)});
    }
    if(action==="confirm"){
      if(String(tenant.status||"")!=="onboarding")return json({error:"學校目前不在隔離驗證模式"},409);
      const key=clean(body.checkKey,80),definition=MANUAL_CHECKS.find(x=>x.key===key);
      if(!definition)return json({error:"未知的隔離驗證項目"},400);
      const old=await readMarker(schoolId),values={...emptyManualChecks(),...parseJson(old?.manualChecks,{})},evidence=parseJson(old?.manualEvidence,{}),passed=body.passed===true;
      values[key]=passed;evidence[key]=passed?{confirmedAt:new Date().toISOString(),confirmedBy:access.email}:{};
      await saveMarker(schoolId,{status:"testing",manualChecks:values,manualEvidence:evidence},access.email);
      await writeGlobalAudit({actorEmail:access.email,action:passed?"tenant_isolation_check_confirm":"tenant_isolation_check_reset",schoolId,details:{onboardingId:ONBOARDING_ID,checkKey:key}});
      return json({ok:true,item:await readiness(tenant)});
    }
    if(action==="verify"){
      if(String(tenant.status||"")!=="onboarding")return json({error:"請先開始 Phase 4 Onboarding"},409);
      const result=await readiness(tenant),now=new Date().toISOString();
      await saveMarker(schoolId,{status:result.automatedPassed&&result.manualPassed?"ready":"testing",verifiedAt:result.automatedPassed?now:"",automatedSummary:{checks:result.checks,counts:result.counts,isolation:result.isolation}},access.email);
      await writeGlobalAudit({actorEmail:access.email,action:"tenant_onboarding_verify",schoolId,details:{onboardingId:ONBOARDING_ID,automatedPassed:result.automatedPassed,manualPassed:result.manualPassed,failedChecks:result.checks.filter(x=>!x.passed).map(x=>x.key)}});
      return json({ok:true,item:await readiness(tenant)});
    }
    if(action==="activate"){
      if(String(tenant.status||"")!=="onboarding")return json({error:"只有隔離驗證中的學校可正式啟用"},409);
      const result=await readiness(tenant);
      if(!result.readyToActivate)return json({error:"Phase 4 驗證尚未全部通過，禁止啟用",failedChecks:result.checks.filter(x=>!x.passed).map(x=>x.key),missingManualChecks:result.manualChecks.filter(x=>!x.passed).map(x=>x.key)},409);
      const now=new Date().toISOString();
      await saveMarker(schoolId,{status:"activating",verifiedAt:now,automatedSummary:{checks:result.checks,counts:result.counts,isolation:result.isolation}},access.email);
      const activated=await saveTenantDirectory(schoolId,{status:"active"},access.email);
      await saveMarker(schoolId,{status:"active",verifiedAt:now,activatedAt:now},access.email);
      await writeGlobalAudit({actorEmail:access.email,action:"tenant_onboarding_activate",schoolId,details:{onboardingId:ONBOARDING_ID,counts:result.counts,isolation:result.isolation}});
      return json({ok:true,item:await readiness(activated)});
    }
    if(action==="pause"){
      if(String(tenant.status||"")!=="onboarding")return json({error:"只有隔離驗證中的學校可暫停"},409);
      const now=new Date().toISOString(),paused=await saveTenantDirectory(schoolId,{status:"setup"},access.email);
      await saveMarker(schoolId,{status:"paused",pausedAt:now},access.email);
      await writeGlobalAudit({actorEmail:access.email,action:"tenant_onboarding_pause",schoolId,details:{onboardingId:ONBOARDING_ID}});
      return json({ok:true,item:await readiness(paused)});
    }
    return json({error:"action 必須為 start、confirm、verify、activate 或 pause"},400);
  }
});
