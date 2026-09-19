import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import {
  ensureDefaultTenant,listTenantDirectory,getTenantDirectory,saveTenantDirectory,
  listTenantAdmins,saveTenantUserRole,writeGlobalAudit,defaultTenantId,
  listStudentMaster,listTeacherDirectory,listUserStudentMappings,table,ensureTables,tenantIdValue
} from "../lib/storage.js";

function clean(v,max=200){return String(v??"").trim().slice(0,max)}
function isEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim())}
function tenantView(t){return {
  schoolId:String(t.rowKey||t.schoolId||""),schoolName:String(t.schoolName||""),shortName:String(t.shortName||""),
  systemName:String(t.systemName||""),schoolSlug:String(t.schoolSlug||""),cityCode:String(t.cityCode||""),cityName:String(t.cityName||""),schoolLevel:String(t.schoolLevel||""),schoolLevelName:String(t.schoolLevelName||""),status:String(t.status||"setup"),timezone:String(t.timezone||"Asia/Taipei"),
  createdAt:String(t.createdAt||""),updatedAt:String(t.updatedAt||""),updatedBy:String(t.updatedBy||"")
}}
function adminView(x){return {email:String(x.partitionKey||""),schoolId:String(x.schoolId||x.rowKey||""),role:String(x.role||""),status:String(x.status||""),createdAt:String(x.createdAt||""),updatedAt:String(x.updatedAt||"")}}
function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function safe(v){return String(v||"").replaceAll("'","''")}
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
    const old=await getTenantDirectory(schoolId);if(!old)return json({error:"找不到學校 Tenant"},404);
    let status=clean(body.status,20)||String(old.status||"setup");
    if(schoolId===defaultTenantId())status="active";
    else if(status==="active")return json({error:"新學校目前仍在 Tenant 隔離建置階段，Phase 2 完成前不可啟用，以避免跨校資料外洩"},409);
    const cityCode=tenantIdValue(body.cityCode||old.cityCode),schoolLevel=tenantIdValue(body.schoolLevel||old.schoolLevel);
    const entity=await saveTenantDirectory(schoolId,{schoolName:clean(body.schoolName,120)||old.schoolName,shortName:clean(body.shortName,60)||old.shortName,systemName:clean(body.systemName,160)||old.systemName,schoolSlug:schoolSlugValue(body.schoolSlug||old.schoolSlug),cityCode,cityName:CITY_MAP[cityCode]||old.cityName||"",schoolLevel,schoolLevelName:LEVEL_MAP[schoolLevel]||old.schoolLevelName||"",timezone:clean(body.timezone,80)||old.timezone,status},a.email);
    await writeGlobalAudit({actorEmail:a.email,action:"tenant_update",schoolId,details:{status:entity.status,schoolName:entity.schoolName}});
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

async function countTodayRows(key,date){
  // Keep the Global dashboard aligned with the school daily-followup view.
  // Group/section/comprehensive attendance keeps one effective latest row per student/course scope.
  // Private lessons are separate sessions: each lessonId/sessionId counts independently.
  const latest=new Map();
  const classType=key==="ensemble"?"ensemble":key==="comprehensive"?"comprehensive":key==="privateLesson"?"private":"section";
  for await(const e of table(key).listEntities({queryOptions:{filter:`eventDate eq '${safe(date)}'`}})){
    const studentId=String(e.partitionKey||"");
    const groupName=String(e.groupName||"");
    const section=String(e.section||"");
    const sessionId=String(e.sessionId||e.lessonId||e.rowKey||"");
    const dedupeKey=key==="privateLesson"
      ?[studentId,date,classType,sessionId].join("|")
      :[studentId,date,classType,groupName,section].join("|");
    const stamp=`${String(e.createdAt||"")}|${String(e.rowKey||"")}`;
    const old=latest.get(dedupeKey);
    const oldStamp=old?`${String(old.createdAt||"")}|${String(old.rowKey||"")}`:"";
    if(!old||stamp>=oldStamp)latest.set(dedupeKey,e);
  }

  const counts={total:0,present:0,late:0,leave:0,absent:0,cancelled:0};
  for(const e of latest.values()){
    const status=String(e.status||"").toLowerCase();
    if(status==="cancelled"){counts.cancelled++;continue}
    counts.total++;
    if(Object.prototype.hasOwnProperty.call(counts,status))counts[status]++;
  }
  return counts;
}
function mergeAttendance(...items){
  const out={total:0,present:0,late:0,leave:0,absent:0,cancelled:0};
  for(const item of items)for(const k of Object.keys(out))out[k]+=Number(item?.[k]||0);
  return out;
}
function taipeiDateOf(value){
  if(!value)return "";
  try{return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value))}catch{return ""}
}

