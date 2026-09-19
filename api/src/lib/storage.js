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
  tenantDirectory:process.env.TENANT_DIRECTORY_TABLE||"TenantDirectory",
  tenantUserRole:process.env.TENANT_USER_ROLE_TABLE||"TenantUserRole",
  globalAuditLog:process.env.GLOBAL_AUDIT_LOG_TABLE||"GlobalAuditLog"
};

let initialized=false;

export async function ensureTables(){
  if(initialized)return;
  if(!conn())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  const service=TableServiceClient.fromConnectionString(conn());
  for(const name of Object.values(names)){
    try{await service.createTable(name)}catch(e){if(e.statusCode!==409)throw e}
  }
  initialized=true;
}

export function table(key){return TableClient.fromConnectionString(conn(),names[key]);}
export function rowKey(prefix="r"){const iso=new Date().toISOString().replace(/[-:.TZ]/g,"");const rand=Math.random().toString(36).slice(2,10);return `${prefix}_${iso}_${rand}`;}
export function semesterLabel(semester){const s=String(semester||"").trim();return s==="1"?"上學期":s==="2"?"下學期":"";}
export function semesterKey(schoolYear,semester){return `${String(schoolYear||"").trim()}-${String(semester||"").trim()}`;}

export async function listByStudent(key,studentId,startDate,endDate){await ensureTables();const client=table(key);const parts=[`PartitionKey eq '${String(studentId).replaceAll("'","''")}'`];if(startDate)parts.push(`eventDate ge '${startDate}'`);if(endDate)parts.push(`eventDate le '${endDate}'`);const items=[];for await(const e of client.listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);return items.sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate)));}
export async function getStudentMaster(studentId){await ensureTables();try{return await table("studentMaster").getEntity("STUDENT",String(studentId))}catch(e){if(e.statusCode===404)return null;throw e}}
export async function listStudentMaster(status=""){await ensureTables();const items=[];const options=status?{queryOptions:{filter:`status eq '${String(status).replaceAll("'","''")}'`}}:undefined;for await(const e of table("studentMaster").listEntities(options))items.push(e);return items.sort((a,b)=>String(a.studentName||"").localeCompare(String(b.studentName||""),"zh-Hant"));}
export async function listSemesterEnrollment(schoolYear,semester,status="enrolled"){await ensureTables();const key=semesterKey(schoolYear,semester).replaceAll("'","''");const parts=[`PartitionKey eq '${key}'`];if(status)parts.push(`status eq '${String(status).replaceAll("'","''")}'`);const items=[];for await(const e of table("semesterEnrollment").listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);return items.sort((a,b)=>String(a.studentName||"").localeCompare(String(b.studentName||""),"zh-Hant"));}
function masterView(e){return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",semester:e.semester||"",semesterName:e.semesterName||semesterLabel(e.semester),status:e.status||"active",source:"studentMaster"};}
async function getRegistrationById(registrationId){const id=String(registrationId||"").trim();if(!id)return null;try{return await table("registrations").getEntity("REG",id)}catch(e){if(e.statusCode===404)return null;throw e}}
function mappingView(e,registration=null){return {parentEmail:String(e.partitionKey||"").toLowerCase(),studentId:String(e.rowKey||""),studentName:String(e.studentName||e.name||registration?.studentName||""),grade:String(e.grade||registration?.grade||""),groupName:String(e.groupName||registration?.groupName||""),instrument:String(e.instrument||registration?.instrument||""),section:String(e.section||registration?.section||"待確認"),schoolYear:String(e.schoolYear||registration?.schoolYear||""),semester:String(e.semester||registration?.semester||""),registrationId:String(e.registrationId||""),status:String(e.status||"")};}
export async function listStudentsBySectionAssignments(assignments=[]){const rules=(Array.isArray(assignments)?assignments:[]).map(x=>({groupName:String(x?.groupName||x?.group||"").trim(),section:String(x?.section||"").trim()})).filter(x=>x.groupName&&x.section);if(!rules.length)return [];const masters=await listStudentMaster("active");return masters.filter(e=>rules.some(r=>e.groupName===r.groupName&&String(e.section||"待確認")===r.section)).map(masterView);}
function teacherEmail(email){return String(email||"").trim().toLowerCase()}
export async function getTeacherDirectory(email){await ensureTables();const key=teacherEmail(email);if(!key)return null;try{return await table("teacherDirectory").getEntity("TEACHER",key)}catch(e){if(e.statusCode===404)return null;throw e}}
export async function listTeacherDirectory(){await ensureTables();const items=[];for await(const e of table("teacherDirectory").listEntities({queryOptions:{filter:"PartitionKey eq 'TEACHER'"}}))items.push(e);return items.sort((a,b)=>String(a.teacherName||a.rowKey).localeCompare(String(b.teacherName||b.rowKey),"zh-Hant"));}
export async function saveTeacherDirectory(email,{teacherName="",status="active",updatedBy=""}={}){await ensureTables();const key=teacherEmail(email);if(!key)throw new Error("老師 Gmail 不可空白");const now=new Date().toISOString();let createdAt=now,lastLoginAt="";try{const old=await table("teacherDirectory").getEntity("TEACHER",key);createdAt=old.createdAt||now;lastLoginAt=old.lastLoginAt||""}catch(e){if(e.statusCode!==404)throw e}const entity={partitionKey:"TEACHER",rowKey:key,teacherName:String(teacherName||"").trim().slice(0,80),status:status==="inactive"?"inactive":"active",createdAt,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160),lastLoginAt};await table("teacherDirectory").upsertEntity(entity,"Replace");return entity;}
export async function touchTeacherLastLogin(email){await ensureTables();const key=teacherEmail(email);if(!key)return;try{await table("teacherDirectory").updateEntity({partitionKey:"TEACHER",rowKey:key,lastLoginAt:new Date().toISOString()},"Merge")}catch(e){if(e.statusCode!==404)throw e}}
export async function getTeacherProfile(email){await ensureTables();const key=teacherEmail(email);if(!key)return null;try{return await table("teacherProfile").getEntity("TEACHER",key)}catch(e){if(e.statusCode===404)return null;throw e}}
export async function saveTeacherProfile(email,profile={}){await ensureTables();const key=teacherEmail(email);const now=new Date().toISOString();const entity={partitionKey:"TEACHER",rowKey:key,displayName:String(profile.displayName||"").slice(0,100),sectionAssignments:JSON.stringify(profile.sectionAssignments||[]),ensembleGroups:JSON.stringify(profile.ensembleGroups||[]),comprehensiveEnabled:profile.comprehensiveEnabled===true,privateStudentIds:JSON.stringify(profile.privateStudentIds||[]),updatedAt:now};try{const old=await table("teacherProfile").getEntity("TEACHER",key);entity.createdAt=old.createdAt||now;await table("teacherProfile").upsertEntity(entity,"Replace")}catch(e){if(e.statusCode!==404)throw e;entity.createdAt=now;await table("teacherProfile").createEntity(entity)}return entity;}
export async function getMappedStudentsByEmail(email){await ensureTables();const client=table("userStudentMap");const safe=String(email||"").toLowerCase().replaceAll("'","''");const items=[];for await(const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${safe}' and status eq 'active'`}})){const master=await getStudentMaster(e.rowKey);if(master){if(master.status!=="inactive")items.push(masterView(master));continue}const registration=await getRegistrationById(e.registrationId);const mapped=mappingView(e,registration);items.push({studentId:mapped.studentId,name:mapped.studentName,grade:mapped.grade,groupName:mapped.groupName,instrument:mapped.instrument,section:mapped.section,schoolYear:mapped.schoolYear,semester:mapped.semester,source:"legacyMap"})}return items;}
export async function listUserStudentMappings(status="active"){await ensureTables();const items=[];const options=status?{queryOptions:{filter:`status eq '${String(status).replaceAll("'","''")}'`}}:undefined;for await(const e of table("userStudentMap").listEntities(options)){const registration=await getRegistrationById(e.registrationId);items.push(mappingView(e,registration))}return items;}
export async function listAllMappedStudents(){await ensureTables();const masters=await listStudentMaster();if(masters.length)return masters.map(masterView);const client=table("userStudentMap");const map=new Map();for await(const e of client.listEntities({queryOptions:{filter:"status eq 'active'"}})){const registration=await getRegistrationById(e.registrationId);const mapped=mappingView(e,registration);if(!map.has(mapped.studentId))map.set(mapped.studentId,{studentId:mapped.studentId,name:mapped.studentName,grade:mapped.grade,groupName:mapped.groupName,instrument:mapped.instrument,section:mapped.section,parentEmail:mapped.parentEmail,source:"legacyMap"})}return [...map.values()];}
export async function getRegistrationsByEmail(email){await ensureTables();const client=table("registrations");const safe=String(email||"").toLowerCase().replaceAll("'","''");const items=[];for await(const e of client.listEntities({queryOptions:{filter:`parentEmail eq '${safe}'`}}))items.push(e);return items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));}
export async function listRegistrations(status=""){await ensureTables();const items=[];const options=status?{queryOptions:{filter:`status eq '${String(status).replaceAll("'","''")}'`}}:undefined;for await(const e of table("registrations").listEntities(options))items.push(e);return items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));}


