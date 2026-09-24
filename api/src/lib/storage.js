import { TableClient, TableServiceClient } from "@azure/data-tables";

const conn=()=>process.env.STORAGE_CONNECTION_STRING;
const names={
  practice:process.env.PRACTICE_TABLE||"PracticeLog",
  section:process.env.SECTION_TABLE||"SectionAttendance",
  ensemble:process.env.ENSEMBLE_TABLE||"EnsembleAttendance",
  comprehensive:process.env.COMPREHENSIVE_TABLE||"ComprehensiveAttendance",
  privateLesson:process.env.PRIVATE_TABLE||"PrivateLesson",
  registrations:process.env.STUDENT_REGISTRATION_TABLE||"StudentRegistration",
  userStudentMap:process.env.USER_STUDENT_MAP_TABLE||"UserStudentMap",
  studentMaster:process.env.STUDENT_MASTER_TABLE||"StudentMaster",
  studentHistory:process.env.STUDENT_HISTORY_TABLE||"StudentHistory",
  semesterEnrollment:process.env.SEMESTER_ENROLLMENT_TABLE||"SemesterEnrollment",
  teacherDirectory:process.env.TEACHER_DIRECTORY_TABLE||"TeacherDirectory",
  teacherProfile:process.env.TEACHER_PROFILE_TABLE||"TeacherProfile",
  academicYearBatch:process.env.ACADEMIC_YEAR_BATCH_TABLE||"AcademicYearBatch",
  tenantPractice:process.env.TENANT_PRACTICE_TABLE||"TenantPracticeLog",
  tenantSection:process.env.TENANT_SECTION_TABLE||"TenantSectionAttendance",
  tenantEnsemble:process.env.TENANT_ENSEMBLE_TABLE||"TenantEnsembleAttendance",
  tenantComprehensive:process.env.TENANT_COMPREHENSIVE_TABLE||"TenantComprehensiveAttendance",
  tenantPrivateLesson:process.env.TENANT_PRIVATE_TABLE||"TenantPrivateLesson",
  tenantRegistrations:process.env.TENANT_STUDENT_REGISTRATION_TABLE||"TenantStudentRegistration",
  tenantUserStudentMap:process.env.TENANT_USER_STUDENT_MAP_TABLE||"TenantUserStudentMap",
  tenantStudentMaster:process.env.TENANT_STUDENT_MASTER_TABLE||"TenantStudentMaster",
  tenantStudentHistory:process.env.TENANT_STUDENT_HISTORY_TABLE||"TenantStudentHistory",
  tenantSemesterEnrollment:process.env.TENANT_SEMESTER_ENROLLMENT_TABLE||"TenantSemesterEnrollment",
  tenantTeacherDirectory:process.env.TENANT_TEACHER_DIRECTORY_TABLE||"TenantTeacherDirectory",
  tenantTeacherProfile:process.env.TENANT_TEACHER_PROFILE_TABLE||"TenantTeacherProfile",
  tenantAcademicYearBatch:process.env.TENANT_ACADEMIC_YEAR_BATCH_TABLE||"TenantAcademicYearBatch",
  tenantDirectory:process.env.TENANT_DIRECTORY_TABLE||"TenantDirectory",
  tenantUserRole:process.env.TENANT_USER_ROLE_TABLE||"TenantUserRole",
  tenantMigration:process.env.TENANT_MIGRATION_TABLE||"TenantMigration",
  globalAuditLog:process.env.GLOBAL_AUDIT_LOG_TABLE||"GlobalAuditLog",
  userIdentity:process.env.USER_IDENTITY_TABLE||"UserIdentity",
  tenantSchedule:process.env.TENANT_SCHEDULE_TABLE||"TenantSchedule",
  tenantScheduleException:process.env.TENANT_SCHEDULE_EXCEPTION_TABLE||"TenantScheduleException",
  tenantScheduleState:process.env.TENANT_SCHEDULE_STATE_TABLE||"TenantScheduleState",
  tenantCalendarEvent:process.env.TENANT_CALENDAR_EVENT_TABLE||"TenantCalendarEvent",
  tenantPracticeFeedback:process.env.TENANT_PRACTICE_FEEDBACK_TABLE||"TenantPracticeFeedback",
  tenantPracticeMonthlyEvaluation:process.env.TENANT_PRACTICE_MONTHLY_EVALUATION_TABLE||"TenantPracticeMonthlyEvaluation"
};
const tenantDataKeys=["tenantPractice","tenantSection","tenantEnsemble","tenantComprehensive","tenantPrivateLesson","tenantRegistrations","tenantUserStudentMap","tenantStudentMaster","tenantStudentHistory","tenantSemesterEnrollment","tenantTeacherDirectory","tenantTeacherProfile","tenantAcademicYearBatch","tenantMigration","tenantSchedule","tenantScheduleException","tenantScheduleState","tenantCalendarEvent","tenantPracticeFeedback","tenantPracticeMonthlyEvaluation"];
const tenantActivityKeys={practice:"tenantPractice",section:"tenantSection",ensemble:"tenantEnsemble",comprehensive:"tenantComprehensive",privateLesson:"tenantPrivateLesson"};

