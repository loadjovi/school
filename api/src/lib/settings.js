import { TableClient, TableServiceClient } from "@azure/data-tables";
import { defaultTenantId, tenantSchoolPartition } from "./storage.js";
import {normalizeLineNotificationMode} from "./lineMessaging.mjs";

const tableName=()=>process.env.SYSTEM_SETTINGS_TABLE||"SystemSettings";
const conn=()=>process.env.STORAGE_CONNECTION_STRING;
let initialized=false;

async function ensureSettingsTable(){
  if(initialized)return;
  if(!conn())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  const service=TableServiceClient.fromConnectionString(conn());
  try{await service.createTable(tableName())}catch(e){if(e.statusCode!==409)throw e}
  initialized=true;
}

function client(){return TableClient.fromConnectionString(conn(),tableName())}

function settingsView(e={}){
  const targetId=String(e.lineTargetId||"");
  const absenceTargetId=String(e.lineAbsenceTargetId||"");
  return {
    emailNotificationsEnabled:e.emailNotificationsEnabled===true,
    lineNotificationMode:normalizeLineNotificationMode(e.lineNotificationMode),
    lineTargetBound:!!targetId,
    lineTargetType:String(e.lineTargetType||""),
    lineTargetLabel:String(e.lineTargetLabel||""),
    lineTargetBoundAt:String(e.lineTargetBoundAt||""),
    lineLastTestAt:String(e.lineLastTestAt||""),
    lineAbsenceTargetBound:!!absenceTargetId,
    lineAbsenceTargetType:String(e.lineAbsenceTargetType||""),
    lineAbsenceTargetLabel:String(e.lineAbsenceTargetLabel||""),
    lineAbsenceTargetBoundAt:String(e.lineAbsenceTargetBoundAt||""),
    lineAbsenceLastTestAt:String(e.lineAbsenceLastTestAt||""),
    updatedAt:String(e.updatedAt||""),
    updatedBy:String(e.updatedBy||"")
  };
}

export async function getSystemSettings(schoolId=defaultTenantId()){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId);
  try{
    const e=await client().getEntity(partition,"notifications");
    return settingsView(e);
  }catch(e){
    if(e.statusCode!==404)throw e;
    if(partition===defaultTenantId()){
      try{
        const legacy=await client().getEntity("SYSTEM","notifications");
        const migrated={partitionKey:partition,rowKey:"notifications",schoolId:partition,emailNotificationsEnabled:legacy.emailNotificationsEnabled===true,updatedAt:String(legacy.updatedAt||new Date().toISOString()),updatedBy:String(legacy.updatedBy||"legacy-migration")};
        await client().upsertEntity(migrated,"Merge");
        return settingsView(migrated);
      }catch(legacyError){if(legacyError.statusCode!==404)throw legacyError}
    }
    return settingsView({});
  }
}

export async function saveSystemSettings({emailNotificationsEnabled=false,updatedBy="",schoolId=defaultTenantId()}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId);
  const entity={
    partitionKey:partition,rowKey:"notifications",schoolId:partition,
    emailNotificationsEnabled:emailNotificationsEnabled===true,
    updatedAt:new Date().toISOString(),updatedBy:String(updatedBy||"").slice(0,160)
  };
  await client().upsertEntity(entity,"Merge");
  return getSystemSettings(partition);
}

