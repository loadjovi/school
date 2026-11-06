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
  return {
    emailNotificationsEnabled:e.emailNotificationsEnabled===true,
    lineNotificationMode:normalizeLineNotificationMode(e.lineNotificationMode),
    lineTargetBound:!!targetId,
    lineTargetType:String(e.lineTargetType||""),
    lineTargetLabel:String(e.lineTargetLabel||""),
    lineTargetBoundAt:String(e.lineTargetBoundAt||""),
    lineLastTestAt:String(e.lineLastTestAt||""),
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

export async function createLineBindingRequest({schoolId=defaultTenantId(),codeHash="",expiresAt="",updatedBy=""}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  await client().upsertEntity({partitionKey:partition,rowKey:"notifications",schoolId:partition,lineBindingCodeHash:String(codeHash||""),lineBindingCodeExpiresAt:String(expiresAt||""),updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return {expiresAt:String(expiresAt||"")};
}

export async function findLineBindingRequest(codeHash){
  await ensureSettingsTable();
  const safe=String(codeHash||"").replaceAll("'","''");
  if(!safe)return null;
  const now=Date.now();
  for await(const row of client().listEntities({queryOptions:{filter:`RowKey eq 'notifications' and lineBindingCodeHash eq '${safe}'`}})){
    if(Date.parse(String(row.lineBindingCodeExpiresAt||""))>now)return {schoolId:String(row.partitionKey),expiresAt:String(row.lineBindingCodeExpiresAt||"")};
  }
  return null;
}

export async function bindLineNotificationTarget({schoolId=defaultTenantId(),targetId="",targetType="group",targetLabel="",updatedBy="line-webhook"}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  if(!String(targetId||"").trim())throw new Error("LINE targetId 不可空白");
  await client().upsertEntity({
    partitionKey:partition,rowKey:"notifications",schoolId:partition,
    lineTargetId:String(targetId).trim(),lineTargetType:String(targetType||"group").slice(0,20),lineTargetLabel:String(targetLabel||"LINE 幹部群組").slice(0,120),lineTargetBoundAt:now,
    lineBindingCodeHash:"",lineBindingCodeExpiresAt:"",updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)
  },"Merge");
  return getSystemSettings(partition);
}

export async function getLineNotificationTarget(schoolId=defaultTenantId()){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId);
  try{
    const row=await client().getEntity(partition,"notifications");
    return {targetId:String(row.lineTargetId||""),targetType:String(row.lineTargetType||""),targetLabel:String(row.lineTargetLabel||""),mode:normalizeLineNotificationMode(row.lineNotificationMode)};
  }catch(error){if(error.statusCode===404)return {targetId:"",targetType:"",targetLabel:"",mode:"important_and_daily"};throw error}
}

export async function clearLineNotificationTarget({schoolId=defaultTenantId(),updatedBy=""}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  await client().upsertEntity({partitionKey:partition,rowKey:"notifications",schoolId:partition,lineTargetId:"",lineTargetType:"",lineTargetLabel:"",lineTargetBoundAt:"",lineBindingCodeHash:"",lineBindingCodeExpiresAt:"",updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return getSystemSettings(partition);
}

export async function recordLineTest({schoolId=defaultTenantId(),updatedBy=""}={}){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  await client().upsertEntity({partitionKey:partition,rowKey:"notifications",schoolId:partition,lineLastTestAt:now,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return now;
}
