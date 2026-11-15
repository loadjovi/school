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

export async function getLineAccountBindingsByUserId(lineUserId,{includeTarget=false}={}){
  await ensureTable();
  const userId=String(lineUserId||"").trim(),lineUserIdHash=userHash(userId);
  if(!userId)return [];
  const items=[];
  for await(const row of client().listEntities({queryOptions:{filter:`lineUserIdHash eq '${lineUserIdHash}' and status eq 'ACTIVE'`}})){
    items.push({
      bound:true,
      schoolId:String(row.schoolId||row.partitionKey||""),
      parentEmail:emailValue(row.parentEmail),
      lineDisplayName:String(row.lineDisplayName||""),
      boundAt:String(row.boundAt||""),
      ...(includeTarget?{lineUserId:String(row.lineUserId||"")}:{})
    });
  }
  return items;
}

export async function getLineAccountBindingsByEmail(email,{includeTarget=false}={}){
  await ensureTable();
  const parentEmail=emailValue(email);if(!parentEmail)return [];
  const safe=parentEmail.replaceAll("'","''"),items=[];
  for await(const row of client().listEntities({queryOptions:{filter:`parentEmail eq '${safe}' and status eq 'ACTIVE'`}})){
    items.push({
      bound:true,
      schoolId:String(row.schoolId||row.partitionKey||""),
      parentEmail,
      lineDisplayName:String(row.lineDisplayName||""),
      boundAt:String(row.boundAt||""),
      lineUserIdHash:String(row.lineUserIdHash||""),
      ...(includeTarget?{lineUserId:String(row.lineUserId||"")}:{})
    });
  }
  return items;
}

export async function moveLineAccountBinding({schoolId,fromEmail,toEmail,lineUserId}={}){
  await ensureTable();
  const sid=tenantSchoolPartition(schoolId),sourceEmail=emailValue(fromEmail),targetEmail=emailValue(toEmail);
  const userId=String(lineUserId||"").trim(),lineUserIdHash=userHash(userId);
  if(!sourceEmail||!targetEmail||!userId)throw new Error("LINE 帳號移轉資料不完整");
  if(sourceEmail===targetEmail)return {ok:true,moved:false,schoolId:sid,parentEmail:targetEmail};
  let source,target;
  try{source=await client().getEntity(sid,emailRowKey(sourceEmail))}catch(error){if(error.statusCode!==404)throw error}
  try{target=await client().getEntity(sid,emailRowKey(targetEmail))}catch(error){if(error.statusCode!==404)throw error}
  if(target?.status==="ACTIVE"){
    if(String(target.lineUserIdHash||"")!==lineUserIdHash)return {ok:false,reason:"target_already_bound"};
    if(source?.status==="ACTIVE"){
      if(String(source.lineUserIdHash||"")!==lineUserIdHash)return {ok:false,reason:"source_mismatch"};
      await client().updateEntity({partitionKey:sid,rowKey:source.rowKey,status:"MOVED",lineUserId:"",lineUserIdHash:"",movedToEmailHash:digest(targetEmail),movedAt:new Date().toISOString(),updatedAt:new Date().toISOString()},"Merge",{etag:source.etag});
    }
    return {ok:true,moved:Boolean(source?.status==="ACTIVE"),schoolId:sid,parentEmail:targetEmail};
  }
  if(!source||source.status!=="ACTIVE")return {ok:false,reason:"source_not_bound"};
  if(String(source.lineUserIdHash||"")!==lineUserIdHash)return {ok:false,reason:"source_mismatch"};
  const now=new Date().toISOString(),next={
    partitionKey:sid,rowKey:emailRowKey(targetEmail),schoolId:sid,parentEmail:targetEmail,
    lineUserId:userId,lineUserIdHash,lineDisplayName:String(source.lineDisplayName||"").slice(0,120),
    status:"ACTIVE",boundAt:String(source.boundAt||now),updatedAt:now,movedFromEmailHash:digest(sourceEmail)
  };
  const deactivate={partitionKey:sid,rowKey:source.rowKey,status:"MOVED",lineUserId:"",lineUserIdHash:"",movedToEmailHash:digest(targetEmail),movedAt:now,updatedAt:now};
  try{
    await client().submitTransaction([
      ["update",deactivate,"Merge",{etag:source.etag}],
      target?["update",next,"Replace",{etag:target.etag}]:["create",next]
    ]);
  }catch(error){
    if([409,412].includes(error.statusCode))return {ok:false,reason:"concurrent_change"};
    throw error;
  }
  return {ok:true,moved:true,schoolId:sid,parentEmail:targetEmail};
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
