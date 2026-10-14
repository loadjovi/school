import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {defaultUniformPrices,getUniformPrice,uniformPricingTable,validUniformKind} from "../lib/uniformPricing.js";

app.http("uniformPrices",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/prices",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 const {schoolId,access}=ctx;
 if(!["admin","parent"].includes(access.role))return json({error:"Forbidden"},403);
 try{
  if(request.method==="GET"){
   const items={};for(const kind of Object.keys(defaultUniformPrices))items[kind]=await getUniformPrice(schoolId,kind);
   return json({items});
  }
  if(access.role!=="admin")return json({error:"Admin only"},403);
  const data=await request.json();
  if(!validUniformKind(data.kind)||!Number.isSafeInteger(data.unitPrice)||data.unitPrice<1||data.unitPrice>100000||typeof data.reason!=="string"||!data.reason.trim()||data.reason.length>300)return json({error:"請輸入有效價格（1–100,000 元）及調整原因"},400);
  const table=await uniformPricingTable(),current=await getUniformPrice(schoolId,data.kind);
  if(data.etag!==current.etag)return json({error:"價格已由其他管理員更新，請重新整理後再修改"},409);
  if(data.unitPrice===current.unitPrice)return json({error:"價格未變更"},400);
  const stamp=new Date().toISOString();
  const row={partitionKey:schoolId,rowKey:data.kind,unitPrice:data.unitPrice,updatedAt:stamp,updatedBy:String(access.email||"admin").slice(0,200)};
  try{if(current.etag)await table.updateEntity(row,"Replace",{etag:current.etag});else await table.createEntity(row)}
  catch(e){if([409,412].includes(e.statusCode))return json({error:"價格已更新，請重新整理後再修改"},409);throw e}
  const audit=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantUniformEventAudit");
  await audit.createTable().catch(e=>{if(e.statusCode!==409)throw e});
  await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"uniform.price.update",subjectId:data.kind,actor:String(access.email||"admin").slice(0,200),at:stamp,details:JSON.stringify({from:current.unitPrice,to:data.unitPrice,reason:data.reason.trim()})});
  return json({item:await getUniformPrice(schoolId,data.kind)});
 }catch(e){console.error("uniformPrices",e);return json({error:"團服價格讀取或更新失敗"},500)}
}});