const DEFAULT_TENANT_ID="sacred-heart";
export function defaultTenantId(){return DEFAULT_TENANT_ID}
export function tenantIdValue(v){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,60)}

export async function ensureDefaultTenant(updatedBy="system"){
  await ensureTables();
  try{return await table("tenantDirectory").getEntity("TENANT",DEFAULT_TENANT_ID)}
  catch(e){
    if(e.statusCode!==404)throw e;
    const now=new Date().toISOString();
    const entity={
      partitionKey:"TENANT",rowKey:DEFAULT_TENANT_ID,
      schoolId:DEFAULT_TENANT_ID,schoolName:"聖心小學",shortName:"聖心",
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
    systemName:String(data.systemName??old?.systemName??"").trim().slice(0,160),
    status:String(data.status??old?.status??"active")==="inactive"?"inactive":"active",
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
  await saveTenantUserRole(key,"*","globalAdmin","active",key);
  await saveTenantUserRole(key,DEFAULT_TENANT_ID,"schoolAdmin","active",key);
}

export async function writeGlobalAudit({actorEmail="",action="",schoolId="",targetEmail="",details={}}={}){
  await ensureTables();const now=new Date().toISOString();
  const entity={partitionKey:now.slice(0,7),rowKey:rowKey("ga"),actorEmail:teacherEmail(actorEmail),action:String(action||"").slice(0,80),schoolId:tenantIdValue(schoolId)||String(schoolId||"").slice(0,60),targetEmail:teacherEmail(targetEmail),details:JSON.stringify(details||{}).slice(0,8000),createdAt:now};
  await table("globalAuditLog").createEntity(entity);return entity;
}
