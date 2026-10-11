import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
const fail=(error,status=400)=>json({error},status);
let client;
async function db(){
 if(!process.env.STORAGE_CONNECTION_STRING)throw Error("Storage unavailable");
 if(!client){client=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantPaymentAccountTemplates");await client.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
 return client;
}
app.http("paymentAccountTemplates",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/payment-account-templates",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 const {access,schoolId}=ctx;if(access.role!=="admin")return fail("Admin only",403);
 try{
  const table=await db();
  if(request.method==="GET"){
   const items=[];for await(const row of table.listEntities({queryOptions:{filter:"PartitionKey eq '"+schoolId.replace(/'/g,"''")+"'"}})){items.push({id:row.rowKey,...JSON.parse(row.payload||"{}"),updatedAt:row.updatedAt})}
   return json({items:items.sort((a,b)=>String(a.label).localeCompare(String(b.label),"zh-Hant"))});
  }
  const data=await request.json();
  const id=data.id||("bank_"+crypto.randomUUID().replace(/-/g,""));
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||typeof data.label!=="string"||!data.label.trim()||data.label.length>80||typeof data.bankName!=="string"||!data.bankName.trim()||data.bankName.length>100||!/^[0-9]{3}$/.test(data.bankCode)||typeof data.accountHolder!=="string"||!data.accountHolder.trim()||data.accountHolder.length>100||!/^[0-9]{6,30}$/.test(data.accountNumber)||typeof data.active!=="boolean")return fail("Invalid account template");
  const payload={label:data.label.trim(),bankName:data.bankName.trim(),bankCode:data.bankCode,accountHolder:data.accountHolder.trim(),accountNumber:data.accountNumber,active:data.active};
  const timestamp=new Date().toISOString();
  await table.upsertEntity({partitionKey:schoolId,rowKey:id,payload:JSON.stringify(payload),updatedAt:timestamp,updatedBy:String(access.email||"admin").slice(0,200)},"Replace");
  return json({saved:true,id,updatedAt:timestamp});
 }catch(e){console.error("paymentAccountTemplates",e);return fail("Unable to process account templates",500)}
}});
