import {TableClient} from "@azure/data-tables";
import {createHash,randomUUID} from "node:crypto";
import {listStudentMaster,listUserStudentMappings,getTenantDirectory} from "./storage.js";
import {getStudentAliasInfo} from "./auth.js";
import {emailConfigured,sendPaymentRequiredEmail} from "./email.js";
import {paymentNoticeCandidates,paymentNoticeKey,noticeInScope,deliverPaymentNotices,uniformNeedsPayment,familyPaymentInfo,reminderNotices} from "./paymentNoticeRules.mjs";

const safe=value=>String(value).replaceAll("'","''");
const decode=row=>({...JSON.parse(row.payload||"{}"),id:row.rowKey});
const client=name=>TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);
const get=async(db,school,id)=>{try{return await db.getEntity(school,id)}catch(e){if(e.statusCode===404)return null;throw e}};
async function rows(name,schoolId){
  const result=[];try{for await(const row of client(name).listEntities({queryOptions:{filter:`PartitionKey eq '${safe(schoolId)}'`}}))result.push(row)}catch(e){if(e.statusCode!==404)throw e}return result;
}
const familyId=notice=>"family:yearEndDinner:"+notice.activityId+":"+createHash("sha256").update(notice.recipient).digest("hex").slice(0,32);
export function paymentPlatformUrl(){
  if(process.env.LAB_ENVIRONMENT==="functional-uat")return "https://icy-ocean-0a2602100.6.azurestaticapps.net/";
  for(const raw of [process.env.APP_PUBLIC_URL,process.env.SWA_PUBLIC_URL]){
    try{const url=new URL(raw);if(url.protocol==="https:"&&!url.username&&!url.password)return url.origin+"/"}catch{}
  }
  return "https://lively-field-09afddc00.6.azurestaticapps.net/";
}
export async function processPaymentNotifications(schoolId,{scope={kind:"all"},preview=false,retryFailed=false}={}){
  const configsName=process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig";
  const [uniformRows,familyRows,configRows,students,mappings]=await Promise.all([
    rows("TenantUniformEventRequest",schoolId),rows("TenantFamilyEventRegistration",schoolId),rows(configsName,schoolId),listStudentMaster("",schoolId),listUserStudentMappings("active",schoolId)
  ]);
  const canonicalById={};
  for(const id of new Set(mappings.map(x=>String(x.studentId)))){
    const alias=await getStudentAliasInfo(id,schoolId);canonicalById[id]=String(alias.canonicalStudentId||id);
  }
  const configs=configRows.map(row=>({...decode(row),id:row.rowKey.split(":").slice(1).join(":" )}));
  let notices=paymentNoticeCandidates({uniforms:uniformRows.map(decode),families:familyRows.map(decode),configs,students,mappings,canonicalById}).filter(item=>noticeInScope(item,scope));
  if(scope.reminder===true){if(scope.kind!=="uniform")throw Error("Invalid reminder scope");notices=reminderNotices(notices)}
  const ledger=client("TenantPaymentNotification"),audit=client("TenantUniformEventAudit");
  const disabled=process.env.LAB_ENVIRONMENT==="functional-uat",configured=emailConfigured();
  const ownedRows=await rows("TenantPaymentNotification",schoolId),stateMap=new Map(ownedRows.map(row=>[row.rowKey,row]));
  const repository={states:async()=>stateMap,
    async claim(key,notice,old){
      await ledger.createTable().catch(e=>{if(e.statusCode!==409)throw e});
      const row={partitionKey:schoolId,rowKey:key,schoolId,status:"SENDING",recipient:notice.recipient,category:notice.category,sourceId:notice.sourceId,version:notice.version,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
      try{if(old)await ledger.updateEntity(row,"Replace",{etag:old.etag});else await ledger.createEntity(row);return true}catch(e){if([409,412].includes(e.statusCode))return false;throw e}
    },
    async finish(key,status,detail={}){const old=await ledger.getEntity(schoolId,key);await ledger.updateEntity({partitionKey:schoolId,rowKey:key,status,updatedAt:new Date().toISOString(),detail:JSON.stringify(detail)},"Merge",{etag:old.etag})},
    async audit(action,notice,key){await audit.createTable().catch(e=>{if(e.statusCode!==409)throw e});await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action,subjectId:notice.sourceId,actor:"payment_notification",at:new Date().toISOString(),details:JSON.stringify({notificationId:key,recipient:notice.recipient,category:notice.category})})},
    async stillDue(notice){
      if(notice.category==="uniform"){const row=await get(client("TenantUniformEventRequest"),schoolId,notice.sourceId);const item=row&&decode(row);return !!item&&uniformNeedsPayment(item)&&item.amount===notice.amount}
      const configRow=await get(client(configsName),schoolId,notice.kind+":"+notice.activityId),config=configRow&&decode(configRow);
      if(notice.category==="family"){
        const row=await get(client("TenantFamilyEventRegistration"),schoolId,notice.sourceId),item=row&&decode(row),info=item&&familyPaymentInfo(config,item);
        return !!info?.needsPayment&&info.amount===notice.amount;
      }
      const existing=await get(client("TenantFamilyEventRegistration"),schoolId,familyId(notice));
      const rebuilt=paymentNoticeCandidates({configs:config?[{...config,id:notice.activityId}]:[],students,mappings,canonicalById,families:existing?[decode(existing)]:[]});
      return rebuilt.some(item=>paymentNoticeKey(item)===paymentNoticeKey(notice));
    }
  };
  const school=await getTenantDirectory(schoolId);
  const result=await deliverPaymentNotices({notices,repository,configured,disabled,preview,retryFailed,
    send:notice=>sendPaymentRequiredEmail({...notice,schoolName:school?.systemName||school?.schoolName||"弦樂團",appUrl:paymentPlatformUrl()})});
  const sourceNotices=new Set(notices.map(item=>item.category+":"+item.sourceId));
  const missingUniform=uniformRows.map(decode).filter(item=>uniformNeedsPayment(item)&&noticeInScope({category:"uniform",sourceId:item.id},scope)&&!sourceNotices.has("uniform:"+item.id)).length;
  const missingFamily=familyRows.map(decode).filter(item=>familyPaymentInfo(configs.find(c=>c.module===item.kind&&c.id===item.activityId),item).needsPayment&&noticeInScope({category:"family",sourceId:item.id,kind:item.kind,activityId:item.activityId},scope)&&!sourceNotices.has("family:"+item.id)).length;
  const missingRecipients=missingUniform+missingFamily;
  return {...result,status:missingRecipients&&["complete","not_required","preview"].includes(result.status)?"partial":result.status,missingRecipients,configured:configured&&!disabled,scope};
}
export async function safePaymentNotifications(schoolId,options){
  try{return await processPaymentNotifications(schoolId,options)}catch(error){console.error("payment notifications failed",{schoolId,error:error.message});return {status:"failed",sent:0,remaining:0,failed:1,error:"寄送程序未完成，請查看通知紀錄後重試"}}
}
export function paymentNotificationStatus(result){
  if(!result)return "not_attempted";
  if(result.status==="complete"&&!result.remaining&&!result.failed&&!result.unconfirmed&&(result.sent||result.alreadySent))return "sent";
  return result.status;
}
