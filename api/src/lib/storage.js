import { TableClient, TableServiceClient } from "@azure/data-tables";

const conn=()=>process.env.STORAGE_CONNECTION_STRING;
const names={
  practice:process.env.PRACTICE_TABLE||"PracticeLog",
  section:process.env.SECTION_TABLE||"SectionAttendance",
  ensemble:process.env.ENSEMBLE_TABLE||"EnsembleAttendance",
  privateLesson:process.env.PRIVATE_TABLE||"PrivateLesson",
  registrations:process.env.STUDENT_REGISTRATION_TABLE||"StudentRegistration",
  userStudentMap:process.env.USER_STUDENT_MAP_TABLE||"UserStudentMap",
  studentMaster:process.env.STUDENT_MASTER_TABLE||"StudentMaster",
  studentHistory:process.env.STUDENT_HISTORY_TABLE||"StudentHistory",
  teacherDirectory:process.env.TEACHER_DIRECTORY_TABLE||"TeacherDirectory",
  teacherProfile:process.env.TEACHER_PROFILE_TABLE||"TeacherProfile",
  academicYearBatch:process.env.ACADEMIC_YEAR_BATCH_TABLE||"AcademicYearBatch"
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

export function table(key){
  return TableClient.fromConnectionString(conn(),names[key]);
}

export function rowKey(prefix="r"){
  const iso=new Date().toISOString().replace(/[-:.TZ]/g,"");
  const rand=Math.random().toString(36).slice(2,10);
  return `${prefix}_${iso}_${rand}`;
}

export async function listByStudent(key, studentId, startDate, endDate){
  await ensureTables();
  const client=table(key);
  const parts=[`PartitionKey eq '${String(studentId).replaceAll("'","''")}'`];
  if(startDate)parts.push(`eventDate ge '${startDate}'`);
  if(endDate)parts.push(`eventDate le '${endDate}'`);
  const items=[];
  for await (const e of client.listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(e);
  return items.sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate)));
}

export async function getStudentMaster(studentId){
  await ensureTables();
  try{return await table("studentMaster").getEntity("STUDENT",String(studentId))}
  catch(e){if(e.statusCode===404)return null;throw e}
}

export async function listStudentMaster(status=""){
  await ensureTables();
  const items=[];
  const options=status?{queryOptions:{filter:`status eq '${String(status).replaceAll("'","''")}'`}}:undefined;
  for await (const e of table("studentMaster").listEntities(options))items.push(e);
  return items.sort((a,b)=>String(a.studentName||"").localeCompare(String(b.studentName||""),"zh-Hant"));
}

function masterView(e){
  return {
    studentId:e.rowKey,
    name:e.studentName,
    grade:e.grade,
    groupName:e.groupName,
    instrument:e.instrument,
    section:e.section||"待確認",
    schoolYear:e.schoolYear||"",
    status:e.status||"active",
    source:"studentMaster"
  };
}

export async function listStudentsBySectionAssignments(assignments=[]){
  const rules=(Array.isArray(assignments)?assignments:[]).map(x=>({
    groupName:String(x?.groupName||x?.group||"").trim(),
    section:String(x?.section||"").trim()
  })).filter(x=>x.groupName&&x.section);
  if(!rules.length)return [];
  const masters=await listStudentMaster("active");
  return masters.filter(e=>rules.some(r=>e.groupName===r.groupName&&String(e.section||"待確認")===r.section)).map(masterView);
}

function teacherEmail(email){return String(email||"").trim().toLowerCase()}

export async function getTeacherDirectory(email){
  await ensureTables();
  const key=teacherEmail(email);
  if(!key)return null;
  try{return await table("teacherDirectory").getEntity("TEACHER",key)}
  catch(e){if(e.statusCode===404)return null;throw e}
}

export async function listTeacherDirectory(){
  await ensureTables();
  const items=[];
  for await (const e of table("teacherDirectory").listEntities({queryOptions:{filter:"PartitionKey eq 'TEACHER'"}}))items.push(e);
  return items.sort((a,b)=>String(a.teacherName||a.rowKey).localeCompare(String(b.teacherName||b.rowKey),"zh-Hant"));
}

export async function saveTeacherDirectory(email,{teacherName="",status="active",updatedBy=""}={}){
  await ensureTables();
  const key=teacherEmail(email);
  if(!key)throw new Error("老師 Gmail 不可空白");
  const now=new Date().toISOString();
  let createdAt=now;
  try{const old=await table("teacherDirectory").getEntity("TEACHER",key);createdAt=old.createdAt||now}catch(e){if(e.statusCode!==404)throw e}
  const entity={partitionKey:"TEACHER",rowKey:key,teacherName:String(teacherName||"").trim().slice(0,80),status:status==="inactive"?"inactive":"active",createdAt,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)};
  await table("teacherDirectory").upsertEntity(entity,"Replace");
  return entity;
}

export async function getTeacherProfile(email){
  await ensureTables();
  const key=teacherEmail(email);
  if(!key)return null;
  try{return await table("teacherProfile").getEntity("TEACHER",key)}
  catch(e){if(e.statusCode===404)return null;throw e}
}

export async function saveTeacherProfile(email,profile={}){
  await ensureTables();
  const key=teacherEmail(email);
  const now=new Date().toISOString();
  const entity={
    partitionKey:"TEACHER",
    rowKey:key,
    displayName:String(profile.displayName||"").slice(0,100),
    sectionAssignments:JSON.stringify(profile.sectionAssignments||[]),
    ensembleGroups:JSON.stringify(profile.ensembleGroups||[]),
    privateStudentIds:JSON.stringify(profile.privateStudentIds||[]),
    updatedAt:now
  };
  try{
    const old=await table("teacherProfile").getEntity("TEACHER",key);
    entity.createdAt=old.createdAt||now;
    await table("teacherProfile").upsertEntity(entity,"Replace");
  }catch(e){
    if(e.statusCode!==404)throw e;
    entity.createdAt=now;
    await table("teacherProfile").createEntity(entity);
  }
  return entity;
}

export async function getMappedStudentsByEmail(email){
  await ensureTables();
  const client=table("userStudentMap");
  const safe=String(email||"").toLowerCase().replaceAll("'","''");
  const items=[];
  for await (const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${safe}' and status eq 'active'`}})){
    const master=await getStudentMaster(e.rowKey);
    if(master&&master.status!=="inactive")items.push(masterView(master));
    else if(!master){
      items.push({studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",source:"legacyMap"});
    }
  }
  return items;
}

export async function listAllMappedStudents(){
  await ensureTables();
  const masters=await listStudentMaster();
  if(masters.length)return masters.map(masterView);
  const client=table("userStudentMap");
  const map=new Map();
  for await (const e of client.listEntities({queryOptions:{filter:"status eq 'active'"}})){
    if(!map.has(e.rowKey))map.set(e.rowKey,{studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",parentEmail:e.partitionKey,source:"legacyMap"});
  }
  return [...map.values()];
}

export async function getRegistrationsByEmail(email){
  await ensureTables();
  const client=table("registrations");
  const safe=String(email||"").toLowerCase().replaceAll("'","''");
  const items=[];
  for await (const e of client.listEntities({queryOptions:{filter:`parentEmail eq '${safe}'`}}))items.push(e);
  return items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}

export async function listRegistrations(status=""){
  await ensureTables();
  const client=table("registrations");
  const items=[];
  const options=status?{queryOptions:{filter:`status eq '${String(status).replaceAll("'","''")}'`}}:undefined;
  for await (const e of client.listEntities(options))items.push(e);
  return items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}