let initialized=false,tenantInitialized=false,initializationPromise=null,tenantInitializationPromise=null;

async function createTables(keys){
  if(!conn())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  const service=TableServiceClient.fromConnectionString(conn());
  for(const key of keys){try{await service.createTable(names[key])}catch(e){if(e.statusCode!==409)throw e}}
}

export async function ensureTables(){
  if(initialized)return;
  if(!initializationPromise)initializationPromise=createTables(Object.keys(names).filter(key=>!tenantDataKeys.includes(key))).then(()=>{initialized=true}).catch(error=>{initializationPromise=null;throw error});
  await initializationPromise;
}
export async function ensureTenantTables(){
  if(tenantInitialized)return;
  if(!tenantInitializationPromise)tenantInitializationPromise=(async()=>{await ensureTables();await createTables(tenantDataKeys);tenantInitialized=true})().catch(error=>{tenantInitializationPromise=null;throw error});
  await tenantInitializationPromise;
}

export function table(key){return TableClient.fromConnectionString(conn(),names[key]);}
export function rowKey(prefix="r"){const iso=new Date().toISOString().replace(/[-:.TZ]/g,"");const rand=Math.random().toString(36).slice(2,10);return `${prefix}_${iso}_${rand}`;}
export function semesterLabel(semester){const s=String(semester||"").trim();return s==="1"?"上學期":s==="2"?"下學期":"";}
export function semesterKey(schoolYear,semester){return `${String(schoolYear||"").trim()}-${String(semester||"").trim()}`;}

