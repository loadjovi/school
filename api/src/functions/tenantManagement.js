import { app } from "@azure/functions";
import { getAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import {
  ensureDefaultTenant,listTenantDirectory,getTenantDirectory,saveTenantDirectory,
  listTenantAdmins,saveTenantUserRole,writeGlobalAudit,defaultTenantId,
  listStudentMaster,listTeacherDirectory,listUserStudentMappings,listActivityRange,activityStudentId,ensureTenantTables,tenantIdValue,table
} from "../lib/storage.js";
import { scanTenantIsolation } from "../lib/tenantIsolation.js";

function clean(v,max=200){return String(v??"").trim().slice(0,max)}
function isEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim())}
function tenantView(t){return {
  schoolId:String(t.rowKey||t.schoolId||""),schoolName:String(t.schoolName||""),shortName:String(t.shortName||""),
  systemName:String(t.systemName||""),schoolSlug:String(t.schoolSlug||""),cityCode:String(t.cityCode||""),cityName:String(t.cityName||""),schoolLevel:String(t.schoolLevel||""),schoolLevelName:String(t.schoolLevelName||""),status:String(t.status||"setup"),timezone:String(t.timezone||"Asia/Taipei"),
  createdAt:String(t.createdAt||""),updatedAt:String(t.updatedAt||""),updatedBy:String(t.updatedBy||"")
}}
function adminView(x){return {email:String(x.partitionKey||""),schoolId:String(x.schoolId||x.rowKey||""),role:String(x.role||""),status:String(x.status||""),createdAt:String(x.createdAt||""),updatedAt:String(x.updatedAt||""),updatedBy:String(x.updatedBy||"")}}
function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
const CITY_MAP={
  "keelung":"基隆市","taipei":"臺北市","new-taipei":"新北市","taoyuan":"桃園市","hsinchu-city":"新竹市","hsinchu-county":"新竹縣",
  "miaoli":"苗栗縣","taichung":"臺中市","changhua":"彰化縣","nantou":"南投縣","yunlin":"雲林縣","chiayi-city":"嘉義市","chiayi-county":"嘉義縣",
  "tainan":"臺南市","kaohsiung":"高雄市","pingtung":"屏東縣","yilan":"宜蘭縣","hualien":"花蓮縣","taitung":"臺東縣","penghu":"澎湖縣","kinmen":"金門縣","lienchiang":"連江縣"
};
const LEVEL_MAP={"elementary":"國小","junior-high":"國中","senior-high":"高中"};
function schoolSlugValue(v){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,40)}
function composeSchoolId(cityCode,schoolSlug,schoolLevel){return tenantIdValue([cityCode,schoolSlug,schoolLevel].filter(Boolean).join("-"))}

async function requireGlobal(request){
  const a=await getAccess(request);
  if(!a.authenticated)return {error:json({error:"Unauthorized"},401)};
  if(a.capabilities?.globalAdmin!==true)return {error:json({error:"Global Admin 權限不足"},403)};
  return {a};
}

