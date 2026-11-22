import {createHash} from "node:crypto";
import {getStudentIdAliases} from "./auth.js";
import {getStudentMaster,table,tenantSchoolPartition,tenantStudentPartition} from "./storage.js";
import {deliverLabNotice,labNoticeLineResult,lineFirstLabEnabled} from "./labNoticeDelivery.mjs";

const levels=["","🌱 起步中","👍 持續加油","🙂 表現不錯","🌟 很棒喔","🏆 超級投入"];
const fingerprint=row=>createHash("sha256").update(JSON.stringify([row.studentId,row.feedbackMonth,row.feedbackDate,Number(row.level),row.comment||"",row.teacherEmail,row.teacherName])).digest("hex");
async function noticeContext(schoolId,feedback){
 let stored;
 try{stored=await table("tenantPracticeFeedback").getEntity(feedback.partitionKey,feedback.rowKey)}catch(error){if(error.statusCode===404)return null;throw error}
 if(stored.schoolId!==tenantSchoolPartition(schoolId)||stored.partitionKey!==tenantStudentPartition(schoolId,stored.studentId)||fingerprint(stored)!==fingerprint(feedback))return null;
 const [student,aliases]=await Promise.all([getStudentMaster(stored.studentId,schoolId),getStudentIdAliases(stored.studentId,schoolId)]);
 if(!student||student.status==="inactive")return null;
 const safe=value=>String(value).replaceAll("'","''"),sid=tenantSchoolPartition(schoolId),recipients=new Set();
 const filter=`schoolId eq '${safe(sid)}' and status eq 'active' and (${aliases.map(id=>`RowKey eq '${safe(id)}'`).join(" or ")})`;
 for await(const mapping of table("tenantUserStudentMap").listEntities({queryOptions:{filter}})){
  const email=String(mapping.parentEmail||"").trim().toLowerCase();
  if(email&&mapping.schoolId===sid&&mapping.status==="active"&&aliases.includes(String(mapping.rowKey)))recipients.add(email);
 }
 return {stored,student,recipients:[...recipients]};
}

export async function notifyPracticeFeedback(schoolId,feedback){
 if(!lineFirstLabEnabled())return {status:"disabled"};
 try{
  const context=await noticeContext(schoolId,feedback);if(!context)return {status:"ineligible"};
  const {stored,student,recipients}=context;
  const text=["【LAB｜老師的日常鼓勵】",`${student.studentName||student.name||"學生"}，你的努力被看見了！`,`${stored.teacherName||"老師"}：${levels[Number(stored.level)]||"💛 繼續加油"}`,stored.comment,`回饋日期：${stored.feedbackDate}`,"這是日常鼓勵，不影響成績。"].filter(Boolean).join("\n");
  return labNoticeLineResult(await deliverLabNotice({schoolId,eventId:`practice-feedback:${stored.rowKey}:${fingerprint(stored)}`,recipients,subject:"老師的日常鼓勵",text,stillDue:async recipient=>{
   const current=await noticeContext(schoolId,feedback);return !!current&&current.recipients.includes(recipient);
  }}));
 }catch(error){console.error("practice feedback notification",error);return {status:"failed"}}
}
