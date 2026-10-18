import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";

// One current, authoritative row per school and student. Original paper values
// are one-time migration seeds, never a second export source.
import {originalCompetitionRoster,baseForStudent,latestCompetitionRequest,overlayMaster,comparable,nameKey} from "./competitionMasterRules.mjs";
export {originalCompetitionRoster,baseForStudent,latestCompetitionRequest,overlayMaster};
const connection=()=>process.env.STORAGE_CONNECTION_STRING;
let masterClient,auditClient;
async function getClients(){
 if(!connection())throw Error("比賽服主檔儲存服務不可用");
 if(!masterClient){
  masterClient=TableClient.fromConnectionString(connection(),"TenantCompetitionUniformMaster");
  await masterClient.createTable().catch(e=>{if(e.statusCode!==409)throw e});
 }
 if(!auditClient){
  auditClient=TableClient.fromConnectionString(connection(),"TenantUniformEventAudit");
  await auditClient.createTable().catch(e=>{if(e.statusCode!==409)throw e});
 }
 return {masterClient,auditClient};
}
async function lookup(client,schoolId,id){
 try{return await client.getEntity(schoolId,String(id))}catch(e){if(e.statusCode===404)return null;throw e}
}
export async function upsertCurrentCompetitionMaster(schoolId,student,request,actor="system"){
 const id=String(student?.rowKey||student?.studentId||"");
 const base=baseForStudent(student);
 if(!id||!base)return null;
 const {masterClient,auditClient}=await getClients();
 for(let attempt=0;attempt<3;attempt++){
  const prev=await lookup(masterClient,schoolId,id);
  const old=prev?JSON.parse(prev.payload||"{}"):base;
  // Rebuild current mutable fields from the original migration seed each time:
  // cancelling an unfulfilled request restores the genuine original state.
  const current=overlayMaster({...base,received:old.received===true||base.received},request,student);
  if(prev&&comparable(old)===comparable(current))return {...current,studentId:id};
  const changed=comparable(old)!==comparable(current);
  if(changed){
   await auditClient.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"competition.master.replace",
    subjectId:id,actor:String(actor).slice(0,200),at:new Date().toISOString(),
    details:JSON.stringify({before:old,after:current}).slice(0,30000)});
  }
  const data={partitionKey:schoolId,rowKey:id,payload:JSON.stringify(current),updatedAt:new Date().toISOString()};
  try{
   if(prev)await masterClient.updateEntity(data,"Replace",{etag:prev.etag});
   else await masterClient.createEntity(data);
   return {...current,studentId:id};
  }catch(e){if(![409,412].includes(e.statusCode))throw e}
 }
 throw Error("主檔被同時異動，請重新整理重試");
}
export async function migrateAndListCompetitionMaster(schoolId,students,requests,actor="system"){
 const rosterNames=new Set(originalCompetitionRoster.map(row=>nameKey(row[1])));
 const matches=new Map();
 for(const student of students||[]){
  const name=nameKey(student.studentName||student.name);
  if(!rosterNames.has(name))continue;
  if(!matches.has(name))matches.set(name,[]);
  matches.get(name).push(student);
 }
 const result=[],unmatched=[];
 for(const row of originalCompetitionRoster){
  const name=nameKey(row[1]),match=matches.get(name)||[];
  if(match.length!==1){unmatched.push({name:row[1],reason:match.length?"學生姓名重複":"學生主檔無此人"});continue}
  const student=match[0],id=student.rowKey||student.studentId;
  result.push(await upsertCurrentCompetitionMaster(schoolId,student,latestCompetitionRequest(requests,id),actor));
 }
 return {items:result,unmatched};
}
