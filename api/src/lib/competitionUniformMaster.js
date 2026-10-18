import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";

// One current, authoritative row per school and student. Original paper values
// are one-time migration seeds, never a second export source.
export const originalCompetitionRoster=[
 ["4A","林心澄","女","S","PUBLIC","小提琴"],
 ["4C","李旭恩","男","S","PENDING","大提琴"],
 ["4D","蘇聖翔","男","M","PENDING","中提琴"],
 ["5A","吳定廩","男","M","PUBLIC","大提琴"],
 ["5A","蔡昀潔","女","M","PENDING","中提琴"],
 ["5C","游宜橙","女","M","PURCHASE","小提琴"],
 ["5C","陳祉瑄","女","XS","PUBLIC","小提琴"],
 ["5D","楊力萓","女","S","PURCHASE","大提琴"],
 ["6A","李婇寧","女","M","PUBLIC","小提琴"],
 ["6B","賴昺旭","男","S","PUBLIC","中提琴"],
 ["6C","張安侖","男","L","PURCHASE","大提琴"],
 ["6C","黃禹閎","男","M","PURCHASE","小提琴"],
 ["6C","陳奕亘","男","L","PUBLIC","中提琴"],
 ["6D","張介輔","男","L","PUBLIC","小提琴"],
 ["6D","李宥蓁","女","L","PUBLIC","大提琴"]
];
const paperReceived=new Set(["李婇寧","張介輔","林心澄","黃禹閎","游宜橙","陳祉瑄","賴昺旭","陳奕亘","張安侖","李宥蓁","吳定廩","楊力萓"]);
const nameKey=name=>String(name||"").trim().normalize("NFC").replace(/\s+/g,"");
const bases=new Map(originalCompetitionRoster.map(row=>[nameKey(row[1]),row]));
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
export function baseForStudent(student){
 const name=String(student.studentName||student.name||"").trim();
 const row=bases.get(nameKey(name));
 if(!row)return null;
 return {studentId:String(student.rowKey||student.studentId||""),studentName:name,
  originalClass:row[0],grade:String(student.grade||row[0]),
  style:row[2],size:row[3],acquisition:row[4],instrument:row[5],
  requestId:"",requestStatus:"",paymentStatus:"",
  received:paperReceived.has(nameKey(name)),source:"paper",
  appliedRequestAt:""};
}
const eligible=request=>request?.kind==="competitionUniform"&&request.status!=="CANCELLED";
export function latestCompetitionRequest(requests,id){
 return (requests||[]).filter(r=>eligible(r)&&String(r.studentId)===String(id))
 .sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||""))||String(b.id||"").localeCompare(String(a.id||"")))[0]||null;
}
export function overlayMaster(old,request,student){
 if(!request)return old;
 const newStatus=request.status||"PENDING";
 return {...old,studentName:String(student.studentName||student.name||old.studentName),
  grade:String(student.grade||old.grade||""),instrument:String(student.instrument||old.instrument||""),
  style:request.style||old.style,size:request.size||old.size,
  acquisition:request.acquisition||old.acquisition,
  requestId:request.id||"",requestStatus:newStatus,
  paymentStatus:request.paymentStatus||"",
  // Changing a choice is not evidence that an item was physically handed over.
  received:old.received||newStatus==="FULFILLED",
  appliedRequestAt:request.updatedAt||request.createdAt||"",
  source:"parent_request"};
}
const comparable=x=>JSON.stringify(["studentName","grade","style","size","acquisition","instrument","requestId","requestStatus","paymentStatus","received","appliedRequestAt","source"].map(k=>x[k]??""));
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
  const changed=prev&&comparable(old)!==comparable(current);
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
