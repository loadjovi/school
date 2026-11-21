import {TableClient} from "@azure/data-tables";
import {lineHash} from "./tenantLineAccounts.js";
import {workflowLineEnabled} from "./lineAdminTodoNotification.mjs";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {sendTenantFeeLine} from "./tenantLineFeeNotice.js";
import {uniformNeedsPayment} from "./paymentNoticeRules.mjs";
import {lineFirstLabEnabled,deliverLabNotice,labNoticeLineResult,labNoticeUrl,labNoticeStates} from "./labNoticeDelivery.mjs";

export const uniformPaymentLineEligible = item => ["regularUniform","competitionUniform"].includes(item?.kind) && uniformNeedsPayment(item);
export const uniformPaymentLineId = item => `uniform:${item.id}:payment-required:${item.amount}`;

export async function notifyUniformPaymentRequired(schoolId,item){
 if(typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled()&&uniformPaymentLineEligible(item)){
  const text=["團服繳款通知",item.kind==="regularUniform"?"團 T":"A 團比賽服",`尺寸：${item.size}｜${item.quantity||1} 件`,`應繳金額：NT$ ${item.amount.toLocaleString("zh-TW")}`,"申請已核准。請至平台查看收款帳戶，匯款後回報日期與帳號末五碼。",labNoticeUrl(schoolId)].join("\n");
  return labNoticeLineResult(await deliverLabNotice({schoolId,eventId:uniformPaymentLineId(item),recipients:[item.parentEmail||item.requesterEmail],subject:"團服申請已核准｜待繳款",text,lineSender:()=>notifyUniformPaymentRequiredLine(schoolId,item)}));
 }
 return notifyUniformPaymentRequiredLine(schoolId,item);
}
export async function notifyUniformPaymentRequiredLine(schoolId,item){
 if(!uniformPaymentLineEligible(item))return {status:"ineligible"};
 if(!workflowLineEnabled())return {status:"disabled"};
 const parentEmail=item.parentEmail||item.requesterEmail;
 if(!parentEmail)return {status:"applicant_unknown"};
 try{
  const channel=await resolveTenantLineChannel(schoolId);
  if(!channel.loginConfigured||!channel.botUserId||!channel.paymentRequestLineEnabled)return {status:"disabled"};
  const url=new URL("/",channel.appOrigin);url.searchParams.set("schoolId",schoolId);
  const label=item.kind==="regularUniform"?"團 T":"A 團比賽服",quantity=item.kind==="regularUniform"?item.quantity:1;
  const text=[process.env.LAB_ENVIRONMENT==="functional-uat"?"【LAB｜團服繳款通知】":"【團服繳款通知】",
   `您的 ${label} 申請已核准，請完成繳款。`,
   `尺寸：${item.style?item.style+"款 ":""}${item.size}｜${quantity} 件`,
   `應繳金額：NT$ ${item.amount.toLocaleString("zh-TW")}`,
   "登入平台後，點「待繳費」查看收款帳戶。匯款後，請回報匯款日期與帳號末五碼。",url.toString()].join("\n");
  const stillDue=async()=>{
   const db=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantUniformEventRequest");
   let row;try{row=await db.getEntity(schoolId,item.id)}catch(error){if(error.statusCode===404)return false;throw error}
   const current=JSON.parse(row.payload||"{}");
   return uniformPaymentLineEligible(current)&&current.kind===item.kind&&current.amount===item.amount&&(current.parentEmail||current.requesterEmail)===parentEmail;
  };
  return await sendTenantFeeLine(schoolId,{id:uniformPaymentLineId(item),at:new Date().toISOString(),parentEmail,text,paymentRequest:true,stillDue});
 }catch(error){console.warn("Uniform payment LINE notification pending",{schoolId,status:error?.status||error?.statusCode});return {status:"pending"}}
}

// Reading notification history never sends a message or changes a request.
export async function uniformPaymentLineStates(schoolId,items){
 const eligible=items.filter(uniformPaymentLineEligible),states={},keys=new Map();
 for(const item of eligible){states[item.id]={status:"not_sent",retryAllowed:true};keys.set(lineHash(uniformPaymentLineId(item)),item.id)}
 if(!keys.size)return states;
 try{
  const db=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantLineFeeNotice");
  for await(const row of db.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
   const id=keys.get(row.rowKey);if(!id)continue;
   const age=Date.now()-Date.parse(row.createdAt),expired=row.status!=="accepted"&&!(age>=0&&age<23*60*60*1000);
   states[id]={status:row.status==="accepted"?"accepted":expired?"unconfirmed":"pending",retryAllowed:row.status!=="accepted"&&!expired,
    ...(row.attemptedAt?{attemptedAt:row.attemptedAt}:{}),...(row.acceptedAt?{acceptedAt:row.acceptedAt}:{})};
  }
 }catch(error){if(error.statusCode!==404)for(const id of Object.keys(states))states[id]={status:"unknown",retryAllowed:true}}
 if(typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled()){
  const delivery=await labNoticeStates(schoolId,eligible.map(item=>({id:item.id,eventId:uniformPaymentLineId(item),recipient:item.parentEmail||item.requesterEmail})));
  for(const [id,row] of Object.entries(delivery)){
   if(row.status==="accepted"&&row.channel==="email")states[id]={status:"email_sent",retryAllowed:false,acceptedAt:row.acceptedAt};
   else if(row.mailStatus==="not_configured")states[id]={status:"email_not_configured",retryAllowed:true};
   else if(row.mailStatus==="no_recipient")states[id]={status:"email_missing",retryAllowed:true};
  }
 }
 return states;
}
