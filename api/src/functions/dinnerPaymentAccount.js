import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";

const validId=s=>typeof s==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(s);
let client;
async function store(){
 if(!process.env.STORAGE_CONNECTION_STRING)throw Error("Storage unavailable");
 if(!client){client=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantEventPaymentAccounts");await client.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
 return client;
}
const fail=(error,status=400)=>json({error},status);
function paymentAccountHandler(module){return async request=>{

  const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
  const {access,schoolId}=ctx;
  if(!["admin","parent"].includes(access.role))return fail("Forbidden",403);
  try{
   const data=request.method==="GET"?{activityId:new URL(request.url).searchParams.get("activityId")}:await request.json();
   if(!validId(data?.activityId))return fail("Invalid activity ID");
   const configs=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
   let activity;
   try{activity=await configs.getEntity(schoolId,module+":"+data.activityId)}catch(e){if(e.statusCode===404)return fail("Activity must be saved first",404);throw e}
   if(!activity)return fail("Activity not found",404);
   const config=JSON.parse(activity.payload||"{}");
   if(access.role==="parent"&&(request.method!=="GET"||config.enabled!==true||(module==="yearEndDinner"?(config.paymentOpen!==true||config.feeStatus!=="PUBLISHED"):config.collectionOpen!==true)))return fail("Payment information not published",403);
   const db=await store(),rowKey=module+":"+data.activityId;
   if(request.method==="GET"){
    try{const row=await db.getEntity(schoolId,rowKey);return json({item:JSON.parse(row.payload||"{}"),updatedAt:row.updatedAt,...(access.role==="admin"?{updatedBy:row.updatedBy}:{})})}
    catch(e){if(e.statusCode===404)return json({item:null});throw e}
   }
   if(access.role!=="admin")return fail("Admin only",403);
   const {bankName,bankCode,accountHolder,accountNumber}=data;
   if(![bankName,accountHolder].every(v=>typeof v==="string"&&v.trim().length>0&&v.length<=100)||!/^[0-9]{3}$/.test(bankCode)||!/^[0-9]{6,30}$/.test(accountNumber))return fail("Invalid bank account details");
   const timestamp=new Date().toISOString();
   await db.upsertEntity({partitionKey:schoolId,rowKey,payload:JSON.stringify({bankName:bankName.trim(),bankCode,accountHolder:accountHolder.trim(),accountNumber}),updatedAt:timestamp,updatedBy:String(access.email||"admin").slice(0,200)},"Replace");
   return json({saved:true,updatedAt:timestamp});
  }catch(e){console.error("eventPaymentAccount",e);return fail("Unable to process payment account",500)}
 }
}
app.http("dinnerPaymentAccount",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/dinner-payment-account",handler:paymentAccountHandler("yearEndDinner")});
app.http("fieldTripPaymentAccount",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/field-trip-payment-account",handler:paymentAccountHandler("fieldTrip")});
