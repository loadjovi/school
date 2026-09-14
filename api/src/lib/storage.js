
import { TableClient, TableServiceClient } from "@azure/data-tables";
const conn=()=>process.env.STORAGE_CONNECTION_STRING;
const names={
  practice:process.env.PRACTICE_TABLE||"PracticeLog",
  section:process.env.SECTION_TABLE||"SectionAttendance",
  privateLesson:process.env.PRIVATE_TABLE||"PrivateLesson"
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
export function table(key){return TableClient.fromConnectionString(conn(),names[key])}
export function rowKey(prefix="r"){
  const iso=new Date().toISOString().replace(/[-:.TZ]/g,"");
  const rand=Math.random().toString(36).slice(2,10);
  return `${prefix}_${iso}_${rand}`;
}
export async function listByStudent(key, studentId, startDate, endDate){
  await ensureTables();
  const client=table(key);
  const parts=[`PartitionKey eq '${studentId.replaceAll("'","''")}'`];
  if(startDate)parts.push(`eventDate ge '${startDate}'`);
  if(endDate)parts.push(`eventDate le '${endDate}'`);
  const items=[];
  for await (const e of client.listEntities({queryOptions:{filter:parts.join(" and ")}})) items.push(e);
  return items.sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate)));
}
