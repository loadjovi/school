import { TableClient, TableServiceClient } from "@azure/data-tables";

const conn=()=>process.env.STORAGE_CONNECTION_STRING;
const names={
  practice:process.env.PRACTICE_TABLE||"PracticeLog",
  section:process.env.SECTION_TABLE||"SectionAttendance",
  privateLesson:process.env.PRIVATE_TABLE||"PrivateLesson",
  registrations:process.env.STUDENT_REGISTRATION_TABLE||"StudentRegistration",
  userStudentMap:process.env.USER_STUDENT_MAP_TABLE||"UserStudentMap",
  studentMaster:process.env.STUDENT_MASTER_TABLE||"StudentMaster",
  studentHistory:process.env.STUDENT_HISTORY_TABLE||"StudentHistory",
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
    schoolYear:e.schoolYear||"",
    status:e.status||"active",
    source:"studentMaster"
  };
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
      items.push({studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,schoolYear:e.schoolYear||"",source:"legacyMap"});
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
    if(!map.has(e.rowKey))map.set(e.rowKey,{studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,parentEmail:e.partitionKey,source:"legacyMap"});
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
