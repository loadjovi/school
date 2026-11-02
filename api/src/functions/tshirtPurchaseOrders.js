import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {validatePurchaseOrderInput} from "../lib/tshirtPurchaseOrderRules.mjs";

let orders,audit;
async function tables(){
 const connection=process.env.STORAGE_CONNECTION_STRING;if(!connection)throw Error("Storage unavailable");
 if(!orders){orders=TableClient.fromConnectionString(connection,"TenantTshirtPurchaseOrders");await orders.createTable().catch(error=>{if(error.statusCode!==409)throw error})}
 if(!audit){audit=TableClient.fromConnectionString(connection,"TenantUniformEventAudit");await audit.createTable().catch(error=>{if(error.statusCode!==409)throw error})}
 return {orders,audit};
}
const clean=(value,max=300)=>String(value||"").trim().slice(0,max);
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateKey=value=>{const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return `${parts.year}${parts.month}${parts.day}`};
function view(entity){let items=[];try{items=JSON.parse(entity.items||"[]")}catch{}return {id:entity.rowKey,orderNumber:entity.orderNumber,schoolYear:entity.schoolYear,semester:entity.semester,status:entity.status,items,totalQuantity:entity.totalQuantity,pendingUnknownUnits:entity.pendingUnknownUnits||0,needUnits:entity.needUnits||0,extraUnits:entity.extraUnits||0,note:entity.note||"",createdAt:entity.createdAt,createdBy:entity.createdBy,cancelledAt:entity.cancelledAt||"",cancelledBy:entity.cancelledBy||"",cancelReason:entity.cancelReason||"",etag:entity.etag}}

app.http("tshirtPurchaseOrders",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/tshirt-purchase-orders",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 if(ctx.access.role!=="admin")return json({error:"Admin only"},403);
 try{
  const clients=await tables(),schoolId=ctx.schoolId;
  if(request.method==="GET"){
   const items=[];for await(const entity of clients.orders.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}}))items.push(view(entity));
   return json({items:items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,100)});
  }
  const input=await request.json(),action=clean(input?.action,30),actor=clean(ctx.access.email,200),now=new Date().toISOString();
  if(action==="CREATE"){
   const id=clean(input.requestKey,40).toLowerCase();if(!idPattern.test(id))return json({error:"採購單識別碼不正確，請重新整理"},400);
   try{return json({item:view(await clients.orders.getEntity(schoolId,id)),alreadyCreated:true})}catch(error){if(error.statusCode!==404)throw error}
   let normalized;try{normalized=validatePurchaseOrderInput(input)}catch(error){return json({error:error.message},400)}
   const orderNumber=`T-${normalized.schoolYear}${normalized.semester}-${dateKey(now)}-${id.slice(0,6).toUpperCase()}`;
   const entity={partitionKey:schoolId,rowKey:id,schoolId,orderNumber,schoolYear:normalized.schoolYear,semester:normalized.semester,status:"ORDERED",items:JSON.stringify(normalized.items),totalQuantity:normalized.total,pendingUnknownUnits:normalized.pendingUnknownUnits,needUnits:Number.isSafeInteger(Number(input.needUnits))?Number(input.needUnits):0,extraUnits:Number.isSafeInteger(Number(input.extraUnits))?Number(input.extraUnits):0,note:clean(input.note),createdAt:now,createdBy:actor,updatedAt:now};
   try{await clients.orders.createEntity(entity)}catch(error){if(error.statusCode===409)return json({item:view(await clients.orders.getEntity(schoolId,id)),alreadyCreated:true});throw error}
   await clients.audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"tshirt.purchase_order.create",subjectId:id,actor,at:now,details:JSON.stringify({orderNumber,items:normalized.items,totalQuantity:normalized.total,pendingUnknownUnits:normalized.pendingUnknownUnits}).slice(0,20000)}).catch(error=>console.error("tshirtPurchaseOrders audit create",error));
   return json({item:view(entity)},201);
  }
  if(action==="CANCEL"){
   const id=clean(input.id,40).toLowerCase(),reason=clean(input.reason);if(!idPattern.test(id)||!reason)return json({error:"採購單或取消原因不正確"},400);
   let old;try{old=await clients.orders.getEntity(schoolId,id)}catch(error){if(error.statusCode===404)return json({error:"找不到採購單"},404);throw error}
   if(old.status!=="ORDERED")return json({error:"只有待到貨採購單可以取消"},409);
   if(input.etag!==old.etag)return json({error:"採購單已變更，請重新整理"},409);
   const next={...old,status:"CANCELLED",cancelledAt:now,cancelledBy:actor,cancelReason:reason,updatedAt:now};
   try{await clients.orders.updateEntity(next,"Replace",{etag:old.etag})}catch(error){if(error.statusCode===412)return json({error:"採購單已變更，請重新整理"},409);throw error}
   await clients.audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"tshirt.purchase_order.cancel",subjectId:id,actor,at:now,details:JSON.stringify({orderNumber:old.orderNumber,reason,beforeStatus:old.status,afterStatus:next.status}).slice(0,20000)}).catch(error=>console.error("tshirtPurchaseOrders audit cancel",error));
   return json({item:view(next)});
  }
  return json({error:"不支援的採購單操作"},400);
 }catch(error){console.error("tshirtPurchaseOrders",error);return json({error:"團 T 採購單處理失敗"},500)}
}});
