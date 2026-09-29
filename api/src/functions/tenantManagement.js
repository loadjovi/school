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

function parseJsonArray(value){
  if(Array.isArray(value))return value;
  try{const x=JSON.parse(String(value||"[]"));return Array.isArray(x)?x:[]}catch{return []}
}
function attendanceBucket(){return {total:0,present:0,late:0,leave:0,absent:0,cancelled:0,attended:0,attendanceRate:null}}
function addAttendance(bucket,status){
  status=String(status||"");
  if(status==="cancelled"){bucket.cancelled++;return}
  if(!["present","late","leave","absent"].includes(status))return;
  bucket.total++;bucket[status]++;
  if(status==="present"||status==="late")bucket.attended++;
}
function doneAttendance(bucket){
  bucket.attendanceRate=bucket.total?Math.round(bucket.attended/bucket.total*1000)/10:null;
  return bucket;
}
function mergeWorkAttendance(...items){
  const out=attendanceBucket();
  for(const x of items){for(const k of ["total","present","late","leave","absent","cancelled","attended"])out[k]+=Number(x?.[k]||0)}
  return doneAttendance(out);
}
function hoursTextNumber(minutes){return Math.round(Number(minutes||0)/60*100)/100}
function teacherKeyValue(email){return String(email||"").trim().toLowerCase()}
async function globalTeacherProfiles(schoolId){
  const sid=String(schoolId||"").replaceAll("'","''"),items=[];
  for await(const e of table("tenantTeacherProfile").listEntities({queryOptions:{filter:`PartitionKey eq '${sid}'`}}))items.push(e);
  return items;
}
async function confirmedTrainingEvents(schoolId,startDate,endDate){
  const sid=String(schoolId||"").replaceAll("'","''"),items=[];
  const filter=`PartitionKey eq '${sid}' and eventDate ge '${startDate}' and eventDate le '${endDate}'`;
  for await(const e of table("tenantCalendarEvent").listEntities({queryOptions:{filter}})){
    if(String(e.eventType||"")!=="competition_training"||String(e.status||"active")!=="active")continue;
    const minutes=Number(e.teachingMinutes||0),email=teacherKeyValue(e.teachingTeacherEmail);
    if(!e.teachingConfirmedAt||!email||!Number.isInteger(minutes)||minutes<1||minutes>600)continue;
    items.push(e);
  }
  return items;
}
function profileCandidate(type,row,profiles=[]){
  const group=String(row?.groupName||""),section=String(row?.section||"");
  return profiles.filter(p=>{
    if(type==="section")return parseJsonArray(p.sectionAssignments).some(a=>String(a?.groupName||a?.group||"")===group&&String(a?.section||"")===section);
    if(type==="ensemble")return parseJsonArray(p.ensembleGroups).map(String).includes(group);
    if(type==="comprehensive")return p.comprehensiveEnabled===true;
    return false;
  });
}
function courseLabel(type){return ({section:"分部課",ensemble:"合奏課",comprehensive:"綜合課",practice:"加練課",privateLesson:"個別課"})[type]||type}
function defaultCourseMinutes(type){return ({section:45,ensemble:50,comprehensive:90,practice:0})[type]||0}
function sessionKeyFor(type,row){
  const date=String(row.eventDate||"");
  if(type==="section")return [date,type,String(row.groupName||""),String(row.section||"")].join("|");
  if(type==="ensemble")return [date,type,String(row.groupName||"")].join("|");
  if(type==="comprehensive")return [date,type].join("|");
  return [date,type,String(row.sessionId||row.rowKey||""),String(row.teacher||"")].join("|");
}
function latestRowsForSessions(type,rows=[]){
  const latest=new Map();
  for(const row of rows){
    const student=activityStudentId(row),key=[sessionKeyFor(type,row),student].join("|"),old=latest.get(key);
    const stamp=`${String(row.createdAt||row.updatedAt||"")}|${String(row.rowKey||"")}`,oldStamp=old?`${String(old.createdAt||old.updatedAt||"")}|${String(old.rowKey||"")}`:"";
    if(!old||stamp>=oldStamp)latest.set(key,row);
  }
  return [...latest.values()];
}
function resolveTeachingTeacher(type,rows,profiles,directoryMap){
  const latest=[...rows].sort((a,b)=>String(b.createdAt||b.updatedAt||"").localeCompare(String(a.createdAt||a.updatedAt||"")))[0]||{};
  const recorderEmail=teacherKeyValue(latest.teacher),recorderName=String(latest.teacherName||directoryMap.get(recorderEmail)?.teacherName||latest.teacher||""),recorderRole=String(latest.actorRole||"teacher");
  const candidates=profileCandidate(type,latest,profiles).map(p=>{
    const email=teacherKeyValue(p.teacherEmail||p.rowKey),dir=directoryMap.get(email);
    return {email,name:String(p.displayName||dir?.teacherName||email)};
  });
  const matching=candidates.find(x=>x.email&&x.email===recorderEmail);
  if(matching)return {teacherEmail:matching.email,teacherName:matching.name,teacherSource:"點名老師符合授課設定",recorderEmail,recorderName,recorderRole,candidates};
  if(recorderRole!=="admin"&&recorderEmail&&directoryMap.has(recorderEmail))return {teacherEmail:recorderEmail,teacherName:String(directoryMap.get(recorderEmail)?.teacherName||recorderName||recorderEmail),teacherSource:"老師本人點名",recorderEmail,recorderName,recorderRole,candidates};
  if(candidates.length===1)return {teacherEmail:candidates[0].email,teacherName:candidates[0].name,teacherSource:"依授課設定判定",recorderEmail,recorderName,recorderRole,candidates};
  return {teacherEmail:"",teacherName:"待確認授課老師",teacherSource:candidates.length?"多位授課候選，未自動認列工時":"無可辨識授課老師",recorderEmail,recorderName,recorderRole,candidates};
}
async function teacherOperationsForSchool(tenant,startDate,endDate){
  const schoolId=String(tenant.rowKey||tenant.schoolId||"");
  const [sectionRaw,ensembleRaw,comprehensiveRaw,privateRaw,directory,profiles,trainingRaw]=await Promise.all([
    listActivityRange("section",schoolId,startDate,endDate),
    listActivityRange("ensemble",schoolId,startDate,endDate),
    listActivityRange("comprehensive",schoolId,startDate,endDate),
    listActivityRange("privateLesson",schoolId,startDate,endDate),
    listTeacherDirectory(schoolId),
    globalTeacherProfiles(schoolId),
    confirmedTrainingEvents(schoolId,startDate,endDate)
  ]);
  const directoryMap=new Map(directory.map(x=>[teacherKeyValue(x.teacherEmail||x.rowKey),x]));
  const sessions=[];
  const groupTypes=[["section",sectionRaw],["ensemble",ensembleRaw],["comprehensive",comprehensiveRaw]];
  for(const [type,raw] of groupTypes){
    const grouped=new Map();
    for(const row of latestRowsForSessions(type,raw)){
      const key=sessionKeyFor(type,row),arr=grouped.get(key)||[];arr.push(row);grouped.set(key,arr);
    }
    for(const [key,rows] of grouped){
      const attendance=attendanceBucket();for(const r of rows)addAttendance(attendance,r.status);doneAttendance(attendance);
      if(attendance.cancelled===rows.length)continue;
      const teacher=resolveTeachingTeacher(type,rows,profiles,directoryMap),sample=rows[0]||{};
      const positiveMinutes=rows.map(r=>Number(r.minutes||0)).filter(n=>n>0),durationMinutes=positiveMinutes.length?Math.max(...positiveMinutes):defaultCourseMinutes(type);
      sessions.push({
        sessionKey:key,courseType:type,courseLabel:courseLabel(type),eventDate:String(sample.eventDate||""),groupName:String(sample.groupName||""),section:String(sample.section||""),
        durationMinutes,teachingHours:hoursTextNumber(durationMinutes),attendance,
        teacherEmail:teacher.teacherEmail,teacherName:teacher.teacherName,teacherSource:teacher.teacherSource,
        recordedByEmail:teacher.recorderEmail,recordedBy:teacher.recorderName,recordedByRole:teacher.recorderRole,
        teacherCandidates:teacher.candidates.map(x=>x.name),feedbackCount:0,feedbackAverage:null
      });
    }
  }

  // 個別課：老師完課待家長確認也算已完成教學；家長星級只作師資回饋。
  const privateLatest=new Map();
  for(const row of privateRaw){
    const key=String(row.sessionId||row.rowKey||[row.eventDate,row.startTime,row.endTime,row.studentId,row.teacher].join("|")),old=privateLatest.get(key);
    const stamp=String(row.updatedAt||row.createdAt||""),oldStamp=old?String(old.updatedAt||old.createdAt||""):"";
    if(!old||stamp>=oldStamp)privateLatest.set(key,row);
  }
  for(const [key,row] of privateLatest){
    const status=String(row.status||"");
    if(!["teacher_completed","present","late"].includes(status))continue;
    const teacherEmail=teacherKeyValue(row.teacher),teacherName=String(row.teacherName||directoryMap.get(teacherEmail)?.teacherName||row.teacher||"個課老師");
    const rating=Number(row.teacherRating||0),durationMinutes=Math.max(0,Number(row.minutes||0));
    sessions.push({
      sessionKey:key,courseType:"privateLesson",courseLabel:"個別課",eventDate:String(row.eventDate||""),groupName:String(row.groupName||""),section:String(row.section||""),
      durationMinutes,teachingHours:hoursTextNumber(durationMinutes),attendance:{total:1,present:status==="present"||status==="teacher_completed"?1:0,late:status==="late"?1:0,leave:0,absent:0,cancelled:0,attended:1,attendanceRate:100},
      teacherEmail,teacherName,teacherSource:"個課預約／完課老師",recordedByEmail:teacherEmail,recordedBy:teacherName,recordedByRole:"teacher",
      teacherCandidates:[teacherName],feedbackCount:rating>0?1:0,feedbackAverage:rating>0?rating:null,parentReview:String(row.teacherReview||"")
    });
  }

  // 加練只認列校方確認的實際授課時間；單純排入行事曆不產生老師工時。
  for(const row of trainingRaw){
    const teacherEmail=teacherKeyValue(row.teachingTeacherEmail),durationMinutes=Number(row.teachingMinutes);
    const teacherName=String(row.teachingTeacherName||directoryMap.get(teacherEmail)?.teacherName||teacherEmail);
    sessions.push({
      sessionKey:`calendar:${row.rowKey}`,courseType:"practice",courseLabel:String(row.title||"加練課"),eventDate:String(row.eventDate||""),groupName:String(row.targetGroups||""),section:"",
      durationMinutes,teachingHours:hoursTextNumber(durationMinutes),attendance:attendanceBucket(),
      teacherEmail,teacherName,teacherSource:"校方確認實際授課",recordedByEmail:String(row.teachingConfirmedBy||""),recordedBy:String(row.teachingConfirmedBy||""),recordedByRole:"admin",
      teacherCandidates:[teacherName],feedbackCount:0,feedbackAverage:null,confirmedAt:String(row.teachingConfirmedAt||""),startTime:String(row.startTime||""),endTime:String(row.endTime||"")
    });
  }

  const baseCourse=()=>({sessions:0,minutes:0,hours:0,attendance:attendanceBucket()});
  const schoolCourses={section:baseCourse(),ensemble:baseCourse(),comprehensive:baseCourse(),practice:{...baseCourse(),available:true,note:"只認列校方已確認的實際授課時間"},privateLesson:{sessions:0,minutes:0,hours:0,feedbackCount:0,feedbackAverage:null}};
  const teacherMap=new Map();
  const ensureTeacher=(email,name)=>{
    const key=email||`unassigned:${name||"unknown"}`;
    if(!teacherMap.has(key))teacherMap.set(key,{teacherKey:key,teacherEmail:email||"",teacherName:name||"待確認授課老師",course:{section:baseCourse(),ensemble:baseCourse(),comprehensive:baseCourse(),practice:{...baseCourse(),available:true},privateLesson:{sessions:0,minutes:0,hours:0,feedbackCount:0,feedbackAverage:null}},totalMinutes:0,totalHours:0,parentFeedbackCount:0,parentFeedbackAverage:null,sessions:[]});
    return teacherMap.get(key);
  };
  for(const d of directory.filter(x=>String(x.status||"active")==="active"))ensureTeacher(teacherKeyValue(d.teacherEmail||d.rowKey),String(d.teacherName||d.teacherEmail||d.rowKey));

  const schoolFeedback=[];
  for(const s of sessions){
    if(s.courseType==="privateLesson"){
      const sc=schoolCourses.privateLesson;sc.sessions++;sc.minutes+=s.durationMinutes;
      if(s.feedbackCount){sc.feedbackCount++;schoolFeedback.push(Number(s.feedbackAverage))}
    }else{
      const sc=schoolCourses[s.courseType];sc.sessions++;sc.minutes+=s.durationMinutes;sc.attendance=mergeWorkAttendance(sc.attendance,s.attendance);
    }
    if(s.teacherEmail){
      const t=ensureTeacher(s.teacherEmail,s.teacherName),tc=t.course[s.courseType];
      if(s.courseType==="privateLesson"){
        tc.sessions++;tc.minutes+=s.durationMinutes;if(s.feedbackCount){tc.feedbackCount++;t.parentFeedbackCount++;tc._ratings=tc._ratings||[];tc._ratings.push(Number(s.feedbackAverage));t._ratings=t._ratings||[];t._ratings.push(Number(s.feedbackAverage))}
      }else{
        tc.sessions++;tc.minutes+=s.durationMinutes;tc.attendance=mergeWorkAttendance(tc.attendance,s.attendance);
      }
      t.totalMinutes+=s.durationMinutes;t.sessions.push(s);
    }
  }
  for(const key of ["section","ensemble","comprehensive","practice"]){schoolCourses[key].hours=hoursTextNumber(schoolCourses[key].minutes);schoolCourses[key].attendance=doneAttendance(schoolCourses[key].attendance)}
  schoolCourses.privateLesson.hours=hoursTextNumber(schoolCourses.privateLesson.minutes);
  schoolCourses.privateLesson.feedbackAverage=schoolFeedback.length?Math.round(schoolFeedback.reduce((a,b)=>a+b,0)/schoolFeedback.length*100)/100:null;

  const teachers=[...teacherMap.values()].map(t=>{
    for(const key of ["section","ensemble","comprehensive","practice"]){t.course[key].hours=hoursTextNumber(t.course[key].minutes);t.course[key].attendance=doneAttendance(t.course[key].attendance)}
    t.course.privateLesson.hours=hoursTextNumber(t.course.privateLesson.minutes);
    const privateRatings=t.course.privateLesson._ratings||[];delete t.course.privateLesson._ratings;
    t.course.privateLesson.feedbackAverage=privateRatings.length?Math.round(privateRatings.reduce((a,b)=>a+b,0)/privateRatings.length*100)/100:null;
    const ratings=t._ratings||[];delete t._ratings;
    t.parentFeedbackAverage=ratings.length?Math.round(ratings.reduce((a,b)=>a+b,0)/ratings.length*100)/100:null;
    t.totalHours=hoursTextNumber(t.totalMinutes);
    t.sessions=t.sessions.sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||String(a.courseType).localeCompare(String(b.courseType)));
    return t;
  }).filter(t=>t.totalMinutes>0||directoryMap.has(t.teacherEmail)).sort((a,b)=>b.totalMinutes-a.totalMinutes||String(a.teacherName).localeCompare(String(b.teacherName),"zh-Hant"));

  const groupAttendance=mergeWorkAttendance(schoolCourses.section.attendance,schoolCourses.ensemble.attendance,schoolCourses.comprehensive.attendance);
  const unassigned=sessions.filter(x=>x.courseType!=="privateLesson"&&!x.teacherEmail);
  const teachingMinutes=sessions.filter(x=>x.teacherEmail).reduce((n,x)=>n+Number(x.durationMinutes||0),0);
  return {
    schoolId,schoolName:String(tenant.schoolName||schoolId),shortName:String(tenant.shortName||""),cityName:String(tenant.cityName||""),schoolLevelName:String(tenant.schoolLevelName||""),status:String(tenant.status||"setup"),
    summary:{groupSessions:schoolCourses.section.sessions+schoolCourses.ensemble.sessions+schoolCourses.comprehensive.sessions,groupAttendance,practiceSessions:schoolCourses.practice.sessions,practiceMinutes:schoolCourses.practice.minutes,privateLessons:schoolCourses.privateLesson.sessions,privateMinutes:schoolCourses.privateLesson.minutes,parentFeedbackCount:schoolCourses.privateLesson.feedbackCount,parentFeedbackAverage:schoolCourses.privateLesson.feedbackAverage,totalTeachingMinutes:teachingMinutes,totalTeachingHours:hoursTextNumber(teachingMinutes),unassignedSessions:unassigned.length},
    courseSummary:schoolCourses,teachers,audit:sessions,unassignedAudit:unassigned
  };
}