app.http("tenantDirectory",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"tenant-directory",
  handler:async request=>{
    const g=await requireGlobal(request);if(g.error)return g.error;const a=g.a;
    await ensureDefaultTenant(a.email);
    if(request.method==="GET"){
      const items=await listTenantDirectory();
      return json({items:items.map(tenantView),defaultSchoolId:defaultTenantId()});
    }
    const body=await request.json();
    if(request.method==="POST"){
      const cityCode=tenantIdValue(body.cityCode),schoolLevel=tenantIdValue(body.schoolLevel),schoolSlug=schoolSlugValue(body.schoolSlug),schoolName=clean(body.schoolName,120);
      if(!CITY_MAP[cityCode])return json({error:"請選擇有效的縣市"},400);
      if(!LEVEL_MAP[schoolLevel])return json({error:"請選擇有效的學制"},400);
      if(!schoolSlug||schoolSlug.length<2)return json({error:"英文校名識別碼至少 2 碼，只能使用小寫英文、數字與 -"},400);
      if(!schoolName)return json({error:"請填寫學校名稱"},400);
      const schoolId=composeSchoolId(cityCode,schoolSlug,schoolLevel);
      if(await getTenantDirectory(schoolId))return json({error:"此學校識別碼已存在："+schoolId},409);
      const entity=await saveTenantDirectory(schoolId,{schoolName,shortName:clean(body.shortName,60),systemName:clean(body.systemName,160),schoolSlug,cityCode,cityName:CITY_MAP[cityCode],schoolLevel,schoolLevelName:LEVEL_MAP[schoolLevel],timezone:clean(body.timezone,80)||"Asia/Taipei",status:"setup"},a.email);
      await writeGlobalAudit({actorEmail:a.email,action:"tenant_create",schoolId,targetEmail:"",details:{schoolName,cityCode,cityName:CITY_MAP[cityCode],schoolLevel,schoolLevelName:LEVEL_MAP[schoolLevel],schoolSlug}});
      return json({ok:true,item:tenantView(entity)},201);
    }
    const schoolId=tenantIdValue(body.schoolId);
    if(!schoolId)return json({error:"缺少 schoolId"},400);
    const old=await getTenantDirectory(schoolId);if(!old)return json({error:"找不到學校 Tenant"},404);
    let status=clean(body.status,20)||String(old.status||"setup");
    if(!["active","inactive","setup","onboarding"].includes(status))return json({error:"學校狀態不正確"},400);
    if(schoolId===defaultTenantId())status="active";
    else if(status!==String(old.status||"setup")&&["active","onboarding"].includes(status))return json({error:"請使用 Phase 4 Onboarding 流程變更此狀態"},409);
    else if(["active","onboarding"].includes(String(old.status||""))&&status!==String(old.status))return json({error:"正式營運或驗證中狀態只能由 Phase 4 Onboarding 流程變更"},409);
    const cityCode=tenantIdValue(body.cityCode||old.cityCode),schoolLevel=tenantIdValue(body.schoolLevel||old.schoolLevel);
    if(!CITY_MAP[cityCode])return json({error:"請選擇有效的縣市"},400);
    if(!LEVEL_MAP[schoolLevel])return json({error:"請選擇有效的學制"},400);
    const entity=await saveTenantDirectory(schoolId,{schoolName:clean(body.schoolName,120)||old.schoolName,shortName:clean(body.shortName,60)||old.shortName,systemName:clean(body.systemName,160)||old.systemName,schoolSlug:schoolSlugValue(body.schoolSlug||old.schoolSlug),cityCode,cityName:CITY_MAP[cityCode]||old.cityName||"",schoolLevel,schoolLevelName:LEVEL_MAP[schoolLevel]||old.schoolLevelName||"",timezone:clean(body.timezone,80)||old.timezone,status},a.email);
    await writeGlobalAudit({actorEmail:a.email,action:"tenant_update",schoolId,details:{before:{status:String(old.status||""),schoolName:String(old.schoolName||"")},after:{status:entity.status,schoolName:entity.schoolName,cityCode:entity.cityCode,schoolLevel:entity.schoolLevel,timezone:entity.timezone}}});
    return json({ok:true,item:tenantView(entity)});
  }
});

app.http("tenantAdmins",{
  methods:["GET","PATCH"],authLevel:"anonymous",route:"tenant-admins",
  handler:async request=>{
    const g=await requireGlobal(request);if(g.error)return g.error;const a=g.a;
    const schoolId=tenantIdValue(request.query.get("schoolId")||"");
    if(request.method==="GET"){
      if(!schoolId)return json({error:"缺少 schoolId"},400);
      if(!await getTenantDirectory(schoolId))return json({error:"找不到學校 Tenant"},404);
      const items=await listTenantAdmins(schoolId,"");
      return json({schoolId,items:items.map(adminView)});
    }
    const body=await request.json(),sid=tenantIdValue(body.schoolId),email=clean(body.email,320).toLowerCase(),action=clean(body.action,20).toLowerCase();
    if(!sid||!await getTenantDirectory(sid))return json({error:"找不到學校 Tenant"},404);
    if(!isEmail(email))return json({error:"管理員 Email 格式不正確"},400);
    if(!["grant","revoke"].includes(action))return json({error:"action 必須為 grant 或 revoke"},400);
    const entity=await saveTenantUserRole(email,sid,"schoolAdmin",action==="grant"?"active":"inactive",a.email);
    await writeGlobalAudit({actorEmail:a.email,action:action==="grant"?"school_admin_grant":"school_admin_revoke",schoolId:sid,targetEmail:email,details:{}});
    return json({ok:true,item:adminView(entity)});
  }
});