export function tenantActivityKey(key){const value=tenantActivityKeys[String(key||"")];if(!value)throw new Error(`未知的活動資料表：${key}`);return value}
export function activityStudentId(entity={}){const explicit=String(entity.studentId||"").trim();if(explicit)return explicit;const partition=String(entity.partitionKey||"");const marker="|student|",i=partition.indexOf(marker);return i>=0?partition.slice(i+marker.length):partition}
export async function listByStudent(key,studentId,startDate,endDate,schoolId=defaultTenantId()){await ensureTenantTables();const client=table(tenantActivityKey(key));const parts=[`PartitionKey eq '${tenantStudentPartition(schoolId,studentId).replaceAll("'","''")}'`];if(startDate)parts.push(`eventDate ge '${String(startDate).replaceAll("'","''")}'`);if(endDate)parts.push(`eventDate le '${String(endDate).replaceAll("'","''")}'`);const items=[];for await(const e of client.listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);return items.sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate)));}
export async function listActivityRange(key,schoolId=defaultTenantId(),startDate="",endDate="",eventDate=""){await ensureTenantTables();const sid=tenantSchoolPartition(schoolId).replaceAll("'","''"),parts=[`schoolId eq '${sid}'`];if(eventDate)parts.push(`eventDate eq '${String(eventDate).replaceAll("'","''")}'`);else{if(startDate)parts.push(`eventDate ge '${String(startDate).replaceAll("'","''")}'`);if(endDate)parts.push(`eventDate le '${String(endDate).replaceAll("'","''")}'`)}const items=[];for await(const e of table(tenantActivityKey(key)).listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);return items}
export async function getStudentMaster(studentId,schoolId=defaultTenantId()){await ensureTenantTables();try{return await table("tenantStudentMaster").getEntity(tenantSchoolPartition(schoolId),String(studentId))}catch(e){if(e.statusCode===404)return null;throw e}}
export async function listStudentMaster(status="",schoolId=defaultTenantId()){await ensureTenantTables();const sid=tenantSchoolPartition(schoolId).replaceAll("'","''"),parts=[`PartitionKey eq '${sid}'`];if(status)parts.push(`status eq '${String(status).replaceAll("'","''")}'`);const items=[];for await(const e of table("tenantStudentMaster").listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);return items.sort((a,b)=>String(a.studentName||"").localeCompare(String(b.studentName||""),"zh-Hant"));}
export async function listSemesterEnrollment(schoolYear,semester,status="enrolled",schoolId=defaultTenantId()){await ensureTenantTables();const key=tenantTermPartition(schoolId,schoolYear,semester).replaceAll("'","''"),parts=[`PartitionKey eq '${key}'`];if(status)parts.push(`status eq '${String(status).replaceAll("'","''")}'`);const items=[];for await(const e of table("tenantSemesterEnrollment").listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);return items.sort((a,b)=>String(a.studentName||"").localeCompare(String(b.studentName||""),"zh-Hant"));}
function masterView(e){return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",semester:e.semester||"",semesterName:e.semesterName||semesterLabel(e.semester),status:e.status||"active",source:"studentMaster"};}
async function getRegistrationById(registrationId,schoolId=defaultTenantId()){const id=String(registrationId||"").trim();if(!id)return null;try{return await table("tenantRegistrations").getEntity(tenantSchoolPartition(schoolId),id)}catch(e){if(e.statusCode===404)return null;throw e}}
function mappingView(e,registration=null){return {parentEmail:String(e.parentEmail||"").toLowerCase(),parentName:String(e.parentName||registration?.parentName||""),relationship:String(e.relationship||registration?.relationship||"家長"),studentId:String(e.rowKey||""),studentName:String(e.studentName||e.name||registration?.studentName||""),grade:String(e.grade||registration?.grade||""),groupName:String(e.groupName||registration?.groupName||""),instrument:String(e.instrument||registration?.instrument||""),section:String(e.section||registration?.section||"待確認"),schoolYear:String(e.schoolYear||registration?.schoolYear||""),semester:String(e.semester||registration?.semester||""),registrationId:String(e.registrationId||""),status:String(e.status||"")};}
export async function listStudentsBySectionAssignments(assignments=[],schoolId=defaultTenantId()){const rules=(Array.isArray(assignments)?assignments:[]).map(x=>({groupName:String(x?.groupName||x?.group||"").trim(),section:String(x?.section||"").trim()})).filter(x=>x.groupName&&x.section);if(!rules.length)return [];const masters=await listStudentMaster("active",schoolId);return masters.filter(e=>rules.some(r=>e.groupName===r.groupName&&String(e.section||"待確認")===r.section)).map(masterView);}
function teacherEmail(email){return String(email||"").trim().toLowerCase()}
export async function getTeacherDirectory(email,schoolId=defaultTenantId()){await ensureTenantTables();const key=teacherEmail(email);if(!key)return null;try{return await table("tenantTeacherDirectory").getEntity(tenantSchoolPartition(schoolId),key)}catch(e){if(e.statusCode===404)return null;throw e}}
export async function listTeacherDirectory(schoolId=defaultTenantId()){await ensureTenantTables();const sid=tenantSchoolPartition(schoolId).replaceAll("'","''"),items=[];for await(const e of table("tenantTeacherDirectory").listEntities({queryOptions:{filter:`PartitionKey eq '${sid}'`}}))items.push(e);return items.sort((a,b)=>String(a.teacherName||a.rowKey).localeCompare(String(b.teacherName||b.rowKey),"zh-Hant"));}
export async function saveTeacherDirectory(email,{teacherName="",status="active",updatedBy=""}={},schoolId=defaultTenantId()){await ensureTenantTables();const key=teacherEmail(email),sid=tenantSchoolPartition(schoolId);if(!key)throw new Error("老師 Gmail 不可空白");const now=new Date().toISOString();let createdAt=now,lastLoginAt="";try{const old=await table("tenantTeacherDirectory").getEntity(sid,key);createdAt=old.createdAt||now;lastLoginAt=old.lastLoginAt||""}catch(e){if(e.statusCode!==404)throw e}const entity={partitionKey:sid,rowKey:key,schoolId:sid,teacherEmail:key,teacherName:String(teacherName||"").trim().slice(0,80),status:status==="inactive"?"inactive":"active",createdAt,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160),lastLoginAt};await table("tenantTeacherDirectory").upsertEntity(entity,"Replace");return entity;}
export async function touchTeacherLastLogin(email,schoolId=defaultTenantId()){await ensureTenantTables();const key=teacherEmail(email);if(!key)return;try{await table("tenantTeacherDirectory").updateEntity({partitionKey:tenantSchoolPartition(schoolId),rowKey:key,lastLoginAt:new Date().toISOString()},"Merge")}catch(e){if(e.statusCode!==404)throw e}}
export async function getTeacherProfile(email,schoolId=defaultTenantId()){await ensureTenantTables();const key=teacherEmail(email);if(!key)return null;try{return await table("tenantTeacherProfile").getEntity(tenantSchoolPartition(schoolId),key)}catch(e){if(e.statusCode===404)return null;throw e}}
export async function saveTeacherProfile(email,profile={},schoolId=defaultTenantId()){await ensureTenantTables();const key=teacherEmail(email),sid=tenantSchoolPartition(schoolId),now=new Date().toISOString();const entity={partitionKey:sid,rowKey:key,schoolId:sid,teacherEmail:key,displayName:String(profile.displayName||"").slice(0,100),sectionAssignments:JSON.stringify(profile.sectionAssignments||[]),ensembleGroups:JSON.stringify(profile.ensembleGroups||[]),comprehensiveEnabled:profile.comprehensiveEnabled===true,privateStudentIds:JSON.stringify(profile.privateStudentIds||[]),updatedAt:now};try{const old=await table("tenantTeacherProfile").getEntity(sid,key);entity.createdAt=old.createdAt||now;await table("tenantTeacherProfile").upsertEntity(entity,"Replace")}catch(e){if(e.statusCode!==404)throw e;entity.createdAt=now;await table("tenantTeacherProfile").createEntity(entity)}return entity;}
export async function getMappedStudentsByEmail(email,schoolId=defaultTenantId()){await ensureTenantTables();const client=table("tenantUserStudentMap"),partition=tenantParentPartition(schoolId,email).replaceAll("'","''"),items=[];for await(const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${partition}' and status eq 'active'`}})){const master=await getStudentMaster(e.rowKey,schoolId);if(master){if(master.status!=="inactive")items.push(masterView(master));continue}const registration=await getRegistrationById(e.registrationId,schoolId);const mapped=mappingView(e,registration);items.push({studentId:mapped.studentId,name:mapped.studentName,grade:mapped.grade,groupName:mapped.groupName,instrument:mapped.instrument,section:mapped.section,schoolYear:mapped.schoolYear,semester:mapped.semester,source:"tenantMap"})}return items;}
export async function listUserStudentMappings(status="active",schoolId=defaultTenantId()){await ensureTenantTables();const sid=tenantSchoolPartition(schoolId).replaceAll("'","''"),parts=[`schoolId eq '${sid}'`];if(status)parts.push(`status eq '${String(status).replaceAll("'","''")}'`);const items=[];for await(const e of table("tenantUserStudentMap").listEntities({queryOptions:{filter:parts.join(" and ")}})){const registration=await getRegistrationById(e.registrationId,schoolId);items.push(mappingView(e,registration))}return items;}
export async function listAllMappedStudents(schoolId=defaultTenantId()){await ensureTenantTables();const masters=await listStudentMaster("",schoolId);if(masters.length)return masters.map(masterView);const sid=tenantSchoolPartition(schoolId).replaceAll("'","''"),client=table("tenantUserStudentMap"),map=new Map();for await(const e of client.listEntities({queryOptions:{filter:`schoolId eq '${sid}' and status eq 'active'`}})){const registration=await getRegistrationById(e.registrationId,schoolId);const mapped=mappingView(e,registration);if(!map.has(mapped.studentId))map.set(mapped.studentId,{studentId:mapped.studentId,name:mapped.studentName,grade:mapped.grade,groupName:mapped.groupName,instrument:mapped.instrument,section:mapped.section,parentEmail:mapped.parentEmail,source:"tenantMap"})}return [...map.values()];}
export async function getRegistrationsByEmail(email,schoolId=defaultTenantId()){await ensureTenantTables();const sid=tenantSchoolPartition(schoolId).replaceAll("'","''"),safe=teacherEmail(email).replaceAll("'","''"),items=[];for await(const e of table("tenantRegistrations").listEntities({queryOptions:{filter:`PartitionKey eq '${sid}' and parentEmail eq '${safe}'`}}))items.push(e);return items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));}
export async function listRegistrations(status="",schoolId=defaultTenantId()){await ensureTenantTables();const sid=tenantSchoolPartition(schoolId).replaceAll("'","''"),parts=[`PartitionKey eq '${sid}'`];if(status)parts.push(`status eq '${String(status).replaceAll("'","''")}'`);const items=[];for await(const e of table("tenantRegistrations").listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);return items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));}