app.http("globalAttendance",{
  methods:["GET"],authLevel:"anonymous",route:"global-attendance",
  handler:async request=>{
    const g=await requireGlobal(request);if(g.error)return g.error;
    const month=clean(request.query.get("month")||taipeiDate().slice(0,7),7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return json({error:"month 必須為 YYYY-MM"},400);
    await ensureTenantTables();
    const tenants=await listTenantDirectory(),startDate=`${month}-01`,endDate=`${month}-31`;
    const schools=await Promise.all(tenants.map(tenant=>teacherOperationsForSchool(tenant,startDate,endDate)));
    const totals={
      schools:schools.length,
      groupSessions:schools.reduce((n,x)=>n+Number(x.summary?.groupSessions||0),0),
      groupAttendance:mergeWorkAttendance(...schools.map(x=>x.summary?.groupAttendance)),
      privateLessons:schools.reduce((n,x)=>n+Number(x.summary?.privateLessons||0),0),
      privateMinutes:schools.reduce((n,x)=>n+Number(x.summary?.privateMinutes||0),0),
      practiceSessions:schools.reduce((n,x)=>n+Number(x.summary?.practiceSessions||0),0),
      practiceMinutes:schools.reduce((n,x)=>n+Number(x.summary?.practiceMinutes||0),0),
      totalTeachingMinutes:schools.reduce((n,x)=>n+Number(x.summary?.totalTeachingMinutes||0),0),
      parentFeedbackCount:schools.reduce((n,x)=>n+Number(x.summary?.parentFeedbackCount||0),0),
      unassignedSessions:schools.reduce((n,x)=>n+Number(x.summary?.unassignedSessions||0),0)
    };
    const ratings=schools.flatMap(s=>s.audit||[]).filter(x=>x.courseType==="privateLesson"&&Number(x.feedbackAverage||0)>0).map(x=>Number(x.feedbackAverage));
    totals.privateHours=hoursTextNumber(totals.privateMinutes);totals.practiceHours=hoursTextNumber(totals.practiceMinutes);totals.totalTeachingHours=hoursTextNumber(totals.totalTeachingMinutes);totals.parentFeedbackAverage=ratings.length?Math.round(ratings.reduce((a,b)=>a+b,0)/ratings.length*100)/100:null;
    return json({month,startDate,endDate,threeLayer:true,totals,schools,courseTypes:["section","ensemble","comprehensive","practice","privateLesson"],notice:"Global 月報分三層：各校月度總覽 → 老師月度工時 → 課堂稽核。分部、合奏、綜合課以點名紀錄認列；個課以完課紀錄認列；加練依校方確認的實際授課分鐘認列。"});
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
