import {createHash} from "node:crypto";
import {EmailClient} from "@azure/communication-email";
import {TableClient,TableServiceClient} from "@azure/data-tables";
import {tenantSchoolPartition} from "./storage.js";

// School staff are the explicitly authorized "校方查詢帳號" (school-access),
// NOT every instructor nor parent. Only notify for group-class absences.
const name=()=>process.env.SCHOOL_ABSENCE_MAIL_TABLE||"SchoolAbsenceEmailLog";
const storage=()=>process.env.STORAGE_CONNECTION_STRING;
const email=v=>String(v||"").trim().toLowerCase();
const safe=v=>String(v||"").replaceAll("'","''");
const truncate=(v,length=250)=>String(v||"").trim().slice(0,length);
const allowed=new Set(["section","ensemble","comprehensive"]);
const emailOk=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(v));
let ready=false;
const hash=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const schoolAbsenceLogPartition=schoolId=>tenantSchoolPartition(schoolId);
export function schoolAbsenceKey({date,studentId,classType,groupName,section},recipient){
 return hash([date,studentId,classType,groupName||"",classType==="section"?section||"":"",email(recipient)]);
}
export function absenceNotificationCandidates(items=[]){
 // Caller passes the saved, validated roster rather than arbitrary user names.
 const byKey=new Map();
 for(const item of items){
  if(item.status!=="absent"||!allowed.has(item.classType)||!item.studentId)continue;
  const key=hash([item.date,item.studentId,item.classType,item.groupName||"",item.classType==="section"?item.section||"":""]);
  if(!byKey.has(key))byKey.set(key,item);
 }
 return [...byKey.values()];
}
function client(){
 if(!storage())throw Error("缺少 Azure Storage");
 return TableClient.fromConnectionString(storage(),name());
}
async function logs(){
 if(!ready){
  try{await TableServiceClient.fromConnectionString(storage()).createTable(name())}
  catch(e){if(e.statusCode!==409)throw e}
  ready=true;
 }
 return client();
}
async function staffEmails(schoolId){
 const c=TableClient.fromConnectionString(storage(),process.env.SYSTEM_SETTINGS_TABLE||"SystemSettings");
 const sid=tenantSchoolPartition(schoolId);
 let entity;
 try{entity=await c.getEntity("SCHOOL|"+sid,"schoolAccess")}
 catch(e){
  if(e.statusCode!==404)throw e;
  if(sid!=="school_default")return []; // cross-tenant fallback is prohibited
  try{entity=await c.getEntity("SYSTEM","schoolAccess")}catch(other){if(other.statusCode!==404)throw other;return []}
 }
 let rows=[];
 try{rows=JSON.parse(String(entity.emailsJson||"[]"))}catch{}
 return [...new Set((Array.isArray(rows)?rows:[]).map(email).filter(emailOk))].sort();
}
const classLabel={section:"分部課",ensemble:"合奏課",comprehensive:"綜合課"};
function subject(date,count){
 return "【聖心弦樂成長平台】"+date+" 學生缺席通知（"+count+" 位）";
}
export function schoolAbsenceMailContent({date,students,appUrl}){
 const title=subject(date,students.length);
 const lines=[
  "學校老師您好：",
  date+" 弦樂團課程有 "+students.length+" 筆新登記的學生缺席紀錄，請登入「校方出缺勤」確認學生狀況。",
  "",
  ...students.map(x=>[truncate(x.name,60),classLabel[x.classType]||x.classType,
   truncate(x.groupName,20),truncate(x.section,40)].filter(Boolean).join("｜")),
  "",
  "請逐筆核對後點選「標記已知悉」，並視需要註記追蹤情形。",
  "提醒：本郵件僅表示系統偵測到缺席；不代表學校已完成確認或通知家長。",
  appUrl?"系統入口："+appUrl:"",
  "此為系統自動通知，請勿直接回覆。"
 ];
 return {subject:title,plainText:lines.filter((v,i)=>v!==""||i===2).join("\n")};
}
async function deliver(address,mail){
 const sender=truncate(process.env.ACS_EMAIL_SENDER,320);
 const conn=truncate(process.env.ACS_EMAIL_CONNECTION_STRING,2000);
 if(!sender||!conn)return {status:"not_configured",messageId:"",error:"未設定 ACS Email 服務"};
 try{
  const poller=await new EmailClient(conn).beginSend({senderAddress:sender,recipients:{to:[{address}]},content:mail});
  const result=await poller.pollUntilDone();
  return {status:String(result?.status||"").toLowerCase()==="succeeded"?"sent":"failed",messageId:truncate(result?.id,120),error:result?.status==="Succeeded"?"":truncate(result?.error?.message||result?.status,240)};
 }catch(err){return {status:"failed",messageId:"",error:truncate(err?.message||err,240)}}
}
// Returned rows are safe for the admin viewer. No message body or secrets persist.
export async function dispatchSchoolAbsenceEmails({schoolId,date,items=[],actor=""}){
 const students=absenceNotificationCandidates(items);
 if(!students.length)return {created:0,sent:0,skipped:0};
 const log=await logs();
 const recipients=await staffEmails(schoolId);
 const recipientsForAudit=recipients.length?recipients:[""];
 const batches=new Map(),now=new Date().toISOString(),sid=schoolAbsenceLogPartition(schoolId);
 let created=0,sent=0,skipped=0;
 for(const recipient of recipientsForAudit){
  const pending=[];
  for(const student of students){
   const row={partitionKey:sid,rowKey:schoolAbsenceKey(student,recipient),
    schoolId:sid,eventDate:date,studentId:truncate(student.studentId,100),
    studentName:truncate(student.name,100),groupName:truncate(student.groupName,30),
    section:truncate(student.section,80),classType:student.classType,
    recipient,actorEmail:truncate(actor,180),createdAt:now,
    status:"queued",sentAt:"",providerMessageId:"",error:""};
   try{await log.createEntity(row);pending.push(row);created++}
   catch(e){if(e.statusCode!==409)throw e;skipped++}
  }
  if(pending.length)batches.set(recipient,pending);
 }
 for(const [recipient,rows] of batches){
  let result;
  if(!recipient)result={status:"no_recipient",messageId:"",error:"尚未設定校方查詢帳號收件人"};
  else if(process.env.LAB_ENVIRONMENT==="functional-uat")result={status:"lab_suppressed",messageId:"",error:"LAB 不寄送真實通知"};
  else{
   const mail=schoolAbsenceMailContent({date,students:rows,appUrl:truncate(process.env.PUBLIC_APP_URL||"",350)});
   result=await deliver(recipient,mail);
  }
  for(const row of rows){
   await log.updateEntity({partitionKey:sid,rowKey:row.rowKey,status:result.status,
    sentAt:result.status==="sent"?new Date().toISOString():"",
    attemptedAt:new Date().toISOString(),providerMessageId:result.messageId,error:result.error},"Merge");
   if(result.status==="sent")sent++;
  }
 }
 return {created,sent,skipped};
}
export async function listSchoolAbsenceEmails(schoolId,{from,to}={}){
 const c=await logs(),partition=safe(schoolAbsenceLogPartition(schoolId)),items=[];
 for await(const e of c.listEntities({queryOptions:{filter:"PartitionKey eq '"+partition+"'"}})){
  const date=String(e.eventDate||"");
  if(date<from||date>to)continue;
  items.push({at:String(e.attemptedAt||e.createdAt||""),eventDate:date,studentName:String(e.studentName||""),
   studentId:String(e.studentId||""),groupName:String(e.groupName||""),section:String(e.section||""),
   classType:String(e.classType||""),recipient:String(e.recipient||""),status:String(e.status||"queued"),
   providerMessageId:String(e.providerMessageId||""),error:String(e.error||""),actor:String(e.actorEmail||"")});
 }
 return items;
}
