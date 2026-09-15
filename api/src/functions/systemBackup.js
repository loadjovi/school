import { app } from "@azure/functions";
import { TableClient, TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { createHash } from "node:crypto";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table } from "../lib/storage.js";

const SCHEMA_VERSION=1;
const LOGICAL_TABLES=[
  ["PracticeLog","practice"],["SectionAttendance","section"],["EnsembleAttendance","ensemble"],["ComprehensiveAttendance","comprehensive"],["PrivateLesson","privateLesson"],["StudentRegistration","registrations"],["UserStudentMap","userStudentMap"],["StudentMaster","studentMaster"],["StudentHistory","studentHistory"],["SemesterEnrollment","semesterEnrollment"],["TeacherDirectory","teacherDirectory"],["TeacherProfile","teacherProfile"],["AcademicYearBatch","academicYearBatch"]
];
const SETTINGS_TABLE=()=>process.env.SYSTEM_SETTINGS_TABLE||"SystemSettings";
const BRANDING_CONTAINER=()=>process.env.BRANDING_BLOB_CONTAINER||"branding";
const conn=()=>process.env.STORAGE_CONNECTION_STRING;
const REQUIRED_ENV=["STORAGE_CONNECTION_STRING","ADMIN_EMAILS","GOOGLE_CLIENT_ID","ACS_EMAIL_CONNECTION_STRING","ACS_EMAIL_SENDER","PRACTICE_QUALIFIED_MINUTES","PRACTICE_TARGET_DAYS"];

function cleanEntity(entity={}){const out={};for(const [k,v] of Object.entries(entity)){if(k==="etag"||k==="timestamp")continue;if(v!==undefined)out[k]=v}if(!out.partitionKey&&out.PartitionKey)out.partitionKey=out.PartitionKey;if(!out.rowKey&&out.RowKey)out.rowKey=out.RowKey;delete out.PartitionKey;delete out.RowKey;return out}
function checksumFor(backup){const payload={schemaVersion:backup.schemaVersion,tables:backup.tables};if(backup.brandingAsset)payload.brandingAsset=backup.brandingAsset;return createHash("sha256").update(JSON.stringify(payload),"utf8").digest("hex")}
async function listClient(client){const items=[];for await(const e of client.listEntities())items.push(cleanEntity(e));return items}
async function settingsClient(){if(!conn())throw new Error("STORAGE_CONNECTION_STRING 未設定");const svc=TableServiceClient.fromConnectionString(conn());try{await svc.createTable(SETTINGS_TABLE())}catch(e){if(e.statusCode!==409)throw e}return TableClient.fromConnectionString(conn(),SETTINGS_TABLE())}
async function collectTables(){await ensureTables();const tables={};for(const [logical,key] of LOGICAL_TABLES)tables[logical]=await listClient(table(key));tables.SystemSettings=await listClient(await settingsClient());return tables}
function tableCounts(tables={}){const counts={};let total=0;for(const name of [...LOGICAL_TABLES.map(x=>x[0]),"SystemSettings"]){const n=Array.isArray(tables[name])?tables[name].length:0;counts[name]=n;total+=n}return {counts,total}}
async function brandingContainer(){if(!conn())throw new Error("STORAGE_CONNECTION_STRING 未設定");const svc=BlobServiceClient.fromConnectionString(conn());const c=svc.getContainerClient(BRANDING_CONTAINER());await c.createIfNotExists();return c}
async function readBrandingAsset(){
  try{
    const s=await settingsClient();let row;try{row=await s.getEntity("SYSTEM","BRANDING")}catch(e){if(e.statusCode===404)return null;throw e}
    const name=String(row.logoBlobName||"");if(!name)return null;
    const blob=(await brandingContainer()).getBlobClient(name);const r=await blob.download();const chunks=[];for await(const c of r.readableStreamBody)chunks.push(Buffer.from(c));const buf=Buffer.concat(chunks);
    return {blobName:name,contentType:r.contentType||String(row.logoContentType||"image/png"),dataBase64:buf.toString("base64")};
  }catch(e){if(e.statusCode===404)return null;throw e}
}
async function restoreBrandingAsset(asset,replace=false){
  const c=await brandingContainer();const target=c.getBlockBlobClient("school-logo");
  if(!asset){if(replace)try{await target.deleteIfExists({deleteSnapshots:"include"})}catch{};return false}
  const buf=Buffer.from(String(asset.dataBase64||""),"base64");if(!buf.length)return false;
  const type=String(asset.contentType||"image/png");await target.uploadData(buf,{blobHTTPHeaders:{blobContentType:type}});
  const s=await settingsClient();let row={partitionKey:"SYSTEM",rowKey:"BRANDING"};try{row={...row,...cleanEntity(await s.getEntity("SYSTEM","BRANDING"))}}catch(e){if(e.statusCode!==404)throw e}
  await s.upsertEntity({...row,partitionKey:"SYSTEM",rowKey:"BRANDING",logoBlobName:"school-logo",logoContentType:type,updatedAt:new Date().toISOString()},"Merge");return true;
}
function validateBackup(input){
  if(!input||typeof input!=="object")throw new Error("備份檔格式不正確");if(Number(input.schemaVersion)!==SCHEMA_VERSION)throw new Error(`不支援的備份格式版本：${input.schemaVersion??"空白"}`);if(!input.tables||typeof input.tables!=="object")throw new Error("備份檔缺少 tables");
  const allowed=new Set([...LOGICAL_TABLES.map(x=>x[0]),"SystemSettings"]);for(const name of allowed){if(!Array.isArray(input.tables[name]))throw new Error(`備份檔缺少資料表 ${name}`);for(let i=0;i<input.tables[name].length;i++){const e=cleanEntity(input.tables[name][i]);if(!String(e.partitionKey||"").trim()||!String(e.rowKey||"").trim())throw new Error(`${name} 第 ${i+1} 筆缺少 PartitionKey/RowKey`)}}
  if(input.brandingAsset){if(!String(input.brandingAsset.dataBase64||""))throw new Error("品牌 Logo 備份資料不完整");if(Buffer.byteLength(String(input.brandingAsset.dataBase64),"base64")>3*1024*1024)throw new Error("品牌 Logo 備份超過允許大小")}
  if(input.checksum&&String(input.checksum)!==checksumFor(input))throw new Error("備份檔檢查碼不一致，檔案可能已損毀或被修改");return tableCounts(input.tables);
}
async function clearClient(client){const rows=[];for await(const e of client.listEntities())rows.push([String(e.partitionKey),String(e.rowKey)]);for(const [pk,rk] of rows)await client.deleteEntity(pk,rk);return rows.length}
async function restoreClient(client,items=[]){let count=0;for(const raw of items){const e=cleanEntity(raw);await client.upsertEntity(e,"Replace");count++}return count}
async function clientsByLogical(){await ensureTables();const map={};for(const [logical,key] of LOGICAL_TABLES)map[logical]=table(key);map.SystemSettings=await settingsClient();return map}

