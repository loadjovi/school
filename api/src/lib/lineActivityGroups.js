import {TableClient} from "@azure/data-tables";
import {createHash,randomBytes} from "node:crypto";
import {tenantSchoolPartition} from "./storage.js";
import {getLineNotificationTarget} from "./settings.js";
import {resolveTenantLineChannel,lineTargetMatchesChannel} from "./lineTenantConfig.js";

const clients=new Map();
const activityKey=/^(fieldTrip|yearEndDinner|calendarActivity):[A-Za-z0-9_-]{1,80}$/;
const schoolGroupNames=Object.freeze({"school:teachers":"學校群組","school:cadres":"幹部群組","school:finance":"財務幹部群組"});
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
export function schoolLineGroupTarget(key){
  if(!Object.hasOwn(schoolGroupNames,key||""))throw fail("請選擇學校老師、學校幹部或財務幹部群組");
  return {key,title:schoolGroupNames[key],scope:"school"};
}
async function requireGroupTarget(schoolId,key){return Object.hasOwn(schoolGroupNames,key||"")?schoolLineGroupTarget(key):requireLineActivity(schoolId,key)}
export async function getActivityLineGroup(schoolId,botUserId,key){
  const row=await read(await center(),tenantSchoolPartition(schoolId),"group:"+key);
  if(row?.botUserId===botUserId)return row.groupId?row:null;
  const purpose=key==="school:cadres"?"admin":key==="school:teachers"?"absence":"";
  if(!purpose)return null;
  const target=await getLineNotificationTarget(schoolId,purpose);
  if(target?.targetType!=="group"||!/^C[a-f0-9]{32}$/i.test(target.targetId||""))return null;
  if(target.botUserId!==botUserId){
    if(target.botUserId||!/^U[a-f0-9]{32}$/i.test(botUserId||""))return null;
    const channel=await resolveTenantLineChannel(schoolId);
    if(!channel.configured||channel.schoolId!==tenantSchoolPartition(schoolId)||channel.botUserId!==botUserId||!lineTargetMatchesChannel(target,channel))return null;
  }
  return {groupId:target.targetId,groupName:target.targetLabel||schoolGroupNames[key],botUserId,source:"settings",sourceLabel:purpose==="admin"?"平台後台待辦群組":"平台學生缺席通知群組"};
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
export async function listSchoolLineGroups(schoolId,botUserId){
  return Promise.all(Object.keys(schoolGroupNames).map(async key=>{const group=await getActivityLineGroup(schoolId,botUserId,key);return {...schoolLineGroupTarget(key),bound:!!group,groupName:group?.groupName||"",boundAt:group?.boundAt||"",source:group?.source||"center",sourceLabel:group?.sourceLabel||"通知中心群組"}}));
}
const hashCode=(code,secret)=>createHash("sha256").update(secret+":"+code.toUpperCase()).digest("hex");
export function parseActivityLineBinding(text){
  return String(text||"").trim().match(/^#?綁定(?:活動|學校)通知[\s　:：-]*([A-Fa-f0-9]{16})$/u)?.[1]?.toUpperCase()||"";
}
export async function createActivityLineBinding(channel,key,actor){
  const selected=await requireGroupTarget(channel.schoolId,key),client=await center(),partitionKey=tenantSchoolPartition(channel.schoolId);
  const rowKey="group:"+key,old=await read(client,partitionKey,rowKey),sameBot=old?.botUserId===channel.botUserId;
  const bound=sameBot?old:await getActivityLineGroup(channel.schoolId,channel.botUserId,key);
  const code=randomBytes(8).toString("hex").toUpperCase(),codeHash=hashCode(code,channel.channelSecret);
  const expiresAt=new Date(Date.now()+15*60000).toISOString();
  const group={partitionKey,rowKey,botUserId:channel.botUserId,activityKey:key,
    groupId:bound?.groupId||"",groupName:bound?.groupName||"",boundAt:bound?.boundAt||"",source:bound?.source||"",sourceLabel:bound?.sourceLabel||"",
    pendingCodeHash:codeHash,requestedBy:actor,updatedAt:new Date().toISOString()};
  await client.submitTransaction([
    old?["update",group,"Replace",{etag:old.etag}]:["create",group],
    ["create",{partitionKey,rowKey:"code:"+codeHash,activityKey:key,botUserId:channel.botUserId,expiresAt,consumedAt:""}]
  ]);
  return {code,expiresAt,activityTitle:selected.title,groupTitle:selected.title,scope:selected.scope||"activity"};
}
export async function consumeActivityLineBinding(channel,code,groupId,groupName){
  if(!/^[A-Fa-f0-9]{16}$/.test(code||"")||!/^C[a-f0-9]{32}$/i.test(groupId||""))return null;
  const partitionKey=tenantSchoolPartition(channel.schoolId),client=await center(),hash=hashCode(code,channel.channelSecret);
  const request=await read(client,partitionKey,"code:"+hash);
  if(!request||request.botUserId!==channel.botUserId||request.consumedAt||!(Date.parse(request.expiresAt)>Date.now()))return null;
  const old=await read(client,partitionKey,"group:"+request.activityKey);
  if(!old||old.botUserId!==channel.botUserId||old.pendingCodeHash!==hash)return null;
  let selected;try{selected=await requireGroupTarget(channel.schoolId,request.activityKey)}catch(error){if(error.status===409)return null;throw error}
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
  await requireGroupTarget(schoolId,key);
  if((await getActivityLineGroup(schoolId,botUserId,key))?.source==="settings")throw fail("此群組沿用平台原有綁定，請在 LINE 通知中心的「群組與通知設定」變更；原通知用途維持不變");
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
    deliveryMode:entry.deliveryMode||"multicast",groupAccepted:Number(entry.groupAccepted)||0,groupFailed:Number(entry.groupFailed)||0,recipientResults:JSON.stringify(results),omittedRecipients:Math.max(0,(entry.recipientResults?.length||0)-results.length),
    actor:entry.actor,updatedAt:new Date().toISOString()},"Replace");
}
function announcementRecipientResults(values){
  const results=[];let length=2;
  for(const value of Array.isArray(values)?values:[]){
    if(!/^[a-f0-9]{12}$/.test(value?.reference||"")||!["accepted","email_accepted","failed"].includes(value.status))continue;
    const result={reference:value.reference,name:String(value.name||"LINE 帳號").slice(0,80),status:value.status,...(value.kind==="group"?{kind:"group"}:{}),...(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<600?{httpStatus:value.httpStatus}:{})};
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
    items.push({audience:row.audience,label:row.label,text:row.text,accepted:row.accepted,emailAccepted:Number(row.emailAccepted)||0,failed:row.failed,groupAccepted:Number(row.groupAccepted)||0,groupFailed:Number(row.groupFailed)||0,actor:row.actor,updatedAt:row.updatedAt,deliveryMode:["group","mixed","push"].includes(row.deliveryMode)?row.deliveryMode:row.audience==="activityGroup"?"group":"multicast",recipientResults:results,omittedRecipients:Number(row.omittedRecipients)||0,deliveryConfirmed:false});
  }
  return items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,20);
}