const DEFAULT_TENANT_ID="sacred-heart";
export function defaultTenantId(){return DEFAULT_TENANT_ID}
export function tenantIdValue(v){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,60)}
export function tenantSchoolPartition(schoolId){const id=tenantIdValue(schoolId);if(!id)throw new Error("schoolId 不可空白");return id}
export function tenantStudentPartition(schoolId,studentId){const id=tenantSchoolPartition(schoolId),student=String(studentId||"").trim();if(!student)throw new Error("studentId 不可空白");return `${id}|student|${student}`}
export function tenantParentPartition(schoolId,email){const id=tenantSchoolPartition(schoolId),parent=teacherEmail(email);if(!parent)throw new Error("家長 Email 不可空白");return `${id}|parent|${parent}`}
export function tenantTermPartition(schoolId,schoolYear,semester){const id=tenantSchoolPartition(schoolId),term=semesterKey(schoolYear,semester);if(term==="-")throw new Error("學年度與學期不可空白");return `${id}|term|${term}`}

export async function ensureDefaultTenant(updatedBy="system"){
  await ensureTables();
  try{
    const old=await table("tenantDirectory").getEntity("TENANT",DEFAULT_TENANT_ID);
    if(!old.cityCode||!old.cityName||!old.schoolLevel){
      const patch={partitionKey:"TENANT",rowKey:DEFAULT_TENANT_ID,cityCode:"keelung",cityName:"基隆市",schoolLevel:"elementary",schoolLevelName:"國小",schoolSlug:"sacred-heart",updatedAt:new Date().toISOString(),updatedBy:String(updatedBy||"system").slice(0,160)};
      await table("tenantDirectory").updateEntity(patch,"Merge");
      return {...old,...patch};
    }
    return old;
  }catch(e){
    if(e.statusCode!==404)throw e;
    const now=new Date().toISOString();
    const entity={
      partitionKey:"TENANT",rowKey:DEFAULT_TENANT_ID,
      schoolId:DEFAULT_TENANT_ID,schoolName:"聖心小學",shortName:"聖心",
      schoolSlug:"sacred-heart",cityCode:"keelung",cityName:"基隆市",schoolLevel:"elementary",schoolLevelName:"國小",
      systemName:"聖心小學弦樂團",status:"active",timezone:"Asia/Taipei",
      createdAt:now,updatedAt:now,updatedBy:String(updatedBy||"system").slice(0,160)
    };
    try{await table("tenantDirectory").createEntity(entity)}catch(err){if(err.statusCode!==409)throw err}
    return await table("tenantDirectory").getEntity("TENANT",DEFAULT_TENANT_ID);
  }
}