app.http("systemBackup",{methods:["GET","POST"],authLevel:"anonymous",route:"system-backup",handler:async request=>{
  const access=await getAccess(request);if(!access.authenticated)return json({error:"Unauthorized"},401);if(access.role!=="admin")return json({error:"Forbidden"},403);
  if(request.method==="GET"){
    const tables=await collectTables(),stats=tableCounts(tables),brandingAsset=await readBrandingAsset();
    const backup={format:"SacredHeartOrchestraBackup",schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),exportedBy:access.email,app:"弦樂團管理系統",stats,environmentChecklist:REQUIRED_ENV.map(name=>({name,configured:Boolean(process.env[name])})),notes:["此檔不包含任何 Azure/Google/Email 連線字串、密碼或金鑰。","移轉到新環境時，請先重新建立環境變數，再登入管理員執行還原。","學號為學生唯一值；SemesterEnrollment 保存每學期正式上課名單。","自訂品牌 Logo 如已上傳，會一併封裝在此備份檔。"],tables};
    if(brandingAsset)backup.brandingAsset=brandingAsset;backup.checksum=checksumFor(backup);return json(backup);
  }
  let body;try{body=await request.json()}catch{return json({error:"JSON 格式不正確"},400)}
  const action=String(body?.action||"preview").trim().toLowerCase(),backup=body?.backup;let stats;try{stats=validateBackup(backup)}catch(e){return json({error:e.message||"備份驗證失敗"},400)}
  if(action==="preview")return json({ok:true,valid:true,schemaVersion:SCHEMA_VERSION,exportedAt:String(backup.exportedAt||""),stats,checksum:String(backup.checksum||""),brandingLogoIncluded:Boolean(backup.brandingAsset)});
  if(action!=="restore")return json({error:"action 必須為 preview 或 restore"},400);
  const mode=String(body?.mode||"merge").toLowerCase();if(!["merge","replace"].includes(mode))return json({error:"mode 必須為 merge 或 replace"},400);if(mode==="replace"&&String(body?.confirmText||"")!=="完整移轉")return json({error:"完整移轉還原需要輸入確認文字「完整移轉」"},400);if(mode==="merge"&&body?.confirmRestore!==true)return json({error:"合併還原需要 confirmRestore=true"},400);
  const clients=await clientsByLogical(),removed={},restored={};if(mode==="replace")for(const name of Object.keys(clients))removed[name]=await clearClient(clients[name]);for(const name of Object.keys(clients))restored[name]=await restoreClient(clients[name],backup.tables[name]);const brandingLogoRestored=await restoreBrandingAsset(backup.brandingAsset,mode==="replace");
  return json({ok:true,mode,restoredAt:new Date().toISOString(),stats,removed,restored,brandingLogoRestored,totalRestored:Object.values(restored).reduce((a,b)=>a+b,0)});
}});