function emptyAttendance(){return {total:0,present:0,late:0,leave:0,absent:0,cancelled:0,attended:0,attendanceRate:null}}
function finalizeAttendance(item={}){
  const out={...emptyAttendance(),...item};
  out.attended=Number(out.present||0)+Number(out.late||0);
  out.attendanceRate=Number(out.total||0)>0?Math.round(out.attended/Number(out.total)*1000)/10:null;
  return out;
}
function mergeAttendance(...items){
  const out=emptyAttendance();
  for(const item of items)for(const key of ["total","present","late","leave","absent","cancelled"])out[key]+=Number(item?.[key]||0);
  return finalizeAttendance(out);
}
async function canonicalActivityStudentId(rawStudentId,schoolId,cache){
  const raw=String(rawStudentId||"").trim();
  if(!raw)return "";
  if(cache.has(raw))return cache.get(raw);
  let canonical=raw;
  try{canonical=String((await getStudentAliasInfo(raw,schoolId)).canonicalStudentId||raw)}catch{}
  cache.set(raw,canonical);return canonical;
}
async function aggregateActivity(key,schoolId,startDate="",endDate="",eventDate=""){
  // Group attendance keeps the newest effective row per student/course/date.
  // Private lessons keep separate sessions, while duplicate writes for the same session collapse.
  const latest=new Map(),canonicalCache=new Map();
  const classType=key==="ensemble"?"ensemble":key==="comprehensive"?"comprehensive":key==="privateLesson"?"private":"section";
  for(const entity of await listActivityRange(key,schoolId,startDate,endDate,eventDate)){
    const studentId=await canonicalActivityStudentId(activityStudentId(entity),schoolId,canonicalCache);
    if(!studentId)continue;
    const date=String(entity.eventDate||eventDate||"");
    const sessionId=String(entity.sessionId||entity.lessonId||"")||[studentId,date,String(entity.startTime||""),String(entity.endTime||""),String(entity.teacherEmail||entity.teacher||"").trim().toLowerCase()].join("|");
    const dedupeKey=key==="privateLesson"
      ?[studentId,date,classType,sessionId].join("|")
      :[studentId,date,classType,String(entity.groupName||""),String(entity.section||"")].join("|");
    const stamp=`${String(entity.createdAt||entity.updatedAt||"")}|${String(entity.rowKey||"")}`;
    const old=latest.get(dedupeKey),oldStamp=old?`${String(old.createdAt||old.updatedAt||"")}|${String(old.rowKey||"")}`:"";
    if(!old||stamp>=oldStamp)latest.set(dedupeKey,entity);
  }
  const counts=emptyAttendance();
  for(const entity of latest.values()){
    const status=String(entity.status||"").trim().toLowerCase();
    if(status==="cancelled"){counts.cancelled++;continue}
    if(["present","late","leave","absent"].includes(status)){counts.total++;counts[status]++}
  }
  return finalizeAttendance(counts);
}
async function attendanceSummary(schoolId,startDate="",endDate="",eventDate=""){
  const [section,ensemble,comprehensive,privateLesson]=await Promise.all([
    aggregateActivity("section",schoolId,startDate,endDate,eventDate),
    aggregateActivity("ensemble",schoolId,startDate,endDate,eventDate),
    aggregateActivity("comprehensive",schoolId,startDate,endDate,eventDate),
    aggregateActivity("privateLesson",schoolId,startDate,endDate,eventDate)
  ]);
  return {total:mergeAttendance(section,ensemble,comprehensive,privateLesson),byClass:{section,ensemble,comprehensive,privateLesson}};
}
function taipeiDateOf(value){
  if(!value)return "";
  try{return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value))}catch{return ""}
}
async function schoolDashboardSummary(tenant,today,memberSchoolIds){
  const schoolId=String(tenant.rowKey||tenant.schoolId||"");
  const [students,teachers,parentMaps,admins,attendance]=await Promise.all([
    listStudentMaster("active",schoolId),listTeacherDirectory(schoolId),listUserStudentMappings("active",schoolId),listTenantAdmins(schoolId,"active"),attendanceSummary(schoolId,"","",today)
  ]);
  const activeTeachers=teachers.filter(x=>String(x.status||"active")==="active");
  const loggedInToday=activeTeachers.filter(x=>taipeiDateOf(x.lastLoginAt)===today).length;
  return {
    ...tenantView(tenant),schoolAdminCount:admins.length,isSchoolManager:memberSchoolIds.has(schoolId),
    studentCount:students.length,parentAccountCount:new Set(parentMaps.map(x=>String(x.parentEmail||"").trim().toLowerCase()).filter(Boolean)).size,
    teacherStatus:{active:activeTeachers.length,loggedInToday,inactive:teachers.length-activeTeachers.length},
    todayAttendance:attendance.total,todayAttendanceRecords:attendance.total.total,
    dataMode:String(tenant.status||"setup")==="active"?"tenant-scoped-operational":String(tenant.status||"")==="onboarding"?"tenant-onboarding-testing":"tenant-ready-no-data"
  };
}

