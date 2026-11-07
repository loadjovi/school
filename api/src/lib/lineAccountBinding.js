import {createHash} from "node:crypto";
import {TableClient,TableServiceClient} from "@azure/data-tables";
import {tenantSchoolPartition} from "./storage.js";

const tableName=()=>process.env.LINE_ACCOUNT_BINDING_TABLE||"TenantLineAccountBinding";
const connection=()=>process.env.STORAGE_CONNECTION_STRING;
let initialized=false;

async function ensureTable(){
  if(initialized)return;
  if(!connection())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  const service=TableServiceClient.fromConnectionString(connection());
  try{await service.createTable(tableName())}catch(error){if(error.statusCode!==409)throw error}
  initialized=true;
}

function client(){return TableClient.fromConnectionString(connection(),tableName())}
function emailValue(value){return String(value||"").trim().toLowerCase()}
function digest(value){return createHash("sha256").update(String(value||"")).digest("hex")}
function emailRowKey(email){return `email_${digest(emailValue(email)).slice(0,40)}`}
function userHash(userId){return digest(String(userId||"").trim())}

export async function createLineAccountBindingRequest({schoolId,email,codeHash,expiresAt}={}){
  await ensureTable();
  const sid=tenantSchoolPartition(schoolId),parentEmail=emailValue(email),hash=String(codeHash||"").trim(),now=new Date().toISOString();
  if(!parentEmail||!hash||!Number.isFinite(Date.parse(String(expiresAt||""))))throw new Error("LINE 帳號綁定資料不完整");
  await client().upsertEntity({
    partitionKey:"REQUEST",rowKey:hash,schoolId:sid,parentEmail,status:"ACTIVE",
    expiresAt:String(expiresAt),createdAt:now,updatedAt:now
  },"Replace");
  return {expiresAt:String(expiresAt)};
}

export async function findLineAccountBindingRequest(codeHash){
  await ensureTable();
  const hash=String(codeHash||"").trim();if(!hash)return null;
  try{
    const row=await client().getEntity("REQUEST",hash);
    if(row.status!=="ACTIVE"||Date.parse(String(row.expiresAt||""))<=Date.now())return null;
    return row;
  }catch(error){if(error.statusCode===404)return null;throw error}
}

export async function bindLineAccount({codeHash,lineUserId,lineDisplayName=""}={}){
  await ensureTable();
  const hash=String(codeHash||"").trim(),userId=String(lineUserId||"").trim();
  if(!hash||!userId)throw new Error("LINE 帳號綁定資料不完整");
  const request=await findLineAccountBindingRequest(hash);
  if(!request)return {ok:false,reason:"expired"};
  const sid=tenantSchoolPartition(request.schoolId),parentEmail=emailValue(request.parentEmail),lineUserIdHash=userHash(userId);
  for await(const row of client().listEntities({queryOptions:{filter:`PartitionKey eq '${sid.replaceAll("'","''")}' and lineUserIdHash eq '${lineUserIdHash}' and status eq 'ACTIVE'`}})){
    if(emailValue(row.parentEmail)!==parentEmail)return {ok:false,reason:"already_bound"};
  }
  const now=new Date().toISOString(),binding={
    partitionKey:sid,rowKey:emailRowKey(parentEmail),schoolId:sid,parentEmail,
    lineUserId:userId,lineUserIdHash,lineDisplayName:String(lineDisplayName||"").trim().slice(0,120),
    status:"ACTIVE",boundAt:now,updatedAt:now
  };
  try{
    await client().updateEntity({partitionKey:"REQUEST",rowKey:hash,status:"CONSUMED",consumedAt:now,updatedAt:now},"Merge",{etag:request.etag});
  }catch(error){
    if(error.statusCode===412)return {ok:false,reason:"expired"};
    throw error;
  }
  await client().upsertEntity(binding,"Replace");
  return {ok:true,schoolId:sid,parentEmail,lineDisplayName:binding.lineDisplayName,boundAt:now};
}

export async function getLineAccountBinding(schoolId,email,{includeTarget=false}={}){
  await ensureTable();
  const sid=tenantSchoolPartition(schoolId),parentEmail=emailValue(email);if(!parentEmail)return null;
  try{
    const row=await client().getEntity(sid,emailRowKey(parentEmail));
    if(row.status!=="ACTIVE")return null;
    return {bound:true,lineDisplayName:String(row.lineDisplayName||""),boundAt:String(row.boundAt||""),...(includeTarget?{lineUserId:String(row.lineUserId||"")}:{})};
  }catch(error){if(error.statusCode===404)return null;throw error}
}

export async function unbindLineAccount(schoolId,email){
  await ensureTable();
  const sid=tenantSchoolPartition(schoolId),parentEmail=emailValue(email),now=new Date().toISOString();
  if(!parentEmail)return false;
  try{
    await client().updateEntity({partitionKey:sid,rowKey:emailRowKey(parentEmail),status:"INACTIVE",lineUserId:"",lineUserIdHash:"",updatedAt:now,unboundAt:now},"Merge");
    return true;
  }catch(error){if(error.statusCode===404)return false;throw error}
}
