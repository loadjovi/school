import { TableClient, TableServiceClient } from "@azure/data-tables";
import { createHash } from "node:crypto";
import { tenantSchoolPartition } from "./storage.js";

const teacherRoles=new Set(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]);
const name=()=>process.env.SCHOOL_ACCESS_LOG_TABLE||"SchoolAccessLog";
const connection=()=>process.env.STORAGE_CONNECTION_STRING;
const safe=value=>String(value||"").replaceAll("'","''");
let ready=false;
async function client(){
  if(!connection())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  if(!ready){try{await TableServiceClient.fromConnectionString(connection()).createTable(name())}catch(e){if(e.statusCode!==409)throw e}ready=true}
  return TableClient.fromConnectionString(connection(),name());
}
export const teacherLoginPartition=schoolId=>`${tenantSchoolPartition(schoolId)}|teacher-login`;
export function teacherLoginResult(access,requestedContext){
  if(teacherRoles.has(access.role))return "success";
  return requestedContext==="teacher"&&access.authenticated?"denied":"";
}
export async function recordTeacherLogin(access,requestedContext){
  const result=teacherLoginResult(access,requestedContext);
  if(!result||!access.schoolId||!access.authSessionId||!access.email)return {created:false};
  const schoolId=tenantSchoolPartition(access.schoolId),partitionKey=teacherLoginPartition(schoolId);
  const email=String(access.email).trim().toLowerCase(),createdAt=new Date().toISOString();
  // The index makes concurrent /me requests idempotent. No credential is stored.
  const hash=createHash("sha256").update([schoolId,email,access.authSessionId,result].join("|")).digest("hex");
  const index={partitionKey,rowKey:"session_"+hash,createdAt};
  const rowKey="login_"+String(8640000000000000-Date.parse(createdAt)).padStart(16,"0")+"_"+hash;
  const entity={partitionKey,rowKey,schoolId,eventType:"teacher_login",teacherEmail:email,teacherName:String(access.displayName||"").slice(0,120),role:String(access.role||"").slice(0,40),result,reason:result==="denied"?"此帳號尚未取得可用的老師身分":"",createdAt};
  const t=await client();
  try{await t.submitTransaction([["create",index],["create",entity]])}
  catch(e){if(e.statusCode===409)return {created:false};throw e}
  return {created:true,at:createdAt,result};
}
export function validAuditDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return false;
  const date=new Date(value+"T00:00:00Z");
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export async function listTeacherLogins(schoolId,{from,to,email="",result="",cursor="",limit=100}){
  const partition=teacherLoginPartition(schoolId);
  const start=new Date(from+"T00:00:00+08:00").toISOString();
  const end=new Date(Date.parse(to+"T00:00:00+08:00")+86400000).toISOString();
  const parts=[`PartitionKey eq '${safe(partition)}'`,"eventType eq 'teacher_login'",`createdAt ge '${safe(start)}'`,`createdAt lt '${safe(end)}'`];
  if(email)parts.push(`teacherEmail eq '${safe(email.toLowerCase())}'`);
  if(result)parts.push(`result eq '${safe(result)}'`);
  const t=await client(),pages=t.listEntities({queryOptions:{filter:parts.join(" and ")}}).byPage({continuationToken:cursor||undefined,maxPageSize:Math.min(100,Math.max(1,limit))});
  const page=await pages.next();
  const items=page.done?[]:Array.from(page.value,row=>({id:row.rowKey,at:row.createdAt,email:row.teacherEmail,name:row.teacherName,role:row.role,result:row.result,reason:row.reason||""}));
  return {items,nextCursor:page.done?"":String(page.value.continuationToken||""),from,to};
}
