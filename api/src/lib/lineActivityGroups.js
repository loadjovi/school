import {TableClient} from "@azure/data-tables";
import {createHash,randomBytes} from "node:crypto";
import {tenantSchoolPartition} from "./storage.js";

const clients=new Map();
const activityKey=/^(fieldTrip|yearEndDinner|calendarActivity):[A-Za-z0-9_-]{1,80}$/;
const fail=message=>Object.assign(new Error(message),{status:409});
const safe=value=>String(value).replaceAll("'","''");
async function db(name){
  if(!clients.has(name)){
    const client=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);
    await client.createTable().catch(error=>{if(error.statusCode!==409)throw error});
    clients.set(name,client);
  }
  return clients.get(name);
}
const center=()=>db("TenantLineNotificationCenter");
const configs=()=>db(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
async function read(client,partitionKey,rowKey){
  try{return await client.getEntity(partitionKey,rowKey)}catch(error){if(error.statusCode===404)return null;throw error}
}
function activity(row){
  if(!row||!activityKey.test(row.rowKey))return null;
  let value;try{value=JSON.parse(row.payload||"{}")}catch{return null}
  if(value.enabled!==true)return null;
  return {key:row.rowKey,title:String(value.title||"活動"),date:String(value.eventDate||value.startAt||"")};
}
export async function requireLineActivity(schoolId,key){
  if(!activityKey.test(key||""))throw fail("請選擇此校活動");
  const value=activity(await read(await configs(),tenantSchoolPartition(schoolId),key));
  if(!value)throw fail("此活動已關閉或不屬於目前學校，請重新選擇");
  return value;
}
export async function getActivityLineGroup(schoolId,botUserId,key){
  const row=await read(await center(),tenantSchoolPartition(schoolId),"group:"+key);
  return row?.botUserId===botUserId&&row.groupId?row:null;
}
export async function listActivityLineGroups(schoolId,botUserId){
  const partition=tenantSchoolPartition(schoolId),items=[];
  for await(const row of (await configs()).listEntities({queryOptions:{filter:`PartitionKey eq '${safe(partition)}'`}})){
    const value=activity(row);if(!value)continue;
    const group=await getActivityLineGroup(schoolId,botUserId,value.key);
    items.push({...value,bound:!!group,groupName:group?.groupName||"",boundAt:group?.boundAt||""});
  }
  return items.sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title,"zh-Hant"));
}
const hashCode=(code,secret)=>createHash("sha256").update(secret+":"+code.toUpperCase()).digest("hex");
export function parseActivityLineBinding(text){
  return String(text||"").trim().match(/^#?綁定活動通知[\s　:：-]*([A-Fa-f0-9]{16})$/u)?.[1]?.toUpperCase()||"";
}
export async function createActivityLineBinding(channel,key,actor){
  const selected=await requireLineActivity(channel.schoolId,key),client=await center(),partitionKey=tenantSchoolPartition(channel.schoolId);
  const rowKey="group:"+key,old=await read(client,partitionKey,rowKey),sameBot=old?.botUserId===channel.botUserId;
  const code=randomBytes(8).toString("hex").toUpperCase(),codeHash=hashCode(code,channel.channelSecret);
  const expiresAt=new Date(Date.now()+15*60000).toISOString();
  const group={partitionKey,rowKey,botUserId:channel.botUserId,activityKey:key,
    groupId:sameBot?old.groupId||"":"",groupName:sameBot?old.groupName||"":"",boundAt:sameBot?old.boundAt||"":"",
    pendingCodeHash:codeHash,requestedBy:actor,updatedAt:new Date().toISOString()};
  await client.submitTransaction([
    old?["update",group,"Replace",{etag:old.etag}]:["create",group],
    ["create",{partitionKey,rowKey:"code:"+codeHash,activityKey:key,botUserId:channel.botUserId,expiresAt,consumedAt:""}]
  ]);
  return {code,expiresAt,activityTitle:selected.title};
}
export async function consumeActivityLineBinding(channel,code,groupId,groupName){
  if(!/^[A-Fa-f0-9]{16}$/.test(code||"")||!/^C[a-f0-9]{32}$/i.test(groupId||""))return null;
  const partitionKey=tenantSchoolPartition(channel.schoolId),client=await center(),hash=hashCode(code,channel.channelSecret);
  const request=await read(client,partitionKey,"code:"+hash);
  if(!request||request.botUserId!==channel.botUserId||request.consumedAt||!(Date.parse(request.expiresAt)>Date.now()))return null;
  const old=await read(client,partitionKey,"group:"+request.activityKey);
  if(!old||old.botUserId!==channel.botUserId||old.pendingCodeHash!==hash)return null;
  let selected;try{selected=await requireLineActivity(channel.schoolId,request.activityKey)}catch(error){if(error.status===409)return null;throw error}
  const now=new Date().toISOString();
  const group={partitionKey,rowKey:old.rowKey,activityKey:request.activityKey,botUserId:channel.botUserId,
    groupId,groupName:String(groupName||"活動志工群組").slice(0,120),boundAt:now,updatedAt:now,pendingCodeHash:"",requestedBy:old.requestedBy||""};
  try{
    await client.submitTransaction([["update",group,"Replace",{etag:old.etag}],
      ["update",{partitionKey,rowKey:request.rowKey,consumedAt:now},"Merge",{etag:request.etag}]]);
  }catch(error){if([404,409,412].includes(error.statusCode))return null;throw error}
  return {...selected,groupName:group.groupName};
}
export async function clearActivityLineGroup(schoolId,botUserId,key){
  await requireLineActivity(schoolId,key);
  const client=await center(),partitionKey=tenantSchoolPartition(schoolId),old=await read(client,partitionKey,"group:"+key);
  if(!old||old.botUserId!==botUserId)return;
  await client.updateEntity({partitionKey,rowKey:old.rowKey,groupId:"",groupName:"",boundAt:"",pendingCodeHash:"",updatedAt:new Date().toISOString()},"Merge",{etag:old.etag});
}
export async function leaveActivityLineGroup(channel,groupId){
  const client=await center(),partitionKey=tenantSchoolPartition(channel.schoolId);
  for await(const row of client.listEntities({queryOptions:{filter:`PartitionKey eq '${safe(partitionKey)}' and RowKey ge 'group:' and RowKey lt 'group;'`}})){
    if(row.botUserId!==channel.botUserId||row.groupId!==groupId)continue;
    try{await client.updateEntity({partitionKey,rowKey:row.rowKey,groupId:"",groupName:"",boundAt:"",pendingCodeHash:"",updatedAt:new Date().toISOString()},"Merge",{etag:row.etag})}
    catch(error){if(![404,412].includes(error.statusCode))throw error}
  }
}
export async function recordLineAnnouncement(schoolId,entry){
  const results=announcementRecipientResults(entry.recipientResults);
  await (await center()).upsertEntity({partitionKey:tenantSchoolPartition(schoolId),rowKey:"sent:"+entry.requestId,
    audience:entry.audience,label:entry.label,text:entry.text,accepted:entry.accepted,emailAccepted:Number(entry.emailAccepted)||0,failed:entry.failed,
    deliveryMode:entry.deliveryMode||"multicast",recipientResults:JSON.stringify(results),omittedRecipients:Math.max(0,(entry.recipientResults?.length||0)-results.length),
    actor:entry.actor,updatedAt:new Date().toISOString()},"Replace");
}
function announcementRecipientResults(values){
  const results=[];let length=2;
  for(const value of Array.isArray(values)?values:[]){
    if(!/^[a-f0-9]{12}$/.test(value?.reference||"")||!["accepted","email_accepted","failed"].includes(value.status))continue;
    const result={reference:value.reference,name:String(value.name||"LINE 帳號").slice(0,80),status:value.status,...(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<600?{httpStatus:value.httpStatus}:{})};
    const size=JSON.stringify(result).length+(results.length?1:0);
    if(results.length>=100||length+size>30000)break;
    results.push(result);length+=size;
  }
  return results;
}
export async function lineAnnouncementHistory(schoolId){
  const partitionKey=tenantSchoolPartition(schoolId),items=[];
  for await(const row of (await center()).listEntities({queryOptions:{filter:`PartitionKey eq '${safe(partitionKey)}' and RowKey ge 'sent:' and RowKey lt 'sent;'`}})){
    let results=[];try{results=announcementRecipientResults(JSON.parse(row.recipientResults||"[]"))}catch{}
    items.push({audience:row.audience,label:row.label,text:row.text,accepted:row.accepted,emailAccepted:Number(row.emailAccepted)||0,failed:row.failed,actor:row.actor,updatedAt:row.updatedAt,deliveryMode:row.audience==="activityGroup"?"group":row.deliveryMode==="push"?"push":"multicast",recipientResults:results,omittedRecipients:Number(row.omittedRecipients)||0,deliveryConfirmed:false});
  }
  return items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,20);
}
