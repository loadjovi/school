// Copied only into the generated Functional UAT LAB API.
// It creates and assigns per-user rich menus only for the single allowlisted
// LAB tester. It never sets a Messaging API default menu.
import {createHash,timingSafeEqual} from "node:crypto";
import {TableClient,TableServiceClient} from "@azure/data-tables";
import {assertLabIsolation} from "./labIsolation.mjs";
import {getLineAccountBinding} from "./lineAccountBinding.js";
import {getMappedStudentsByEmail,listTenantRolesByEmail,tenantSchoolPartition} from "./storage.js";
import {LAB_RICH_MENU_AUDIENCES,labRichMenuDefinition,resolveLabRichMenuAudience} from "./labLineRichMenuRules.mjs";

const tableName="LabLineRichMenuConfig";
const origin="https://icy-ocean-0a2602100.6.azurestaticapps.net";
const hash=value=>createHash("sha256").update(String(value||"")).digest("hex");
let tablePromise=null;

async function db(){
  assertLabIsolation();
  if(!tablePromise)tablePromise=(async()=>{
    const connection=String(process.env.STORAGE_CONNECTION_STRING||"");
    if(!connection)throw Error("LAB storage unavailable");
    const service=TableServiceClient.fromConnectionString(connection);
    try{await service.createTable(tableName)}catch(error){if(error.statusCode!==409)throw error}
    return TableClient.fromConnectionString(connection,tableName);
  })();
  try{return await tablePromise}catch(error){tablePromise=null;throw error}
}

function token(){
  const value=String(process.env.LAB_LINE_MESSAGING_ACCESS_TOKEN||"").trim();
  if(!value)throw Error("LAB_LINE_MESSAGING_ACCESS_TOKEN 未設定");
  return value;
}

function allowlisted(lineUserId){
  const actual=String(lineUserId||"").trim().toLowerCase();
  const expected=String(process.env.LAB_LINE_TEST_USER_ID||"").trim().toLowerCase();
  if(!/^u[0-9a-f]{32}$/.test(actual)||!/^u[0-9a-f]{32}$/.test(expected))return false;
  return actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}

async function lineApi(path,{method="POST",json=null,contentType="",body=null,dataApi=false}={}){
  assertLabIsolation();
  const response=await fetch(`${dataApi?"https://api-data.line.me":"https://api.line.me"}${path}`,{
    method,signal:AbortSignal.timeout(15000),
    headers:{Authorization:`Bearer ${token()}`,...(json?{"Content-Type":"application/json"}:{}),...(contentType?{"Content-Type":contentType}:{})},
    ...(json?{body:JSON.stringify(json)}:body?{body}:{})
  });
  const text=await response.text();
  if(!response.ok)throw Error(`LINE Rich Menu API 回應 ${response.status}`);
  if(!text)return {};
  try{return JSON.parse(text)}catch{return {}}
}

const rowKey=schoolId=>hash(tenantSchoolPartition(schoolId)).slice(0,48);

export async function getLabRichMenuConfig(schoolId){
  try{
    const row=await (await db()).getEntity("CONFIG",rowKey(schoolId));
    return {
      configured:Boolean(row.parentRichMenuId&&row.staffRichMenuId),
      parentRichMenuId:String(row.parentRichMenuId||""),staffRichMenuId:String(row.staffRichMenuId||""),
      updatedAt:String(row.updatedAt||""),updatedBy:String(row.updatedBy||"")
    };
  }catch(error){if(error.statusCode===404)return {configured:false,parentRichMenuId:"",staffRichMenuId:"",updatedAt:"",updatedBy:""};throw error}
}

async function createOne(audience,image){
  const created=await lineApi("/v2/bot/richmenu",{json:labRichMenuDefinition(audience,origin)});
  const id=String(created.richMenuId||"");
  if(!id)throw Error("LINE 未回傳 richMenuId");
  try{
    await lineApi(`/v2/bot/richmenu/${encodeURIComponent(id)}/content`,{contentType:"image/png",body:image,dataApi:true});
    return id;
  }catch(error){
    try{await lineApi(`/v2/bot/richmenu/${encodeURIComponent(id)}`,{method:"DELETE"})}catch{}
    throw error;
  }
}

