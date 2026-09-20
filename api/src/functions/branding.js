import { app } from "@azure/functions";
import { TableClient, TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { getAccess, json } from "../lib/auth.js";
import { defaultTenantId, tenantSchoolPartition, tenantIdValue, getTenantDirectory } from "../lib/storage.js";

const conn=()=>process.env.STORAGE_CONNECTION_STRING;
const settingsTable=()=>process.env.SYSTEM_SETTINGS_TABLE||"SystemSettings";
const containerName=()=>process.env.BRANDING_BLOB_CONTAINER||"branding";
const DEFAULT_LOGO_WEBP_BASE64="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";

const defaults=(schoolId=defaultTenantId(),tenant=null)=>{
  const sid=tenantIdValue(schoolId)||defaultTenantId();
  if(sid===defaultTenantId())return {siteName:"聖心小學弦樂團",schoolName:"輔大聖心國小",loginSubtitle:"家長、老師與管理員共用入口",logoAlt:"聖心 Logo",primaryColor:"#245C49",logoBlobName:"",logoContentType:"image/webp",updatedAt:"",updatedBy:""};
  const schoolName=String(tenant?.schoolName||sid),siteName=String(tenant?.systemName||schoolName+" 弦樂團");
  return {siteName,schoolName,loginSubtitle:"家長、老師與管理員共用入口",logoAlt:schoolName+" Logo",primaryColor:"#3155A4",logoBlobName:"",logoContentType:"image/svg+xml",updatedAt:"",updatedBy:""};
};
const genericLogo=(schoolName="學校")=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#3155A4"/><circle cx="128" cy="128" r="76" fill="#fff" opacity=".16"/><path d="M83 151c18-8 34-9 48-3V86l49-10v61c0 18-14 30-31 30-15 0-25-9-25-20 0-13 12-23 28-23 5 0 9 1 13 2V96l-34 7v61c0 18-14 30-31 30-15 0-25-9-25-20 0-10 7-19 18-23z" fill="#fff"/></svg>`,"utf8");

async function settingsClient(){
  if(!conn())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  const service=TableServiceClient.fromConnectionString(conn());
  try{await service.createTable(settingsTable())}catch(e){if(e.statusCode!==409)throw e}
  return TableClient.fromConnectionString(conn(),settingsTable());
}
async function getBranding(schoolId=defaultTenantId(),create=true){
  const sid=tenantIdValue(schoolId)||defaultTenantId(),tenant=await getTenantDirectory(sid),d=defaults(sid,tenant);
  const client=await settingsClient(),partition=tenantSchoolPartition(sid);
  try{
    const e=await client.getEntity(partition,"branding");
    return {...d,siteName:String(e.siteName||d.siteName),schoolName:String(e.schoolName||d.schoolName),loginSubtitle:String(e.loginSubtitle||d.loginSubtitle),logoAlt:String(e.logoAlt||d.logoAlt),primaryColor:String(e.primaryColor||d.primaryColor),logoBlobName:String(e.logoBlobName||""),logoContentType:String(e.logoContentType||d.logoContentType),updatedAt:String(e.updatedAt||""),updatedBy:String(e.updatedBy||"")};
  }catch(e){
    if(e.statusCode!==404)throw e;
    if(sid===defaultTenantId()){
      try{
        const legacy=await client.getEntity("SYSTEM","BRANDING");
        const migrated={partitionKey:partition,rowKey:"branding",schoolId:sid,siteName:String(legacy.siteName||d.siteName),schoolName:String(legacy.schoolName||d.schoolName),loginSubtitle:String(legacy.loginSubtitle||d.loginSubtitle),logoAlt:String(legacy.logoAlt||d.logoAlt),primaryColor:String(legacy.primaryColor||d.primaryColor),logoBlobName:String(legacy.logoBlobName||""),logoContentType:String(legacy.logoContentType||d.logoContentType),updatedAt:String(legacy.updatedAt||new Date().toISOString()),updatedBy:String(legacy.updatedBy||"legacy-migration")};
        if(create)await client.upsertEntity(migrated,"Merge");
        return {...d,...migrated};
      }catch(legacyError){if(legacyError.statusCode!==404)throw legacyError}
    }
    if(create)await client.upsertEntity({partitionKey:partition,rowKey:"branding",schoolId:sid,...d,createdAt:new Date().toISOString()},"Merge");
    return d;
  }
}
async function saveBranding(input,updatedBy,schoolId=defaultTenantId()){
  const sid=tenantIdValue(schoolId)||defaultTenantId(),current=await getBranding(sid,true),tenant=await getTenantDirectory(sid),d=defaults(sid,tenant);
  const siteName=String(input.siteName??current.siteName).trim().slice(0,80)||d.siteName;
  const schoolName=String(input.schoolName??current.schoolName).trim().slice(0,120)||d.schoolName;
  const loginSubtitle=String(input.loginSubtitle??current.loginSubtitle).trim().slice(0,160);
  const logoAlt=String(input.logoAlt??current.logoAlt).trim().slice(0,120)||"學校 Logo";
  let primaryColor=String(input.primaryColor??current.primaryColor).trim();
  if(!/^#[0-9A-Fa-f]{6}$/.test(primaryColor))primaryColor=current.primaryColor||d.primaryColor;
  const now=new Date().toISOString();
  const entity={partitionKey:tenantSchoolPartition(sid),rowKey:"branding",schoolId:sid,siteName,schoolName,loginSubtitle,logoAlt,primaryColor,logoBlobName:current.logoBlobName||"",logoContentType:current.logoContentType||d.logoContentType,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)};
  const client=await settingsClient();await client.upsertEntity(entity,"Merge");return entity;
}
async function blobContainer(){
  if(!conn())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  const service=BlobServiceClient.fromConnectionString(conn());
  const container=service.getContainerClient(containerName());
  await container.createIfNotExists();return container;
}
function tenantLogoBlobName(schoolId){const sid=tenantIdValue(schoolId)||defaultTenantId();return sid===defaultTenantId()?"school-logo":`schools/${sid}/school-logo`}
async function uploadLogo(dataUrl,updatedBy,schoolId=defaultTenantId()){
  const sid=tenantIdValue(schoolId)||defaultTenantId(),m=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl||""));
  if(!m)throw new Error("Logo 只支援 PNG、JPG、WebP");
  const buf=Buffer.from(m[2],"base64");
  if(!buf.length||buf.length>2*1024*1024)throw new Error("Logo 檔案需小於 2MB");
  const contentType=m[1],container=await blobContainer(),blobName=tenantLogoBlobName(sid),blob=container.getBlockBlobClient(blobName);
  await blob.uploadData(buf,{blobHTTPHeaders:{blobContentType:contentType}});
  const client=await settingsClient(),current=await getBranding(sid,true),now=new Date().toISOString();
  await client.upsertEntity({partitionKey:tenantSchoolPartition(sid),rowKey:"branding",schoolId:sid,...current,logoBlobName:blobName,logoContentType:contentType,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return {contentType,size:buf.length,updatedAt:now};
}
async function readLogo(schoolId=defaultTenantId()){
  const sid=tenantIdValue(schoolId)||defaultTenantId(),branding=await getBranding(sid,true);
  if(branding.logoBlobName){
    try{
      const container=await blobContainer(),blob=container.getBlobClient(branding.logoBlobName),response=await blob.download(),chunks=[];
      for await(const chunk of response.readableStreamBody)chunks.push(Buffer.from(chunk));
      return {buffer:Buffer.concat(chunks),contentType:response.contentType||branding.logoContentType||"image/png",updatedAt:branding.updatedAt||""};
    }catch(e){if(e.statusCode!==404)throw e}
  }
  if(sid===defaultTenantId())return {buffer:Buffer.from(DEFAULT_LOGO_WEBP_BASE64,"base64"),contentType:"image/webp",updatedAt:"default"};
  return {buffer:genericLogo(branding.schoolName),contentType:"image/svg+xml",updatedAt:"default"};
}
async function deleteLogo(updatedBy,schoolId=defaultTenantId()){
  const sid=tenantIdValue(schoolId)||defaultTenantId(),branding=await getBranding(sid,true);
  if(branding.logoBlobName){try{const container=await blobContainer();await container.deleteBlob(branding.logoBlobName,{deleteSnapshots:"include"})}catch(e){if(e.statusCode!==404)throw e}}
  const client=await settingsClient(),tenant=await getTenantDirectory(sid),d=defaults(sid,tenant),now=new Date().toISOString();
  await client.upsertEntity({partitionKey:tenantSchoolPartition(sid),rowKey:"branding",schoolId:sid,...branding,logoBlobName:"",logoContentType:d.logoContentType,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return {ok:true,updatedAt:now};
}
async function publicBrandingSchoolId(request){
  const fromQuery=tenantIdValue(request.query.get("schoolId"));
  if(fromQuery)return fromQuery;
  const access=await getAccess(request);
  return tenantIdValue(access?.schoolId)||defaultTenantId();
}
function publicView(b,schoolId=defaultTenantId()){const sid=tenantIdValue(schoolId)||defaultTenantId();return {schoolId:sid,siteName:b.siteName,schoolName:b.schoolName,loginSubtitle:b.loginSubtitle,logoAlt:b.logoAlt,primaryColor:b.primaryColor,logoUrl:`/api/branding-logo?schoolId=${encodeURIComponent(sid)}&v=${encodeURIComponent(b.updatedAt||"default")}`,updatedAt:b.updatedAt||""}}

app.http("branding",{methods:["GET","PATCH"],authLevel:"anonymous",route:"branding",handler:async request=>{
  if(request.method==="GET"){
    const schoolId=await publicBrandingSchoolId(request),tenant=await getTenantDirectory(schoolId);
    if(!tenant)return json({error:"找不到指定學校"},404);
    return json(publicView(await getBranding(schoolId,true),schoolId));
  }
  const access=await getAccess(request);if(!access.authenticated)return json({error:"Unauthorized"},401);if(access.role!=="admin"||!access.schoolId)return json({error:"Forbidden"},403);
  let body;try{body=await request.json()}catch{return json({error:"JSON 格式不正確"},400)}
  const schoolId=tenantIdValue(access.schoolId);
  return json(publicView(await saveBranding(body||{},access.email,schoolId),schoolId));
}});

app.http("brandingLogo",{methods:["GET","POST","DELETE"],authLevel:"anonymous",route:"branding-logo",handler:async request=>{
  if(request.method==="GET"){
    const schoolId=await publicBrandingSchoolId(request),tenant=await getTenantDirectory(schoolId);
    if(!tenant)return json({error:"找不到指定學校"},404);
    const x=await readLogo(schoolId);return {status:200,headers:{"Content-Type":x.contentType,"Cache-Control":"public, max-age=300"},body:x.buffer};
  }
  const access=await getAccess(request);if(!access.authenticated)return json({error:"Unauthorized"},401);if(access.role!=="admin"||!access.schoolId)return json({error:"Forbidden"},403);
  const schoolId=tenantIdValue(access.schoolId);
  if(request.method==="DELETE")return json(await deleteLogo(access.email,schoolId));
  let body;try{body=await request.json()}catch{return json({error:"JSON 格式不正確"},400)}
  try{return json({ok:true,...await uploadLogo(body?.dataUrl,access.email,schoolId),branding:publicView(await getBranding(schoolId,true),schoolId)})}catch(e){return json({error:e.message||"Logo 上傳失敗"},400)}
}});


const GLOBAL_DEFAULT_LOGO_SVG=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#3155A4"/><circle cx="128" cy="128" r="74" fill="none" stroke="#fff" stroke-width="12"/><path d="M54 128h148M128 54c26 24 40 49 40 74s-14 50-40 74M128 54c-26 24-40 49-40 74s14 50 40 74" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/></svg>`;
const globalDefaults=()=>({siteName:"校務整合平台",schoolName:"Global 管理中心",loginSubtitle:"跨校營運、權限與服務治理",logoAlt:"Global Logo",primaryColor:"#3155A4",logoBlobName:"",logoContentType:"image/svg+xml",updatedAt:"",updatedBy:""});
async function getGlobalBranding(create=true){
  const client=await settingsClient();
  try{
    const e=await client.getEntity("GLOBAL","BRANDING");
    const d=globalDefaults();
    return {...d,siteName:String(e.siteName||d.siteName),schoolName:String(e.schoolName||d.schoolName),loginSubtitle:String(e.loginSubtitle||d.loginSubtitle),logoAlt:String(e.logoAlt||d.logoAlt),primaryColor:String(e.primaryColor||d.primaryColor),logoBlobName:String(e.logoBlobName||""),logoContentType:String(e.logoContentType||d.logoContentType),updatedAt:String(e.updatedAt||""),updatedBy:String(e.updatedBy||"")};
  }catch(e){
    if(e.statusCode!==404)throw e;
    const d=globalDefaults();
    if(create)await client.upsertEntity({partitionKey:"GLOBAL",rowKey:"BRANDING",...d,createdAt:new Date().toISOString()},"Merge");
    return d;
  }
}
async function saveGlobalBranding(input,updatedBy){
  const current=await getGlobalBranding(true),d=globalDefaults();
  const siteName=String(input.siteName??current.siteName).trim().slice(0,80)||d.siteName;
  const schoolName=String(input.schoolName??current.schoolName).trim().slice(0,120)||d.schoolName;
  const loginSubtitle=String(input.loginSubtitle??current.loginSubtitle).trim().slice(0,160);
  const logoAlt=String(input.logoAlt??current.logoAlt).trim().slice(0,120)||d.logoAlt;
  let primaryColor=String(input.primaryColor??current.primaryColor).trim();
  if(!/^#[0-9A-Fa-f]{6}$/.test(primaryColor))primaryColor=current.primaryColor||d.primaryColor;
  const now=new Date().toISOString();
  const entity={partitionKey:"GLOBAL",rowKey:"BRANDING",siteName,schoolName,loginSubtitle,logoAlt,primaryColor,logoBlobName:current.logoBlobName||"",logoContentType:current.logoContentType||d.logoContentType,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)};
  const client=await settingsClient();await client.upsertEntity(entity,"Merge");return entity;
}
async function uploadGlobalLogo(dataUrl,updatedBy){
  const m=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl||""));
  if(!m)throw new Error("Logo 只支援 PNG、JPG、WebP");
  const buf=Buffer.from(m[2],"base64");
  if(!buf.length||buf.length>2*1024*1024)throw new Error("Logo 檔案需小於 2MB");
  const contentType=m[1],container=await blobContainer(),blob=container.getBlockBlobClient("global-logo");
  await blob.uploadData(buf,{blobHTTPHeaders:{blobContentType:contentType}});
  const client=await settingsClient(),current=await getGlobalBranding(true),now=new Date().toISOString();
  await client.upsertEntity({partitionKey:"GLOBAL",rowKey:"BRANDING",...current,logoBlobName:"global-logo",logoContentType:contentType,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return {contentType,size:buf.length,updatedAt:now};
}
async function readGlobalLogo(){
  const branding=await getGlobalBranding(true);
  if(branding.logoBlobName){
    try{
      const container=await blobContainer(),blob=container.getBlobClient(branding.logoBlobName),response=await blob.download(),chunks=[];
      for await(const chunk of response.readableStreamBody)chunks.push(Buffer.from(chunk));
      return {buffer:Buffer.concat(chunks),contentType:response.contentType||branding.logoContentType||"image/png",updatedAt:branding.updatedAt||""};
    }catch(e){if(e.statusCode!==404)throw e}
  }
  return {buffer:Buffer.from(GLOBAL_DEFAULT_LOGO_SVG,"utf8"),contentType:"image/svg+xml",updatedAt:"default"};
}
async function deleteGlobalLogo(updatedBy){
  const branding=await getGlobalBranding(true);
  if(branding.logoBlobName){try{const container=await blobContainer();await container.deleteBlob(branding.logoBlobName,{deleteSnapshots:"include"})}catch(e){if(e.statusCode!==404)throw e}}
  const client=await settingsClient(),now=new Date().toISOString(),d=globalDefaults();
  await client.upsertEntity({partitionKey:"GLOBAL",rowKey:"BRANDING",...branding,logoBlobName:"",logoContentType:d.logoContentType,updatedAt:now,updatedBy:String(updatedBy||"").slice(0,160)},"Merge");
  return {ok:true,updatedAt:now};
}
function globalPublicView(b){return {siteName:b.siteName,schoolName:b.schoolName,loginSubtitle:b.loginSubtitle,logoAlt:b.logoAlt,primaryColor:b.primaryColor,logoUrl:`/api/global-branding-logo?v=${encodeURIComponent(b.updatedAt||"default")}`,updatedAt:b.updatedAt||""}}
async function requireGlobalBrandingAdmin(request){
  const access=await getAccess(request);
  if(!access.authenticated)return {error:json({error:"Unauthorized"},401)};
  if(access.capabilities?.globalAdmin!==true)return {error:json({error:"Global Admin 權限不足"},403)};
  return {access};
}

app.http("globalBranding",{methods:["GET","PATCH"],authLevel:"anonymous",route:"global-branding",handler:async request=>{
  const g=await requireGlobalBrandingAdmin(request);if(g.error)return g.error;
  if(request.method==="GET")return json(globalPublicView(await getGlobalBranding(true)));
  let body;try{body=await request.json()}catch{return json({error:"JSON 格式不正確"},400)}
  return json(globalPublicView(await saveGlobalBranding(body||{},g.access.email)));
}});

app.http("globalBrandingLogo",{methods:["GET","POST","DELETE"],authLevel:"anonymous",route:"global-branding-logo",handler:async request=>{
  if(request.method==="GET"){
    const x=await readGlobalLogo();return {status:200,headers:{"Content-Type":x.contentType,"Cache-Control":"public, max-age=300"},body:x.buffer};
  }
  const g=await requireGlobalBrandingAdmin(request);if(g.error)return g.error;
  if(request.method==="DELETE")return json(await deleteGlobalLogo(g.access.email));
  let body;try{body=await request.json()}catch{return json({error:"JSON 格式不正確"},400)}
  try{return json({ok:true,...await uploadGlobalLogo(body?.dataUrl,g.access.email),branding:globalPublicView(await getGlobalBranding(true))})}catch(e){return json({error:e.message||"Global Logo 上傳失敗"},400)}
}});
