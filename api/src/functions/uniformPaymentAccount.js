import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,ensureStudentAccess,json} from "../lib/auth.js";
const valid=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const fail=(error,status=400)=>json({error},status);
const db=async name=>{const c=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);await c.createTable().catch(e=>{if(e.statusCode!==409)throw e});return c};
const find=async(t,p,r)=>{try{return await t.getEntity(p,r)}catch(e){if(e.statusCode===404)return null;throw e}};
app.http("uniformPaymentAccount",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/uniform-payment-account",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 const {access,schoolId}=ctx;
 try{
  const input=request.method==="GET"?Object.fromEntries(new URL(request.url).searchParams):await request.json();
  if(!["regularUniform","competitionUniform"].includes(input.kind))return fail("Invalid kind");
  const accounts=await db("TenantUniformPaymentAccounts"),key="uniform:"+input.kind;
  if(request.method==="POST"){
   if(access.role!=="admin")return fail("Admin only",403);
   if(!/^[0-9]{3}$/.test(input.bankCode)||!/^[0-9]{6,30}$/.test(input.accountNumber)||![input.bankName,input.accountHolder].every(x=>typeof x==="string"&&x.trim()&&x.length<=100))return fail("Invalid account");
   const stamp=new Date().toISOString();
   await accounts.upsertEntity({partitionKey:schoolId,rowKey:key,payload:JSON.stringify({bankCode:input.bankCode,bankName:input.bankName.trim(),accountHolder:input.accountHolder.trim(),accountNumber:input.accountNumber}),updatedAt:stamp,updatedBy:String(access.email||"admin")},"Replace");
   return json({saved:true});
  }
  if(access.role!=="admin"&&access.role!=="parent")return fail("Forbidden",403);
  const account=await find(accounts,schoolId,key);if(!account)return json({item:null});
  const bank=JSON.parse(account.payload||"{}");
  if(access.role==="admin")return json({item:{...bank,updatedAt:account.updatedAt}});
  if(!valid(input.requestId))return fail("Order required",403);
  const requests=await db("TenantUniformEventRequest");
  const row=await find(requests,schoolId,input.requestId);if(!row)return fail("Order not found",404);
  const order=JSON.parse(row.payload||"{}");
  if(order.kind!==input.kind||!ensureStudentAccess(access,order.studentId)||order.status!=="APPROVED"||!Number.isSafeInteger(order.amount)||order.amount<=0)return fail("Payment not available",403);
  return json({item:bank,amount:order.amount,paymentStatus:order.paymentStatus||"AWAITING_TRANSFER"});
 }catch(e){console.error("uniformPaymentAccount",e);return fail("Payment account unavailable",500)}
}});