app.http("globalDashboard",{
  methods:["GET"],authLevel:"anonymous",route:"global-dashboard",
  handler:async request=>{
    const g=await requireGlobal(request);if(g.error)return g.error;
    await ensureTenantTables();const tenants=await listTenantDirectory(),today=taipeiDate();
    const memberSchoolIds=new Set((g.a.memberships||[]).filter(x=>String(x.status||"active")==="active").map(x=>String(x.schoolId||"")));
    const schools=await Promise.all(tenants.map(tenant=>schoolDashboardSummary(tenant,today,memberSchoolIds)));
    const statusCounts=schools.reduce((out,x)=>{const status=["active","onboarding","setup","inactive"].includes(x.status)?x.status:"setup";out[status]++;return out},{active:0,onboarding:0,setup:0,inactive:0});
    return json({
      today,phase:"multi-tenant-phase-4-onboarding",aggregateOnly:true,schoolCount:schools.length,statusCounts,
      totals:{students:schools.reduce((n,x)=>n+Number(x.studentCount||0),0),teachers:schools.reduce((n,x)=>n+Number(x.teacherStatus?.active||0),0),parentAccounts:schools.reduce((n,x)=>n+Number(x.parentAccountCount||0),0),todayAttendanceRecords:schools.reduce((n,x)=>n+Number(x.todayAttendanceRecords||0),0)},
      schools,
      notice:"Phase 4 Onboarding 以隔離驗證閘門控制新學校啟用；Global Console 僅提供跨校彙總數字，不回傳學生、家長或老師明細。"
    });
  }
});

