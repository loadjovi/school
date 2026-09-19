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
  systemName:String(t.systemName||""),status:String(t.status||"setup"),timezone:String(t.timezone||"Asia/Taipei"),
  createdAt:String(t.createdAt||""),updatedAt:String(t.updatedAt||""),updatedBy:String(t.updatedBy||"")
}}
function adminView(x){return {email:String(x.partitionKey||""),schoolId:String(x.schoolId||x.rowKey||""),role:String(x.role||""),status:String(x.status||""),createdAt:String(x.createdAt||""),updatedAt:String(x.updatedAt||"")}}
function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function safe(v){return String(v||"").replaceAll("'","''")}

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
      const schoolId=tenantIdValue(body.schoolId),schoolName=clean(body.schoolName,120);
      if(!schoolId||schoolId.length<3)return json({error:"schoolId 至少 3 碼，只能使用英文、數字與 -"},400);
      if(!schoolName)return json({error:"請填寫學校名稱"},400);
      if(await getTenantDirectory(schoolId))return json({error:"此 schoolId 已存在"},409);
      const entity=await saveTenantDirectory(schoolId,{schoolName,shortName:clean(body.shortName,60),systemName:clean(body.systemName,160),timezone:clean(body.timezone,80)||"Asia/Taipei",status:"setup"},a.email);
      await writeGlobalAudit({actorEmail:a.email,action:"tenant_create",schoolId,targetEmail:"",details:{schoolName}});
      return json({ok:true,item:tenantView(entity)},201);
    }
    const schoolId=tenantIdValue(body.schoolId);
    const old=await getTenantDirectory(schoolId);if(!old)return json({error:"找不到學校 Tenant"},404);
    let status=clean(body.status,20)||String(old.status||"setup");
    if(schoolId===defaultTenantId())status="active";
    else if(status==="active")return json({error:"新學校目前仍在 Tenant 隔離建置階段，Phase 2 完成前不可啟用，以避免跨校資料外洩"},409);
    const entity=await saveTenantDirectory(schoolId,{schoolName:clean(body.schoolName,120)||old.schoolName,shortName:clean(body.shortName,60)||old.shortName,systemName:clean(body.systemName,160)||old.systemName,timezone:clean(body.timezone,80)||old.timezone,status},a.email);
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
  let n=0;for await(const e of table(key).listEntities({queryOptions:{filter:`eventDate eq '${safe(date)}'`}})){if(String(e.status||"")!=="cancelled")n++}return n
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
    const schools=[];
    for(const t of tenants){
      const sid=String(t.rowKey),admins=await listTenantAdmins(sid,"active"),isDefault=sid===defaultId;
      schools.push({
        schoolId:sid,schoolName:String(t.schoolName||sid),status:String(t.status||"setup"),schoolAdminCount:admins.length,
        studentCount:isDefault?students.length:0,teacherCount:isDefault?teachers.filter(x=>String(x.status||"active")==="active").length:0,
        parentAccountCount:isDefault?new Set(parentMaps.map(x=>String(x.parentEmail||"").toLowerCase()).filter(Boolean)).size:0,
        todayAttendanceRecords:isDefault?(todaySection+todayEnsemble+todayComprehensive+todayPrivate):0,
        dataMode:isDefault?"legacy-default":"tenant-isolation-pending"
      });
    }
    return json({
      today,phase:"multi-tenant-phase-1",schoolCount:schools.length,
      totals:{students:schools.reduce((n,x)=>n+x.studentCount,0),teachers:schools.reduce((n,x)=>n+x.teacherCount,0),parentAccounts:schools.reduce((n,x)=>n+x.parentAccountCount,0),todayAttendanceRecords:schools.reduce((n,x)=>n+x.todayAttendanceRecords,0)},
      schools,
      notice:"Phase 1 僅建立 Tenant 與權限治理。聖心小學沿用既有資料；新學校維持 setup，不會開放登入既有營運資料，待 Phase 2 完成資料隔離後才可啟用。"
    });
  }
});