export async function saveLineNotificationMode({schoolId=defaultTenantId(),mode="important_and_daily",updatedBy=""}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  await client().upsertEntity({partitionKey:partition,rowKey:"notifications",schoolId:partition,lineNotificationMode:normalizeLineNotificationMode(mode),updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return getSystemSettings(partition);
}

export async function createLineBindingRequest({schoolId=defaultTenantId(),codeHash="",expiresAt="",purpose="admin",updatedBy=""}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  const absence=purpose==="absence";
  await client().upsertEntity({partitionKey:partition,rowKey:"notifications",schoolId:partition,
    [absence?"lineAbsenceBindingCodeHash":"lineBindingCodeHash"]:String(codeHash||""),
    [absence?"lineAbsenceBindingCodeExpiresAt":"lineBindingCodeExpiresAt"]:String(expiresAt||""),
    updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return {expiresAt:String(expiresAt||"")};
}

export async function findLineBindingRequest(codeHash){
  await ensureSettingsTable();
  const safe=String(codeHash||"").replaceAll("'","''");
  if(!safe)return null;
  const now=Date.now();
  for await(const row of client().listEntities({queryOptions:{filter:`RowKey eq 'notifications'`}})){
    if(String(row.lineBindingCodeHash||"")===safe&&Date.parse(String(row.lineBindingCodeExpiresAt||""))>now)return {schoolId:String(row.partitionKey),expiresAt:String(row.lineBindingCodeExpiresAt||""),purpose:"admin"};
    if(String(row.lineAbsenceBindingCodeHash||"")===safe&&Date.parse(String(row.lineAbsenceBindingCodeExpiresAt||""))>now)return {schoolId:String(row.partitionKey),expiresAt:String(row.lineAbsenceBindingCodeExpiresAt||""),purpose:"absence"};
  }
  return null;
}

export async function bindLineNotificationTarget({schoolId=defaultTenantId(),targetId="",targetType="group",targetLabel="",purpose="admin",updatedBy="line-webhook"}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  if(!String(targetId||"").trim())throw new Error("LINE targetId 不可空白");
  const absence=purpose==="absence",prefix=absence?"lineAbsence":"line";
  await client().upsertEntity({
    partitionKey:partition,rowKey:"notifications",schoolId:partition,
    [`${prefix}TargetId`]:String(targetId).trim(),[`${prefix}TargetType`]:String(targetType||"group").slice(0,20),[`${prefix}TargetLabel`]:String(targetLabel||(absence?"學生缺席通知群組":"LINE 幹部群組")).slice(0,120),[`${prefix}TargetBoundAt`]:now,
    [absence?"lineAbsenceBindingCodeHash":"lineBindingCodeHash"]:"",[absence?"lineAbsenceBindingCodeExpiresAt":"lineBindingCodeExpiresAt"]:"",updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)
  },"Merge");
  return getSystemSettings(partition);
}

export async function getLineNotificationTarget(schoolId=defaultTenantId(),purpose="admin"){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId);
  try{
    const row=await client().getEntity(partition,"notifications");
    if(purpose==="absence")return {targetId:String(row.lineAbsenceTargetId||""),targetType:String(row.lineAbsenceTargetType||""),targetLabel:String(row.lineAbsenceTargetLabel||"")};
    return {targetId:String(row.lineTargetId||""),targetType:String(row.lineTargetType||""),targetLabel:String(row.lineTargetLabel||""),mode:normalizeLineNotificationMode(row.lineNotificationMode)};
  }catch(error){if(error.statusCode===404)return {targetId:"",targetType:"",targetLabel:"",...(purpose==="absence"?{}:{mode:"important_and_daily"})};throw error}
}

export async function clearLineNotificationTarget({schoolId=defaultTenantId(),purpose="admin",updatedBy=""}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  const absence=purpose==="absence",prefix=absence?"lineAbsence":"line";
  await client().upsertEntity({partitionKey:partition,rowKey:"notifications",schoolId:partition,
    [`${prefix}TargetId`]:"",[`${prefix}TargetType`]:"",[`${prefix}TargetLabel`]:"",[`${prefix}TargetBoundAt`]:"",
    [absence?"lineAbsenceBindingCodeHash":"lineBindingCodeHash"]:"",[absence?"lineAbsenceBindingCodeExpiresAt":"lineBindingCodeExpiresAt"]:"",updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return getSystemSettings(partition);
}

export async function recordLineTest({schoolId=defaultTenantId(),purpose="admin",updatedBy=""}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  await client().upsertEntity({partitionKey:partition,rowKey:"notifications",schoolId:partition,[purpose==="absence"?"lineAbsenceLastTestAt":"lineLastTestAt"]:now,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return now;
}