async function saveConfig({schoolId,parentRichMenuId="",staffRichMenuId="",updatedBy=""}){
  const now=new Date().toISOString();
  await (await db()).upsertEntity({partitionKey:"CONFIG",rowKey:rowKey(schoolId),schoolId:tenantSchoolPartition(schoolId),parentRichMenuId,staffRichMenuId,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Replace");
  return now;
}

export async function setupLabRichMenus({schoolId,parentImage,staffImage,updatedBy="",force=false}={}){
  assertLabIsolation();
  if(!Buffer.isBuffer(parentImage)||!Buffer.isBuffer(staffImage))throw Error("LAB 圖文選單圖片缺失");
  const existing=await getLabRichMenuConfig(schoolId);
  if(existing.configured&&!force)return {...existing,reused:true};
  let parentRichMenuId="",staffRichMenuId="";
  try{
    parentRichMenuId=await createOne(LAB_RICH_MENU_AUDIENCES.PARENT,parentImage);
    staffRichMenuId=await createOne(LAB_RICH_MENU_AUDIENCES.STAFF,staffImage);
    const now=await saveConfig({schoolId,parentRichMenuId,staffRichMenuId,updatedBy});
    return {configured:true,parentRichMenuId,staffRichMenuId,updatedAt:now,updatedBy:String(updatedBy||""),reused:false,replaced:existing.configured};
  }catch(error){
    for(const id of [parentRichMenuId,staffRichMenuId]){
      if(id)try{await lineApi(`/v2/bot/richmenu/${encodeURIComponent(id)}`,{method:"DELETE"})}catch{}
    }
    throw error;
  }
}

export async function resolveLabAccountMenu({schoolId,email,parentLinked=false}={}){
  const normalized=String(email||"").trim().toLowerCase();
  const [roles,students]=await Promise.all([
    listTenantRolesByEmail(normalized,"active"),
    getMappedStudentsByEmail(normalized,tenantSchoolPartition(schoolId))
  ]);
  return resolveLabRichMenuAudience({schoolId,tenantRoles:roles,studentCount:students.length,parentLinked});
}

async function recordAssignment({schoolId,lineUserId,audience,richMenuId="",email=""}){
  await (await db()).upsertEntity({
    partitionKey:"ASSIGNMENT",rowKey:hash(lineUserId).slice(0,48),schoolId:tenantSchoolPartition(schoolId),
    lineUserIdMasked:`${String(lineUserId).slice(0,4)}…${String(lineUserId).slice(-4)}`,
    parentEmailHash:hash(String(email).toLowerCase()).slice(0,32),audience,richMenuId,updatedAt:new Date().toISOString()
  },"Replace");
}

export async function assignLabRoleRichMenu({schoolId,email,lineUserId="",parentLinked=false}={}){
  assertLabIsolation();
  const binding=lineUserId?null:await getLineAccountBinding(schoolId,email,{includeTarget:true});
  const normalizedEmail=String(email||"").trim().toLowerCase();
  const allowedEmail=String(process.env.LAB_LINE_TEST_PARENT_EMAIL||"").trim().toLowerCase();
  const identityLinkedTarget=normalizedEmail&&normalizedEmail===allowedEmail
    ?String(process.env.LAB_LINE_TEST_USER_ID||"").trim():"";
  // The LAB OAuth identity can already be linked to Gmail while the legacy
  // notification-binding row is absent. The explicit single-user allowlist is
  // the canonical fallback for role-menu assignment in that state.
  const target=String(lineUserId||binding?.lineUserId||identityLinkedTarget||"");
  if(!allowlisted(target))return {assigned:false,reason:"not_allowlisted"};
  const audience=await resolveLabAccountMenu({schoolId,email,parentLinked});
  if(audience===LAB_RICH_MENU_AUDIENCES.UNBOUND)return unlinkLabRoleRichMenu({schoolId,email,lineUserId:target});
  const config=await getLabRichMenuConfig(schoolId);
  if(!config.configured)return {assigned:false,audience,reason:"menus_not_configured"};
  const richMenuId=audience===LAB_RICH_MENU_AUDIENCES.STAFF?config.staffRichMenuId:config.parentRichMenuId;
  await lineApi(`/v2/bot/user/${encodeURIComponent(target)}/richmenu/${encodeURIComponent(richMenuId)}`);
  await recordAssignment({schoolId,lineUserId:target,audience,richMenuId,email});
  return {assigned:true,audience};
}

export async function assignLabRoleRichMenuForIdentity({schoolId,email,identity,parentLinked=false}={}){
  return assignLabRoleRichMenu({schoolId,email,lineUserId:String(identity?.lineUserId||""),parentLinked});
}

export async function unlinkLabRoleRichMenu({schoolId,email="",lineUserId}={}){
  assertLabIsolation();
  const target=String(lineUserId||"");
  if(!allowlisted(target))return {unlinked:false,reason:"not_allowlisted"};
  await lineApi(`/v2/bot/user/${encodeURIComponent(target)}/richmenu`,{method:"DELETE"});
  await recordAssignment({schoolId,lineUserId:target,audience:LAB_RICH_MENU_AUDIENCES.UNBOUND,email});
  return {unlinked:true,audience:LAB_RICH_MENU_AUDIENCES.UNBOUND};
}