app.http("globalAttendance",{
  methods:["GET"],authLevel:"anonymous",route:"global-attendance",
  handler:async request=>{
    const g=await requireGlobal(request);if(g.error)return g.error;
    const month=clean(request.query.get("month")||taipeiDate().slice(0,7),7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return json({error:"month 必須為 YYYY-MM"},400);
    await ensureTenantTables();
    const tenants=await listTenantDirectory(),startDate=`${month}-01`,endDate=`${month}-31`;
    const schools=await Promise.all(tenants.map(async tenant=>{
      const schoolId=String(tenant.rowKey||tenant.schoolId||""),attendance=await attendanceSummary(schoolId,startDate,endDate);
      return {schoolId,schoolName:String(tenant.schoolName||schoolId),shortName:String(tenant.shortName||""),cityName:String(tenant.cityName||""),schoolLevelName:String(tenant.schoolLevelName||""),status:String(tenant.status||"setup"),total:attendance.total,byClass:attendance.byClass};
    }));
    return json({month,startDate,endDate,aggregateOnly:true,totals:mergeAttendance(...schools.map(x=>x.total)),schools,notice:"本報表只回傳各校彙總出勤數，不含學生、家長或老師個資。"});
  }
});

function healthCheck(key,label,status,detail){return {key,label,status,detail}}
function healthSummary(checks){
  const summary={healthy:0,warning:0,critical:0};
  for(const check of checks)summary[check.status]=(summary[check.status]||0)+1;
  return {overall:summary.critical?"critical":summary.warning?"warning":"healthy",summary};
}

app.http("globalHealth",{
  methods:["GET"],authLevel:"anonymous",route:"global-health",
  handler:async request=>{
    const g=await requireGlobal(request);if(g.error)return g.error;
    const checks=[healthCheck("global-auth","Global 權限驗證","healthy","已驗證 Global Admin 身分")];
    const environment={storage:Boolean(process.env.STORAGE_CONNECTION_STRING),googleLogin:Boolean(process.env.GOOGLE_CLIENT_ID),bootstrapAdmin:Boolean(String(process.env.ADMIN_EMAILS||"").trim()),emailService:Boolean(process.env.ACS_EMAIL_CONNECTION_STRING&&process.env.ACS_EMAIL_SENDER)};
    checks.push(healthCheck("storage-config","Azure Storage 設定",environment.storage?"healthy":"critical",environment.storage?"已設定":"缺少必要設定"));
    checks.push(healthCheck("google-login","Google 登入設定",environment.googleLogin?"healthy":"critical",environment.googleLogin?"已設定":"缺少必要設定"));
    checks.push(healthCheck("bootstrap-admin","Global 啟動管理員",environment.bootstrapAdmin?"healthy":"warning",environment.bootstrapAdmin?"已設定":"未設定備援啟動管理員"));
    checks.push(healthCheck("email-service","通知郵件服務",environment.emailService?"healthy":"warning",environment.emailService?"已設定":"郵件通知尚未完整設定"));
    let tablesReady=true;
    try{await ensureTenantTables()}catch(error){tablesReady=false;checks.push(healthCheck("tenant-tables","Tenant 資料表","critical","無法連線或建立必要資料表"))}
    if(tablesReady)checks.push(healthCheck("tenant-tables","Tenant 資料表","healthy","必要資料表可存取"));
    let tenants=[],isolation={rows:0,invalid:0,byTable:[]},migrationStatus="unavailable",adminCoverage={required:0,covered:0,missing:0};
    if(tablesReady){
      tenants=await listTenantDirectory();const schoolIds=new Set(tenants.map(x=>String(x.rowKey||x.schoolId||"")));
      const defaultTenant=tenants.find(x=>String(x.rowKey||x.schoolId||"")===defaultTenantId());
      checks.push(healthCheck("default-tenant","聖心 Tenant 狀態",defaultTenant&&String(defaultTenant.status)==="active"?"healthy":"critical",defaultTenant&&String(defaultTenant.status)==="active"?"已啟用":"找不到或未啟用"));
      try{const marker=await table("tenantMigration").getEntity(defaultTenantId(),"phase2-tenant-scope-v1");migrationStatus=String(marker.status||"not_started")}catch(error){if(error.statusCode===404)migrationStatus="not_started";else migrationStatus="error"}
      checks.push(healthCheck("phase2-migration","Phase 2 Tenant 遷移",migrationStatus==="verified"?"healthy":"critical",migrationStatus==="verified"?"完整性已驗證":`目前狀態：${migrationStatus}`));
      const operational=tenants.filter(x=>["active","onboarding","setup"].includes(String(x.status||"setup")));
      const coverage=await Promise.all(operational.map(async tenant=>({schoolId:String(tenant.rowKey),count:(await listTenantAdmins(String(tenant.rowKey),"active")).length})));
      adminCoverage={required:coverage.length,covered:coverage.filter(x=>x.count>0).length,missing:coverage.filter(x=>x.count===0).length};
      checks.push(healthCheck("school-admin-coverage","School Admin 覆蓋",adminCoverage.missing===0?"healthy":"warning",adminCoverage.missing===0?`${adminCoverage.covered} 所學校皆已指派`:`${adminCoverage.missing} 所學校尚未指派`));
      try{isolation=await scanTenantIsolation(schoolIds);checks.push(healthCheck("tenant-isolation","Tenant 鍵值隔離",isolation.invalid===0?"healthy":"critical",isolation.invalid===0?`${isolation.rows} 筆資料通過`:`發現 ${isolation.invalid} 筆鍵值異常`))}catch{checks.push(healthCheck("tenant-isolation","Tenant 鍵值隔離","critical","完整性掃描失敗"))}
    }
    const result=healthSummary(checks);
    return json({checkedAt:new Date().toISOString(),phase:"multi-tenant-phase-4-onboarding",overall:result.overall,summary:result.summary,checks,environment,isolation,tenants:{total:tenants.length,active:tenants.filter(x=>x.status==="active").length,onboarding:tenants.filter(x=>x.status==="onboarding").length,setup:tenants.filter(x=>x.status==="setup").length,inactive:tenants.filter(x=>x.status==="inactive").length,adminCoverage},migrationStatus,aggregateOnly:true});
  }
});