export async function getTenantDirectory(schoolId){
  await ensureTables();const id=tenantIdValue(schoolId);if(!id)return null;
  try{return await table("tenantDirectory").getEntity("TENANT",id)}catch(e){if(e.statusCode===404)return null;throw e}
}

export async function listTenantDirectory(){
  await ensureDefaultTenant();
  const items=[];for await(const e of table("tenantDirectory").listEntities({queryOptions:{filter:"PartitionKey eq 'TENANT'"}}))items.push(e);
  return items.sort((a,b)=>String(a.schoolName||a.rowKey).localeCompare(String(b.schoolName||b.rowKey),"zh-Hant"));
}

export async function saveTenantDirectory(schoolId,data={},updatedBy=""){
  await ensureTables();const id=tenantIdValue(schoolId);if(!id)throw new Error("schoolId 不可空白");
  const now=new Date().toISOString();let old=null;try{old=await table("tenantDirectory").getEntity("TENANT",id)}catch(e){if(e.statusCode!==404)throw e}
  const entity={
    partitionKey:"TENANT",rowKey:id,schoolId:id,
    schoolName:String(data.schoolName??old?.schoolName??"").trim().slice(0,120),
    shortName:String(data.shortName??old?.shortName??"").trim().slice(0,60),
    schoolSlug:tenantIdValue(data.schoolSlug??old?.schoolSlug??"").slice(0,50),
    cityCode:tenantIdValue(data.cityCode??old?.cityCode??"").slice(0,40),
    cityName:String(data.cityName??old?.cityName??"").trim().slice(0,40),
    schoolLevel:tenantIdValue(data.schoolLevel??old?.schoolLevel??"").slice(0,30),
    schoolLevelName:String(data.schoolLevelName??old?.schoolLevelName??"").trim().slice(0,30),
    systemName:String(data.systemName??old?.systemName??"").trim().slice(0,160),
    status:["active","onboarding","inactive","setup"].includes(String(data.status??old?.status??"setup"))?String(data.status??old?.status??"setup"):"setup",
    timezone:String(data.timezone??old?.timezone??"Asia/Taipei").trim().slice(0,80)||"Asia/Taipei",
    createdAt:old?.createdAt||now,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)
  };
  if(!entity.schoolName)throw new Error("學校名稱不可空白");
  if(!entity.shortName)entity.shortName=entity.schoolName.slice(0,60);
  if(!entity.systemName)entity.systemName=entity.schoolName+" 管理系統";
  await table("tenantDirectory").upsertEntity(entity,"Replace");return entity;
}

