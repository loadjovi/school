import { TableClient, TableServiceClient } from "@azure/data-tables";
import { tenantSchoolPartition } from "./storage.js";

const name=()=>process.env.SCHOOL_ACCESS_LOG_TABLE||"SchoolAccessLog";
const connection=()=>process.env.STORAGE_CONNECTION_STRING;
let ready=false;
export function adminAuditPartition(schoolId){return `${tenantSchoolPartition(schoolId)}|admin-audit`}
export async function recordAdminAudit(schoolId,email,eventType,detail={}){
  if(!ready){
    if(!connection())throw new Error("STORAGE_CONNECTION_STRING 未設定");
    try{await TableServiceClient.fromConnectionString(connection()).createTable(name())}catch(e){if(e.statusCode!==409)throw e}
    ready=true;
  }
  const at=new Date().toISOString();
  await TableClient.fromConnectionString(connection(),name()).createEntity({
    partitionKey:adminAuditPartition(schoolId),
    rowKey:`${at.replace(/[-:.TZ]/g,"")}_${Math.random().toString(36).slice(2,10)}`,
    schoolId:tenantSchoolPartition(schoolId),actorEmail:String(email||"").trim().toLowerCase(),
    eventType,createdAt:at,detailJson:JSON.stringify(detail).slice(0,3000)
  });
  return at;
}
export async function auditSaved(schoolId,email,eventType,detail){
  try{await recordAdminAudit(schoolId,email,eventType,detail)}
  catch(e){console.error("admin activity audit failed",{eventType,schoolId,error:e?.message||String(e)})}
}