app.http("globalDashboard",{
  methods:["GET"],authLevel:"anonymous",route:"global-dashboard",
  handler:async request=>{
    const g=await requireGlobal(request);if(g.error)return g.error;
    await ensureTables();const tenants=await listTenantDirectory(),today=taipeiDate(),defaultId=defaultTenantId();
    const [students,teachers,parentMaps,todaySection,todayEnsemble,todayComprehensive,todayPrivate]=await Promise.all([
      listStudentMaster("active"),listTeacherDirectory(),listUserStudentMappings("active"),
      countTodayRows("section",today),countTodayRows("ensemble",today),countTodayRows("comprehensive",today),countTodayRows("privateLesson",today)
    ]);
    const todayAttendance=mergeAttendance(todaySection,todayEnsemble,todayComprehensive,todayPrivate);
    const activeTeachers=teachers.filter(x=>String(x.status||"active")==="active");
    const teachersLoggedInToday=activeTeachers.filter(x=>taipeiDateOf(x.lastLoginAt)===today).length;
    const memberSchoolIds=new Set((g.a.memberships||[]).filter(x=>String(x.status||"active")==="active").map(x=>String(x.schoolId||"")));
    const schools=[];
    for(const t of tenants){
      const sid=String(t.rowKey),admins=await listTenantAdmins(sid,"active"),isDefault=sid===defaultId;
      const isSchoolManager=memberSchoolIds.has(sid);
      schools.push({
        schoolId:sid,schoolName:String(t.schoolName||sid),cityCode:String(t.cityCode||""),cityName:String(t.cityName||""),schoolLevel:String(t.schoolLevel||""),schoolLevelName:String(t.schoolLevelName||""),schoolSlug:String(t.schoolSlug||""),status:String(t.status||"setup"),schoolAdminCount:admins.length,isSchoolManager,
        studentCount:isSchoolManager&&isDefault?students.length:null,
        parentAccountCount:isSchoolManager&&isDefault?new Set(parentMaps.map(x=>String(x.parentEmail||"").toLowerCase()).filter(Boolean)).size:null,
        teacherStatus:isDefault?{active:activeTeachers.length,loggedInToday:teachersLoggedInToday,inactive:teachers.length-activeTeachers.length}:{active:0,loggedInToday:0,inactive:0},
        todayAttendance:isDefault?todayAttendance:{total:0,present:0,late:0,leave:0,absent:0,cancelled:0},
        todayAttendanceRecords:isDefault?todayAttendance.total:0,
        dataMode:isDefault?"legacy-default":"tenant-isolation-pending"
      });
    }
    return json({
      today,phase:"multi-tenant-phase-1",schoolCount:schools.length,
      totals:{students:schools.reduce((n,x)=>n+Number(x.studentCount||0),0),teachers:schools.reduce((n,x)=>n+Number(x.teacherStatus?.active||0),0),parentAccounts:schools.reduce((n,x)=>n+Number(x.parentAccountCount||0),0),todayAttendanceRecords:schools.reduce((n,x)=>n+Number(x.todayAttendanceRecords||0),0)},
      schools,
      notice:"Phase 1 僅建立 Tenant 與權限治理。聖心小學沿用既有資料；新學校維持 setup，不會開放登入既有營運資料，待 Phase 2 完成資料隔離後才可啟用。"
    });
  }
});