export async function listTenantRolesByEmail(email,status="active"){
  await ensureTables();const key=teacherEmail(email);if(!key)return [];
  const parts=[`PartitionKey eq '${key.replaceAll("'","''")}'`];if(status)parts.push(`status eq '${String(status).replaceAll("'","''")}'`);
  const items=[];for await(const e of table("tenantUserRole").listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);
  return items;
}

export async function listTenantAdmins(schoolId,status="active"){
  await ensureTables();const id=tenantIdValue(schoolId),items=[];
  const parts=[`schoolId eq '${id.replaceAll("'","''")}'`,`role eq 'schoolAdmin'`];if(status)parts.push(`status eq '${String(status).replaceAll("'","''")}'`);
  for await(const e of table("tenantUserRole").listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);
  return items.sort((a,b)=>String(a.partitionKey).localeCompare(String(b.partitionKey)));
}

export async function saveTenantUserRole(email,schoolId,role="schoolAdmin",status="active",updatedBy=""){
  await ensureTables();const user=teacherEmail(email);if(!user)throw new Error("Gmail 不可空白");
  const normalizedRole=role==="globalAdmin"?"globalAdmin":"schoolAdmin";
  const sid=normalizedRole==="globalAdmin"?"*":tenantIdValue(schoolId);if(normalizedRole!=="globalAdmin"&&!sid)throw new Error("schoolId 不可空白");
  const rowKey=normalizedRole==="globalAdmin"?"GLOBAL":sid;
  const now=new Date().toISOString();let old=null;try{old=await table("tenantUserRole").getEntity(user,rowKey)}catch(e){if(e.statusCode!==404)throw e}
  const entity={partitionKey:user,rowKey,schoolId:sid,role:normalizedRole,status:status==="inactive"?"inactive":"active",createdAt:old?.createdAt||now,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)};
  await table("tenantUserRole").upsertEntity(entity,"Replace");return entity;
}

export async function ensureBootstrapGlobalAdmin(email){
  const key=teacherEmail(email);if(!key)return;
  await ensureDefaultTenant(key);
  let global=null;
  try{global=await table("tenantUserRole").getEntity(key,"GLOBAL")}catch(e){if(e.statusCode!==404)throw e}
  if(!global||global.status!=="active"||global.role!=="globalAdmin")await saveTenantUserRole(key,"*","globalAdmin","active",key);
}

export async function writeGlobalAudit({actorEmail="",action="",schoolId="",targetEmail="",details={}}={}){
  await ensureTables();const now=new Date().toISOString();
  const entity={partitionKey:now.slice(0,7),rowKey:rowKey("ga"),actorEmail:teacherEmail(actorEmail),action:String(action||"").slice(0,80),schoolId:tenantIdValue(schoolId)||String(schoolId||"").slice(0,60),targetEmail:teacherEmail(targetEmail),details:JSON.stringify(details||{}).slice(0,8000),createdAt:now};
  await table("globalAuditLog").createEntity(entity);return entity;
}


export async function saveUserIdentity(identity={}){
  await ensureTables();
  const sub=String(identity.sub||"").trim();if(!sub)return null;
  const now=new Date().toISOString();let old=null;
  try{old=await table("userIdentity").getEntity("GOOGLE",sub)}catch(e){if(e.statusCode!==404)throw e}
  const entity={
    partitionKey:"GOOGLE",rowKey:sub,identityId:sub,provider:"google",
    email:teacherEmail(identity.email),displayName:String(identity.displayName||identity.name||identity.email||"").trim().slice(0,160),
    picture:String(identity.picture||"").trim().slice(0,1000),status:"active",
    createdAt:old?.createdAt||now,lastLoginAt:now,updatedAt:now
  };
  await table("userIdentity").upsertEntity(entity,"Replace");return entity;
}
