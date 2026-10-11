import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {createHash,randomUUID} from "node:crypto";
import {getTenantContext,ensureStudentAccess,json} from "../lib/auth.js";
import {getStudentMaster} from "../lib/storage.js";

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
async function log(schoolId,access,action,id,details){
 const a=await table("TenantUniformEventAudit");
 await a.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action,subjectId:id,actor:String(access.email||"unknown").slice(0,200),at:now(),details:JSON.stringify(details).slice(0,16000)});
}
function publicRegistration(row,role){
 const r=decode(row);
 // Financial verification data never appears in a publicly enumerable config endpoint.
 if(role==="admin")return r;
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
    const list=[];
    for await(const row of records.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
     const r=decode(row);
     if(access.role==="admin"||r.parentEmail===access.email)list.push(publicRegistration(row,access.role));
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
    if((cfg.openAt&&Date.parse(cfg.openAt)>time)||(cfg.closeAt&&Date.parse(cfg.closeAt)<time))return fail("Registration window closed",403);
    const ids=body.studentIds;
    if(!Array.isArray(ids)||ids.length<1||ids.length>10||new Set(ids).size!==ids.length||!ids.every(s=>safeId(s)&&ensureStudentAccess(access,s)))return fail("Select authorized students");
    if(!integer(body.adults,1,20)||!integer(body.extraChildren,0,20))return fail("At least one adult required");
    for(const id of ids)if(!await getStudentMaster(id,schoolId))return fail("Student not found",403);
    const id=registrationId(body.kind,body.activityId,access.email);
    const previous=await get(records,schoolId,id);
    if(previous)return fail("This family has already registered; contact administrator to change attendees",409);
    const timestamp=now();
    const initialRates=["studentFee","firstAdultFee","extraAdultFee","extraChildFee"].every(k=>integer(cfg[k],0,1000000));
    const estimate=initialRates?(body.kind==="yearEndDinner"?0:cfg.studentFee)*ids.length+cfg.firstAdultFee+(body.adults-1)*cfg.extraAdultFee+body.extraChildren*cfg.extraChildFee:null;
    const payload={estimatedAmount:estimate,estimateNotice:"初步報價，非實際應繳金額；待報名結束後另行通知匯款",kind:body.kind,activityId:body.activityId,studentIds:ids,studentId:ids[0],adults:body.adults,extraChildren:body.extraChildren,parentEmail:access.email,registrationStatus:"REGISTERED",paymentStatus:"NOT_OPEN",createdAt:timestamp,updatedAt:timestamp};
    try{await records.createEntity({partitionKey:schoolId,rowKey:id,payload:JSON.stringify(payload),updatedAt:timestamp})}
    catch(e){if(e.statusCode===409)return fail("This family has already registered",409);throw e}
    await log(schoolId,access,"family.registration",id,{studentIds:ids,adults:body.adults,extraChildren:body.extraChildren});
    return json({item:{...payload,id}},201);
   }
   if(request.method!=="PATCH")return fail("Method not allowed",405);
   const id=registrationId(body.kind,body.activityId,access.email);
   // Parent may only submit transfer information for their own deterministic family key.
   const actual=access.role==="admin"?String(body.registrationId||""):id;
   if(access.role==="admin"&&!/^family:(fieldTrip|yearEndDinner):[A-Za-z0-9_-]{1,80}:[a-f0-9]{32}$/.test(actual))return fail("Invalid registration ID");
   const previous=await get(records,schoolId,actual);
   if(!previous)return fail("Registration not found",404);
   const old=decode(previous);
   if(access.role==="parent"&&old.parentEmail!==access.email)return fail("Forbidden",403);
   if(old.registrationStatus!=="REGISTERED")return fail("Registration not active",409);
   const next={...JSON.parse(previous.payload)};
   if(body.action==="REPORT_TRANSFER"){
    if(access.role!=="parent")return fail("Parent only",403);
    if(cfg.paymentOpen!==true||cfg.feeStatus!=="PUBLISHED")return fail("Payment not open",409);
    const due=feeOf(cfg,old);
    if(due===null||due<=0)return fail("Invalid payment configuration",409);
    if(!integer(body.amount,1,10000000)||!/^[0-9]{5}$/.test(body.lastFive||"")||!/^\d{4}-\d{2}-\d{2}$/.test(body.transferDate||""))return fail("Transfer date, amount and last five digits required");
    next.paymentStatus="REPORTED_UNVERIFIED";
    next.transferReport={amount:body.amount,lastFive:body.lastFive,transferDate:body.transferDate,reportedAt:now(),expectedAmount:due};
   }else if(body.action==="VERIFY_PAYMENT"){
    // Do not permit ordinary school admins to impersonate the finance committee.
    // A separately verified finance capability must be implemented before enabling.
    if(access.role!=="admin"||access.capabilities?.financeVerifier!==true)return fail("Finance verification permission not configured",403);
    if(old.paymentStatus!=="REPORTED_UNVERIFIED")return fail("Transfer not reported",409);
    next.paymentStatus="VERIFIED";next.verifiedBy=access.email;next.verifiedAt=now();
   }else return fail("Invalid action");
   next.updatedAt=now();
   try{await records.updateEntity({partitionKey:schoolId,rowKey:actual,payload:JSON.stringify(next),updatedAt:next.updatedAt},"Replace",{etag:previous.etag})}
   catch(e){if(e.statusCode===412)return fail("Record changed, refresh and retry",409);throw e}
   await log(schoolId,access,"family."+body.action,actual,{from:old.paymentStatus,to:next.paymentStatus});
   return json({item:{...next,id:actual}});
  }catch(e){console.error("familyEventRegistration",e);return fail("Unable to process family registration",500)}
 }
});
