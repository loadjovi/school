import {lineFirstLabEnabled} from "../lib/labNoticeDelivery.mjs";
import {paymentOnHold} from "../lib/paymentResolutionRules.mjs";
import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {createHash,randomUUID} from "node:crypto";
import {getTenantContext,ensureStudentAccess,json} from "../lib/auth.js";
import {getStudentMaster} from "../lib/storage.js";
import {familyPaymentInfo} from "../lib/paymentNoticeRules.mjs";
import {safePaymentNotifications} from "../lib/paymentNotifications.js";
import {notifyFinanceTransfer,retryFinanceTransfer} from "../lib/lineAdminTodoNotification.mjs";
import {activityAllowsGroup} from "../lib/paidActivityLine.js";
import {notifyTenantPaymentVerified} from "../lib/tenantLineFeeNotice.js";

const safeId=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(s);
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fail=(message,status=400)=>json({error:message},status);
const connection=()=>process.env.STORAGE_CONNECTION_STRING;
const tables=new Map();
async function table(name){
 if(!connection())throw Error("Storage unavailable");
 if(!tables.has(name)){
  const client=TableClient.fromConnectionString(connection(),name);
  await client.createTable().catch(e=>{if(e.statusCode!==409)throw e});
  tables.set(name,client);
 }
 return tables.get(name);
}
async function get(client,schoolId,id){
 try{return await client.getEntity(schoolId,id)}catch(e){if(e.statusCode===404)return null;throw e}
}
const decode=e=>({...JSON.parse(e.payload||"{}"),id:e.rowKey,etag:e.etag});
const digest=s=>createHash("sha256").update(s).digest("hex").slice(0,32);
const registrationId=(kind,activityId,email)=>"family:"+kind+":"+activityId+":"+digest(email);
const now=()=>new Date().toISOString();
function ownsRegistration(access, item) {
 if (item.parentEmail === access.email) return true;
 return Boolean(access.parentAlias && item.parentEmail === access.parentAlias &&
   Array.isArray(item.studentIds) && item.studentIds.length &&
   item.studentIds.every(id => ensureStudentAccess(access, id)));
}
async function log(schoolId,access,action,id,details){
 const a=await table("TenantUniformEventAudit");
 await a.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action,subjectId:id,actor:String(access.email||"unknown").slice(0,200),at:now(),details:JSON.stringify(details).slice(0,16000)});
}
function publicRegistration(row,access){
 const r=decode(row);
 // Financial verification data never appears in a publicly enumerable config endpoint.
 if(access.role==="admin"){
  if(access.capabilities?.financeVerifier===true)return r;
  const {transferReport,verificationNote,bankPostedAt,paymentResolution,paymentResolutionEvents,...safe}=r;return safe;
 }
 const {etag,...safe}=r;return safe;
}
function feeOf(cfg,r){
 if(cfg.feeStatus!=="PUBLISHED")return null;
 const student= r.kind==="yearEndDinner"?0:cfg.studentFee;
 const fields=[student,cfg.firstAdultFee,cfg.extraAdultFee,cfg.extraChildFee];
 if(!fields.every(n=>integer(n,0,1000000)))return null;
 return r.studentIds.length*student+fields[1]+(r.adults-1)*fields[2]+r.extraChildren*fields[3];
}
app.http("familyEventRegistration",{
 methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"uniform-events/family-registration",
 handler:async request=>{
  const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
  const {access,schoolId}=ctx;
  if(!["admin","parent"].includes(access.role))return fail("Forbidden",403);
  try{
   const records=await table("TenantFamilyEventRegistration");
   if(request.method==="GET"){
    const list=[],configs=await table(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig"),configCache=new Map();
    for await(const row of records.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
     const r=decode(row);
     if(access.role==="admin"||ownsRegistration(access,r)){
      const key=r.kind+":"+r.activityId;
      if(!configCache.has(key)){const config=await get(configs,schoolId,key);configCache.set(key,config?JSON.parse(config.payload||"{}"):null)}
      const config=configCache.get(key),payment=familyPaymentInfo(config,r);
      const reported=["REPORTED_UNVERIFIED","VERIFIED"].includes(r.paymentStatus)&&Number.isSafeInteger(r.transferReport?.expectedAmount)?r.transferReport.expectedAmount:payment.amount;
      list.push({...publicRegistration(row,access),amount:r.paymentResolution?.expectedAmount??reported,paymentOpen:payment.paymentOpen,activityTitle:config?.title||r.activityId});
     }
    }
    return json({items:list});
   }
   const body=await request.json();
   if(!body||!["fieldTrip","yearEndDinner"].includes(body.kind)||!safeId(body.activityId))return fail("Invalid activity");
   const configs=await table(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
   const cfgRow=await get(configs,schoolId,body.kind+":"+body.activityId);
   if(!cfgRow)return fail("Activity not found",404);
   const cfg=JSON.parse(cfgRow.payload||"{}");
   if(request.method==="POST"){
    if(access.role!=="parent")return fail("Parent only",403);
    if(cfg.enabled!==true)return fail("Activity closed",403);
    const time=Date.now();
    if(cfg.openAt&&Date.parse(cfg.openAt)>time)return fail("報名尚未開始，請於開放時間再申請。",403);
    if(cfg.closeAt&&Date.parse(cfg.closeAt)<=time)return fail("活動報名已截止；已報名家庭仍可回報匯款。如需補報名，請聯絡學校。",403);
    const ids=body.studentIds;
    if(!Array.isArray(ids)||ids.length<1||ids.length>10||new Set(ids).size!==ids.length||!ids.every(s=>safeId(s)&&ensureStudentAccess(access,s)))return fail("Select authorized students");
    if(!integer(body.adults,1,20)||!integer(body.extraChildren,0,20))return fail("At least one adult required");
    for(const id of ids){
     const student=await getStudentMaster(id,schoolId);
     if(!student||student.status==="inactive"||!activityAllowsGroup(cfg,student.groupName))return fail("所選學生不在此活動的開放團別。",403);
    }
    if(body.kind==="yearEndDinner"){
     if(!integer(cfg.firstAdultFee,0,1000000)||!integer(cfg.extraAdultFee,0,1000000)||!integer(cfg.extraChildFee,0,1000000))return fail("Dinner rates are not configured",409);
     if(cfg.feeStatus!=="PUBLISHED"||cfg.paymentOpen!==true)return fail("Dinner payment has not been opened",409);
     if(!/^[0-9]{5}$/.test(body.lastFive||""))return fail("Transfer last five digits required");
     if(!/^\d{4}-\d{2}-\d{2}$/.test(body.transferDate||"")||!Number.isFinite(Date.parse(body.transferDate)))return fail("請填寫匯款日期",400);
     const accountTable=await table("TenantEventPaymentAccounts");
     const account=await get(accountTable,schoolId,"yearEndDinner:"+body.activityId);
     if(!account)return fail("Dinner payment account is not configured",409);
    }
    const id=registrationId(body.kind,body.activityId,access.email);
    const previous=await get(records,schoolId,id);
    const aliasId=access.parentAlias&&registrationId(body.kind,body.activityId,access.parentAlias);
    const aliasRecord=aliasId&&await get(records,schoolId,aliasId);
    if(previous||(aliasRecord&&ownsRegistration(access,decode(aliasRecord))))return fail("This family has already registered; contact administrator to change attendees",409);
    const timestamp=now();
    const dinner=body.kind==="yearEndDinner";
    const initialRates=["studentFee","firstAdultFee","extraAdultFee","extraChildFee"].every(k=>integer(cfg[k],0,1000000));
    const estimate=dinner?feeOf(cfg,body):initialRates?cfg.studentFee*ids.length+cfg.firstAdultFee+(body.adults-1)*cfg.extraAdultFee+body.extraChildren*cfg.extraChildFee:null;
    const reportsPayment=dinner&&estimate>0;
    const paymentStatus=reportsPayment?"REPORTED_UNVERIFIED":dinner?"NOT_REQUIRED":"NOT_OPEN";
    const payload={estimatedAmount:estimate,estimateNotice:dinner?"依校方公告費率計算":"初步報價，非實際應繳金額；待報名結束後另行通知匯款",kind:body.kind,activityId:body.activityId,studentIds:ids,studentId:ids[0],adults:body.adults,extraChildren:body.extraChildren,parentEmail:access.email,registrationStatus:"REGISTERED",paymentStatus,...(reportsPayment?{transferReport:{amount:estimate,lastFive:body.lastFive,transferDate:body.transferDate,reportedAt:timestamp,expectedAmount:estimate}}:{}),createdAt:timestamp,updatedAt:timestamp};
    try{await records.createEntity({partitionKey:schoolId,rowKey:id,payload:JSON.stringify(payload),updatedAt:timestamp})}
    catch(e){if(e.statusCode===409)return fail("This family has already registered",409);throw e}
    await log(schoolId,access,"family.registration",id,{studentIds:ids,adults:body.adults,extraChildren:body.extraChildren});
    const needsVerification=payload.paymentStatus==="REPORTED_UNVERIFIED";
    const [paymentNotification,financeLineStatus]=await Promise.all([
      (familyPaymentInfo(cfg,payload).needsPayment||needsVerification)?safePaymentNotifications(schoolId,{scope:{kind:"family",id}}):null,
      needsVerification&&!(typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled())?notifyFinanceTransfer(schoolId,{kind:"family",id,reportedAt:payload.transferReport.reportedAt}):undefined,
    ]);
    return json({item:{...payload,id},paymentNotification,financeLineStatus},201);
   }
   if(request.method!=="PATCH")return fail("Method not allowed",405);
   const id=registrationId(body.kind,body.activityId,access.email);
   const aliasId=access.parentAlias&&registrationId(body.kind,body.activityId,access.parentAlias);
   const requestedId=String(body.registrationId||"");
   if(access.role==="admin"&&!/^family:(fieldTrip|yearEndDinner):[A-Za-z0-9_-]{1,80}:[a-f0-9]{32}$/.test(requestedId))return fail("Invalid registration ID");
   if(access.role==="parent"&&requestedId&&requestedId!==id&&requestedId!==aliasId)return fail("Forbidden",403);
   let previous=await get(records,schoolId,requestedId||id);
   if(!previous&&access.role==="parent"&&!requestedId&&aliasId)previous=await get(records,schoolId,aliasId);
   if(!previous)return fail("Registration not found",404);
   const old=decode(previous),actual=old.id;
   if(access.role==="parent"&&!ownsRegistration(access,old))return fail("Forbidden",403);
   if(old.paymentResolution&&paymentOnHold(old))return fail("此筆須由補款／退費流程處理，不能直接核帳或重新回報全額",409);
   if(old.registrationStatus!=="REGISTERED")return fail("Registration not active",409);
   if(body.action==="RETRY_FINANCE_LINE"){
    if(access.role!=="admin"||access.capabilities?.financeVerifier!==true)return fail("僅指定財務人員可補送通知",403);
    if(old.kind!==body.kind||old.activityId!==body.activityId)return fail("Invalid registration ID");
    if(body.etag!==previous.etag)return fail("資料已變更，請重新整理",409);
    return json({financeLineStatus:await retryFinanceTransfer(schoolId,"family",actual,old)});
   }
   const next={...JSON.parse(previous.payload)};
   if(body.action==="REPORT_TRANSFER"){
    if(access.role!=="parent")return fail("Parent only",403);
    if(["REPORTED_UNVERIFIED","VERIFIED"].includes(old.paymentStatus))return fail("此筆已回報或已核帳，無須重複回報匯款",409);
    if(cfg.paymentOpen!==true||cfg.feeStatus!=="PUBLISHED")return fail("Payment not open",409);
    const due=feeOf(cfg,old);
    if(due===null||due<=0)return fail("Invalid payment configuration",409);
    if(!integer(body.amount,1,10000000)||!/^[0-9]{5}$/.test(body.lastFive||"")||!/^\d{4}-\d{2}-\d{2}$/.test(body.transferDate||"")||!Number.isFinite(Date.parse(body.transferDate)))return fail("Transfer date, amount and last five digits required");
    next.paymentStatus="REPORTED_UNVERIFIED";
    next.transferReport={amount:body.amount,lastFive:body.lastFive,transferDate:body.transferDate,reportedAt:now(),expectedAmount:due};
   }else if(body.action==="VERIFY_PAYMENT"){
    // Do not permit ordinary school admins to impersonate the finance committee.
    // A separately verified finance capability must be implemented before enabling.
    if(access.role!=="admin"||access.capabilities?.financeVerifier!==true)return fail("Finance verification permission not configured",403);
    if(old.paymentStatus!=="REPORTED_UNVERIFIED")return fail("Transfer not reported",409);
    if(!integer(old.transferReport?.expectedAmount,1,10000000)||old.transferReport.amount!==old.transferReport.expectedAmount)return fail("家長回報金額與應繳金額不同，請先處理差額",409);
    if(!integer(body.amount,1,10000000)||body.amount!==old.transferReport?.amount||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body.bankPostedAt||"")||!Number.isFinite(Date.parse(body.bankPostedAt))||typeof body.note!=="string"||!body.note.trim()||body.note.length>300)return fail("請核對實際入帳金額、日期並填寫備註",400);
    next.paymentStatus="VERIFIED";next.verifiedBy=access.email;next.verifiedAt=now();next.bankPostedAt=body.bankPostedAt;next.verificationNote=body.note.trim();
   }else return fail("Invalid action");
   next.updatedAt=now();
   await log(schoolId,access,"family."+body.action,actual,{from:old.paymentStatus,to:next.paymentStatus,amount:next.transferReport?.amount,bankPostedAt:next.bankPostedAt||"",note:next.verificationNote||""});
   try{await records.updateEntity({partitionKey:schoolId,rowKey:actual,payload:JSON.stringify(next),updatedAt:next.updatedAt},"Replace",{etag:previous.etag})}
   catch(e){if(e.statusCode===412)return fail("Record changed, refresh and retry",409);throw e}
   const reporting=body.action==="REPORT_TRANSFER";
   const [paymentNotification,financeLineStatus]=await Promise.all([
     reporting?safePaymentNotifications(schoolId,{scope:{kind:"family",id:actual}}):null,
     reporting&&!(typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled())?notifyFinanceTransfer(schoolId,{kind:"family",id:actual,reportedAt:next.transferReport.reportedAt}):undefined
   ]);
   const lineNotification=body.action==="VERIFY_PAYMENT"?await notifyTenantPaymentVerified(schoolId,{
     kind:old.kind,id:actual,at:next.verifiedAt,parentEmail:old.parentEmail
   }):undefined;
   return json({item:{...next,id:actual},paymentNotification,financeLineStatus,lineNotification});
  }catch(e){console.error("familyEventRegistration",e);return fail("Unable to process family registration",500)}
 }
});
