import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";
import {getTenantContext,ensureStudentAccess,json} from "../lib/auth.js";
const fail=(error,status=400)=>json({error},status);
const db=async name=>{const c=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);await c.createTable().catch(e=>{if(e.statusCode!==409)throw e});return c};
const find=async(t,p,r)=>{try{return await t.getEntity(p,r)}catch(e){if(e.statusCode===404)return null;throw e}};
app.http("uniformTransferReport",{methods:["POST","PATCH"],authLevel:"anonymous",route:"uniform-events/uniform-transfer-report",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 const {schoolId,access}=ctx;
 if(request.method==="PATCH"?(access.role!=="admin"||access.capabilities?.financeVerifier!==true):access.role!=="parent")return fail("此操作需要家長或指定財務權限",403);
 try{
  const b=await request.json();
  if(!/^[a-f0-9-]{36}$/i.test(b.requestId||""))return fail("Invalid request ID");
  if(request.method==="POST"&&(!/^[0-9]{5}$/.test(b.lastFive||"")||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.transferDate||"")||!Number.isFinite(Date.parse(b.transferDate))))return fail("Invalid transfer report");
  const t=await db("TenantUniformEventRequest"),row=await find(t,schoolId,b.requestId);
  if(!row)return fail("Order not found",404);
  const old=JSON.parse(row.payload||"{}");
  if(!["regularUniform","competitionUniform"].includes(old.kind)||(request.method==="POST"&&!ensureStudentAccess(access,old.studentId)))return fail("Forbidden",403);
  if(!["APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"].includes(old.status)||!Number.isSafeInteger(old.amount)||old.amount<=0)return fail("Order not payable",409);
  if(request.method==="PATCH"){
   if(old.paymentStatus!=="REPORTED_UNVERIFIED")return fail("此訂單尚無待核對匯款",409);
   if(b.etag!==row.etag||!Number.isSafeInteger(b.amount)||b.amount!==old.amount||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.bankPostedAt||"")||!Number.isFinite(Date.parse(b.bankPostedAt))||typeof b.note!=="string"||!b.note.trim()||b.note.length>300)return fail("請核對實際入帳日期、金額，填寫核帳備註後重新讀取訂單",400);
   const stamp=new Date().toISOString(),next={...old,paymentStatus:"VERIFIED",verifiedBy:access.email,verifiedAt:stamp,bankPostedAt:b.bankPostedAt,verificationNote:b.note.trim(),updatedAt:stamp};
   const audit=await db("TenantUniformEventAudit");
   await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"uniform.transfer.verify",subjectId:b.requestId,actor:String(access.email||"finance"),at:stamp,details:JSON.stringify({amount:old.amount,bankPostedAt:b.bankPostedAt,report:old.transferReport,note:next.verificationNote})});
   try{await t.updateEntity({partitionKey:schoolId,rowKey:b.requestId,payload:JSON.stringify(next),updatedAt:stamp},"Replace",{etag:row.etag})}
   catch(e){if(e.statusCode===412)return fail("Order changed; refresh",409);throw e}
   return json({paymentStatus:next.paymentStatus,verifiedAt:stamp,verifiedBy:access.email});
  }
  if(old.paymentStatus==="VERIFIED")return fail("Already verified",409);
  if(old.paymentStatus==="REPORTED_UNVERIFIED")return fail("Transfer already reported",409);
  if(b.amount!==old.amount||b.etag!==row.etag)return fail("Amount or version mismatch",409);
  const accounts=await db("TenantUniformPaymentAccounts"),bank=await find(accounts,schoolId,"uniform:"+old.kind);
  if(!bank)return fail("Payment account missing",409);
  const account=JSON.parse(bank.payload||"{}"),stamp=new Date().toISOString();
  const next={...old,paymentStatus:"REPORTED_UNVERIFIED",transferReport:{amount:old.amount,lastFive:b.lastFive,transferDate:b.transferDate,reportedAt:stamp,bankLastFour:account.accountNumber.slice(-4)},updatedAt:stamp};
  const audit=await db("TenantUniformEventAudit");
  await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"uniform.transfer.report",subjectId:b.requestId,actor:String(access.email||"parent"),at:stamp,details:JSON.stringify({amount:old.amount,transferDate:b.transferDate,lastFive:b.lastFive})});
  try{await t.updateEntity({partitionKey:schoolId,rowKey:b.requestId,payload:JSON.stringify(next),updatedAt:stamp},"Replace",{etag:row.etag})}
  catch(e){if(e.statusCode===412)return fail("Order changed; refresh",409);throw e}
  return json({paymentStatus:next.paymentStatus});
 }catch(e){console.error("uniformTransferReport",e);return fail("Unable to report transfer",500)}
}});
