import { TableClient, TableServiceClient } from "@azure/data-tables";
import { defaultTenantId, tenantSchoolPartition } from "./storage.js";

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

export async function getSystemSettings(schoolId=defaultTenantId()){
  await ensureSettingsTable();
  const partition=tenantSchoolPartition(schoolId);
  try{
    const e=await client().getEntity(partition,"notifications");
    return {emailNotificationsEnabled:e.emailNotificationsEnabled===true,updatedAt:String(e.updatedAt||""),updatedBy:String(e.updatedBy||"")};
  }catch(e){
    if(e.statusCode!==404)throw e;
    if(partition===defaultTenantId()){
      try{
        const legacy=await client().getEntity("SYSTEM","notifications");
        const migrated={partitionKey:partition,rowKey:"notifications",schoolId:partition,emailNotificationsEnabled:legacy.emailNotificationsEnabled===true,updatedAt:String(legacy.updatedAt||new Date().toISOString()),updatedBy:String(legacy.updatedBy||"legacy-migration")};
        await client().upsertEntity(migrated,"Merge");
        return {emailNotificationsEnabled:migrated.emailNotificationsEnabled,updatedAt:migrated.updatedAt,updatedBy:migrated.updatedBy};
      }catch(legacyError){if(legacyError.statusCode!==404)throw legacyError}
    }
    return {emailNotificationsEnabled:false,updatedAt:"",updatedBy:""};
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
  return {emailNotificationsEnabled:entity.emailNotificationsEnabled,updatedAt:entity.updatedAt,updatedBy:entity.updatedBy};
}
