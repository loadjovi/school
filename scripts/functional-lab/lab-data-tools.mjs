import {TableClient,TableServiceClient} from "@azure/data-tables";
import {BlobServiceClient} from "@azure/storage-blob";
import {randomUUID} from "node:crypto";
import {getLabReadiness,assertLabIsolation} from "./labIsolation.mjs";
import {json} from "./auth.js";
import {recordAdminAudit} from "./adminAudit.js";
import {assertLabDataAccess,ownsLabRow,cleanLabRow,labDataFingerprint,labDataCount,clearLabData,restoreLabData} from "./lab-data-engine.mjs";
assertLabIsolation();

// Build-time catalog includes storage.js tenant data tables and all additional
// operational tables. No table or storage account can be supplied by the caller.
import {labDataTables} from "./lab-data-tables.mjs";
const conn=()=>process.env.STORAGE_CONNECTION_STRING;
const client=name=>TableClient.fromConnectionString(conn(),name);
const OPS="SopLabDataOperations",CONTAINER="sop-lab-reset-backups";
const safe=value=>String(value).replaceAll("'","''");
async function operationTable(){const t=client(OPS);await t.createTable().catch(e=>{if(e.statusCode!==409)throw e});return t}
async function latestBackup(schoolId){
  try{const row=await (await operationTable()).getEntity(schoolId,"last-reset");return {id:row.backupId,createdAt:row.createdAt,total:row.total}}
  catch(e){if(e.statusCode===404)return null;throw e}
}
export async function withLabDataLock(schoolId,action){
  const db=await operationTable(),owner=randomUUID();
  const row={partitionKey:schoolId,rowKey:"lock",owner,expiresAt:new Date(Date.now()+300000).toISOString()};
  try{await db.createEntity(row)}catch(e){
    if(e.statusCode!==409)throw e;
    const old=await db.getEntity(schoolId,"lock");
    if(old.expiresAt>new Date().toISOString())throw Object.assign(Error("其他幹部正在管理 LAB 資料，請稍後再試"),{statusCode:409});
    await db.updateEntity(row,"Replace",{etag:old.etag});
  }
  try{return await action()}finally{
    const current=await db.getEntity(schoolId,"lock");
    if(current.owner===owner)await db.deleteEntity(schoolId,"lock",{etag:current.etag});
  }
}
async function repositoryFor(schoolId,actor){
  const definitions=labDataTables(),allowed=new Set(definitions.map(x=>x.name));
  const query=`(PartitionKey eq '${safe(schoolId)}' or (PartitionKey ge '${safe(schoolId)}|' and PartitionKey lt '${safe(schoolId)}}'))`;
  const capture=async()=>{
    const tables={};
    const service=TableServiceClient.fromConnectionString(conn());
    const available=new Set();for await(const table of service.listTables())available.add(table.name);
    for(const {name} of definitions){
      const rows=[];
      if(available.has(name))for await(const row of client(name).listEntities({queryOptions:{filter:query}})){
        if(!ownsLabRow(row,schoolId))throw Error("資料分區與學校識別不一致，已停止："+name);
        rows.push(row);
      }
      // Empty tables are omitted to make backup fingerprints stable across
      // lazy table creation by ordinary app reads.
      if(rows.length)tables[name]=rows;
    }
    return tables;
  };
  const container=()=>BlobServiceClient.fromConnectionString(conn()).getContainerClient(CONTAINER);
  const readBackup=async id=>{
    if(!/^[a-f0-9-]{36}$/.test(String(id||"")))throw Error("備份編號不正確");
    const bytes=await container().getBlockBlobClient(`${schoolId}/${id}.json`).downloadToBuffer();
    const backup=JSON.parse(bytes.toString("utf8"));
    if(backup.schema!==1||backup.schoolId!==schoolId||Object.keys(backup.tables||{}).some(name=>!allowed.has(name)))throw Error("備份範圍不正確");
    return backup;
  };
  return {capture,readBackup,
    async saveBackup(tables){
      const backup={schema:1,id:randomUUID(),schoolId,createdAt:new Date().toISOString(),actor,total:labDataCount(tables),tables:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.map(cleanLabRow)])),fingerprint:labDataFingerprint(tables)};
      const c=container();await c.createIfNotExists();
      await c.getBlockBlobClient(`${schoolId}/${backup.id}.json`).uploadData(Buffer.from(JSON.stringify(backup)),{conditions:{ifNoneMatch:"*"},blobHTTPHeaders:{blobContentType:"application/json"}});
      const verified=await readBackup(backup.id);
      if(labDataFingerprint(verified.tables)!==backup.fingerprint)throw Error("備份完整性驗證失敗，未清除資料");
      await (await operationTable()).upsertEntity({partitionKey:schoolId,rowKey:"last-reset",backupId:backup.id,createdAt:backup.createdAt,total:backup.total},"Replace");
      return {id:backup.id,createdAt:backup.createdAt,total:backup.total};
    },
    audit:(event,detail)=>recordAdminAudit(schoolId,actor,event,detail),
    remove:(name,row)=>client(name).deleteEntity(row.partitionKey,row.rowKey,{etag:row.etag}),
    async insert(name,row){const db=client(name);await db.createTable().catch(e=>{if(e.statusCode!==409)throw e});await db.createEntity(row)},
    definitions
  };
}
export async function handleLabDataTools(request,context,body){
  try{
    assertLabDataAccess(getLabReadiness(),context);
    const {schoolId,access}=context,repository=await repositoryFor(schoolId,access.email);
    if(request.method==="GET"){
      const tables=await repository.capture(),backup=await latestBackup(schoolId);
      return json({ok:true,schoolId,storageAccount:getLabReadiness().storageAccount,total:labDataCount(tables),planToken:labDataFingerprint(tables),backup,
        tables:repository.definitions.map(({name,label})=>({name,label,count:tables[name]?.length||0})),
        preserved:["學校基本設定","學校管理員與財務權限","操作與登入稽核","清空前備份"]});
    }
    if(body.action==="RESET_LAB_DATA"){
      if(body.confirmation!=="CLEAR_CURRENT_LAB_SCHOOL"||body.schoolId!==schoolId||!/^[a-f0-9]{64}$/.test(String(body.planToken||"")))return json({error:"請重新讀取並確認目前 LAB 學校清除範圍"},400);
      const result=await withLabDataLock(schoolId,()=>clearLabData({repository,schoolId,planToken:body.planToken,actor:access.email}));
      return json(result,result.ok?200:409);
    }
    if(body.action==="RESTORE_LAB_DATA"){
      if(body.confirmation!=="RESTORE_CURRENT_LAB_SCHOOL"||body.schoolId!==schoolId)return json({error:"請確認還原目前 LAB 學校"},400);
      const backup=await latestBackup(schoolId);
      if(!backup||body.backupId!==backup.id)return json({error:"備份版本已更新，請重新讀取"},409);
      return json(await withLabDataLock(schoolId,()=>restoreLabData({repository,schoolId,backupId:backup.id,actor:access.email})));
    }
    return json({error:"未知的 LAB 資料操作"},400);
  }catch(error){console.error("LAB data tools failed",error.message);return json({error:error.message},[400,403,409,503].includes(error.statusCode)?error.statusCode:503)}
}
