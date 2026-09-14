import { TableClient, TableServiceClient } from "@azure/data-tables";

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

export async function getSystemSettings(){
  await ensureSettingsTable();
  try{
    const e=await client().getEntity("SYSTEM","notifications");
    return {emailNotificationsEnabled:e.emailNotificationsEnabled===true,updatedAt:String(e.updatedAt||""),updatedBy:String(e.updatedBy||"")};
  }catch(e){
    if(e.statusCode!==404)throw e;
    return {emailNotificationsEnabled:false,updatedAt:"",updatedBy:""};
  }
}

export async function saveSystemSettings({emailNotificationsEnabled=false,updatedBy=""}={}){
  await ensureSettingsTable();
  const entity={
    partitionKey:"SYSTEM",rowKey:"notifications",
    emailNotificationsEnabled:emailNotificationsEnabled===true,
    updatedAt:new Date().toISOString(),updatedBy:String(updatedBy||"").slice(0,160)
  };
  await client().upsertEntity(entity,"Merge");
  return {emailNotificationsEnabled:entity.emailNotificationsEnabled,updatedAt:entity.updatedAt,updatedBy:entity.updatedBy};
}
