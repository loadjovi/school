import {createHash} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {EmailClient} from "@azure/communication-email";
import {tenantEmailAddress,tenantEmailConfig} from "./tenantEmailConfig.mjs";
import {getTenantLineParentContact,getTenantLineRecipient,getTenantLineDeliveryRecipient} from "./tenantLineAccounts.js";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {defaultTenantId} from "./storage.js";

const buildEnablesLineFirstLab = false;
const environment=()=>String(process.env.LAB_ENVIRONMENT||"").trim().toLowerCase();
const production=()=>["","production"].includes(environment());
export const notificationDeliveryEnabled=()=>production()||buildEnablesLineFirstLab&&environment()==="functional-uat";
// Retain the established exports while both environments use the same policy.
export const lineFirstLabEnabled=notificationDeliveryEnabled;
const schoolKey=schoolId=>typeof schoolId==="string"&&schoolId.length<=60&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(schoolId)?schoolId.replaceAll("-","_").toUpperCase():"";
export function notificationAppUrl(schoolId){
 const key=schoolKey(schoolId);if(!key||!notificationDeliveryEnabled())return "";
 let value;
 if(environment()==="functional-uat")value="https://icy-ocean-0a2602100-lineuat.eastasia.6.azurestaticapps.net/";
 else{
  const line=String(process.env[`LINE_${key}_APP_ORIGIN`]||"").trim();
  value=line||String(process.env[`ACS_EMAIL_${key}_APP_URL`]||"").trim();
  if(!value&&schoolId===defaultTenantId())value="https://lively-field-09afddc00.6.azurestaticapps.net/";
  if(!value)return "";
  try{if(line){const parsed=new URL(line);if(parsed.protocol!=="https:"||parsed.username||parsed.password)return "";value=parsed.origin+"/"}}catch{return ""}
 }
 try{
  const url=new URL(value);
  if(url.protocol!=="https:"||url.username||url.password||production()&&/(?:^|\.)icy-ocean-0a2602100(?:-lineuat)?\./i.test(url.hostname))return "";
  url.searchParams.set("schoolId",schoolId);return url.toString();
 }catch{return ""}
}
export const labNoticeUrl=notificationAppUrl;
const productionText=value=>production()?String(value||"").replace(/^【LAB｜/gm,"【").replace(/^【LAB】\s*\n?/gm,""):String(value||"");
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const keyFor=(eventId,recipient)=>hash([eventId,recipient]);
const deliveryRecipient=async(schoolId,recipient)=>String(recipient).endsWith("@line.invalid")?(await getTenantLineParentContact(schoolId,recipient)||recipient).toLowerCase():recipient;
const retryKey=value=>{const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
const accepted=result=>["accepted","sent","line_accepted"].includes(typeof result==="string"?result:result?.status);
const statusOf=result=>typeof result==="string"?result:result?.status||"failed";
const safeResult=row=>({status:row.status,channel:row.channel||"none",lineStatus:row.lineStatus||"",mailStatus:row.mailStatus||"",acceptedAt:row.acceptedAt||""});
async function get(db,school,id){try{return await db.getEntity(school,id)}catch(error){if(error.statusCode===404)return null;throw error}}
async function mail(schoolId,recipient,subject,text){
 const address=String(recipient).endsWith("@line.invalid")?tenantEmailAddress(await getTenantLineParentContact(schoolId,recipient)):tenantEmailAddress(recipient);
 if(!address)return {status:"no_recipient"};
 const config=tenantEmailConfig(schoolId,{fallback:true});
 const enabled=String(process.env[`ACS_EMAIL_${schoolKey(schoolId)}_ENABLED`]||"").trim();
 if(enabled&&enabled!=="true"||["disabled","unconfigured","lab_suppressed"].includes(config.mode)||!config.connectionString||!config.senderAddress)return {status:"not_configured"};
 try{
  await new EmailClient(config.connectionString).beginSend({senderAddress:config.senderAddress,recipients:{to:[{address}]},content:{subject:(production()?"":"【LAB】")+productionText(subject||"平台通知").slice(0,160),plainText:productionText(text)}});
  return {status:"accepted"};
 }catch(error){return {status:error.statusCode>=400&&error.statusCode<500?"failed":"unconfirmed"}}
}
async function one({schoolId,eventId,recipient,text,subject,lineSender,lineMessage,stillDue,mailAllowed}){
 const db=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantNotificationDelivery");
 await db.createTable().catch(error=>{if(error.statusCode!==409)throw error});
 const rowKey=keyFor(eventId,await deliveryRecipient(schoolId,recipient)),old=await get(db,schoolId,rowKey);
 if(old?.status==="accepted"||old?.status==="obsolete")return safeResult(old);
 if(["sending","unconfirmed"].includes(old?.status))return {...safeResult(old),status:"unconfirmed"};
 const row={partitionKey:schoolId,rowKey,status:"sending",channel:"none",createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
 try{if(old)await db.updateEntity(row,"Replace",{etag:old.etag});else await db.createEntity(row)}
 catch(error){if([409,412].includes(error.statusCode))return {status:"unconfirmed",channel:"none"};throw error}
 let result={status:"failed",channel:"none"},line;
 try{
  if(stillDue&&!await stillDue(recipient))result={status:"obsolete",channel:"none"};
  else{
   try{
    if(lineSender)line=await lineSender(recipient);
    else{
     const channel=await resolveTenantLineChannel(schoolId),configured=channel.configured===true||channel.loginConfigured===true;
     const usable=configured&&channel.botUserId&&(production()||channel.loginConfigured===true);
     const account=usable?(typeof getTenantLineDeliveryRecipient==="function"?await getTenantLineDeliveryRecipient(schoolId,recipient,channel):await getTenantLineRecipient(schoolId,recipient,channel.botUserId)):null;
     if(!usable)line={status:"not_configured"};
     else if(!account?.lineUserId)line={status:"not_bound"};
     else{await pushLineMessage(account.lineUserId,lineMessage||text,{accessToken:channel.accessToken,retryKey:retryKey([schoolId,eventId,account.lineUserId])});line={status:"accepted"}}
    }
   }catch{line={status:"failed"}}
   if(accepted(line))result={status:"accepted",channel:"line",lineStatus:statusOf(line),mailStatus:"skipped_line_accepted"};
   else if(statusOf(line)==="ineligible"||stillDue&&!await stillDue(recipient))result={status:"obsolete",channel:"none",lineStatus:statusOf(line)};
   else if(mailAllowed===false)result={status:"disabled",channel:"none",lineStatus:statusOf(line),mailStatus:"disabled"};
   else{
    const fallback=await mail(schoolId,recipient,subject,text);
    result={status:accepted(fallback)?"accepted":fallback.status==="unconfirmed"?"unconfirmed":"failed",channel:"email",lineStatus:statusOf(line),mailStatus:statusOf(fallback)};
   }
  }
  if(result.status==="accepted")result.acceptedAt=new Date().toISOString();
  await db.updateEntity({partitionKey:schoolId,rowKey,...result,updatedAt:new Date().toISOString()},"Merge");
  return result;
 }catch{return {status:"unconfirmed",channel:result.channel||"none",lineStatus:statusOf(line)}}
}
export async function deliverLabNotice({schoolId,eventId,recipients=[],text,subject="平台通知",lineSender,lineMessage,stillDue,mailAllowed=true}){
 if(!lineFirstLabEnabled())return {status:"disabled",recipientCount:0,results:[]};
 if(!notificationAppUrl(schoolId))return {status:"not_configured",recipientCount:0,results:[]};
 text=productionText(text);subject=productionText(subject);
 const unique=[...new Set(recipients.map(x=>String(x||"").trim().toLowerCase()).filter(Boolean))],identities=new Map();
 for(const recipient of unique){const canonical=await deliveryRecipient(schoolId,recipient);if(!identities.has(canonical))identities.set(canonical,recipient)}
 const addresses=[...identities.values()];
 const id=eventId||hash([subject,text]),results=[];
 for(let i=0;i<addresses.length;i+=8){
  const batch=await Promise.allSettled(addresses.slice(i,i+8).map(recipient=>one({schoolId,eventId:id,recipient,text,subject,lineSender,lineMessage,stillDue,mailAllowed})));
  results.push(...batch.map((r,index)=>({recipient:addresses[i+index],...(r.status==="fulfilled"?r.value:{status:"failed",channel:"none"})})));
 }
 const lineAcceptedCount=results.filter(r=>r.status==="accepted"&&r.channel==="line").length,mailAcceptedCount=results.filter(r=>r.status==="accepted"&&r.channel==="email").length;
 const acceptedCount=lineAcceptedCount+mailAcceptedCount,failedCount=results.filter(r=>r.status==="failed").length;
 return {status:!results.length?"no_recipients":acceptedCount===results.length?"sent":acceptedCount?"partial":results.some(r=>r.status==="unconfirmed")?"unconfirmed":results.every(r=>r.status==="obsolete")?"obsolete":results.every(r=>r.status==="disabled")?"disabled":"failed",
  channel:lineAcceptedCount&&mailAcceptedCount?"mixed":lineAcceptedCount?"line":mailAcceptedCount?"email":"none",recipientCount:results.length,acceptedCount,sentCount:0,lineAcceptedCount,mailAcceptedCount,failedCount,
  lineStatus:lineAcceptedCount===results.length&&results.length?"accepted":lineAcceptedCount?"partial":results[0]?.lineStatus||"not_bound",results};
}
export function labNoticeLineResult(result){return {status:result.status==="sent"?(result.channel==="email"?"email_sent":result.channel==="mixed"?"mixed_sent":"accepted"):result.results?.some(r=>r.mailStatus==="not_configured")?"email_not_configured":result.results?.some(r=>r.mailStatus==="no_recipient")?"email_missing":result.status,channel:result.channel,lineAcceptedCount:result.lineAcceptedCount||0,mailAcceptedCount:result.mailAcceptedCount||0,acceptedAt:result.results?.find(r=>r.acceptedAt)?.acceptedAt}}
export async function labNoticeStates(schoolId,entries){
 if(!lineFirstLabEnabled()||!notificationAppUrl(schoolId))return {};
 const db=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantNotificationDelivery"),out={};
 await Promise.all(entries.map(async({id,eventId,recipient})=>{try{const row=await get(db,schoolId,keyFor(eventId,await deliveryRecipient(schoolId,String(recipient||"").trim().toLowerCase())));if(row)out[id]=safeResult(row)}catch{}}));return out;
}
