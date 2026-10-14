import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";

const validId=value=>typeof value==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const failure=(error,status)=>json({error},status);
const get=async(table,schoolId,id)=>{
 try{return await table.getEntity(schoolId,id)}
 catch(error){if(error.statusCode===404)return null;throw error}
};
const stockKey=request=>{
 if(request.kind==="regularUniform"&&["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"].includes(request.size))return "regular:"+request.size;
 if(request.kind==="competitionUniform"&&
   ((request.style==="男"&&["S","M","L","2L"].includes(request.size))||
    (request.style==="女"&&["XS","S","M","L"].includes(request.size))))
  return "competition:"+request.style+":"+request.size;
 return null;
};

// Inventory deduction and the one-per-request issuance ledger are one Azure Table batch.
// The request status is in another table; retry finishes that update without deducting twice.
app.http("uniformFulfillment",{
 methods:["POST"],authLevel:"anonymous",route:"uniform-events/fulfillment",
 handler:async request=>{
  const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
  if(ctx.access.role!=="admin")return failure("僅校方管理員可確認發放",403);
  try{
   const input=await request.json();
   if(!validId(input?.id)||typeof input?.etag!=="string"||input.etag.length>200||
      typeof input?.receivedBy!=="string"||!input.receivedBy.trim()||input.receivedBy.length>100||
      typeof input?.note!=="string"||!input.note.trim()||input.note.length>300)
    return failure("請填寫領取人與發放備註，並重新載入申請資料",400);
   const conn=process.env.STORAGE_CONNECTION_STRING;if(!conn)throw Error("Storage unavailable");
   const orders=TableClient.fromConnectionString(conn,"TenantUniformEventRequest");
   const inventory=TableClient.fromConnectionString(conn,"TenantUniformInventory");
   await inventory.createTable().catch(e=>{if(e.statusCode!==409)throw e});
   const schoolId=ctx.schoolId,order=await get(orders,schoolId,input.id);
   if(!order)return failure("找不到申請",404);
   const before=JSON.parse(order.payload||"{}");
   const ledgerKey="issued:"+input.id;
   const existing=await get(inventory,schoolId,ledgerKey);
   if(existing){
    if(before.status==="FULFILLED")return json({item:{...before,id:input.id,etag:order.etag},alreadyCompleted:true});
    if(before.status!=="READY_FOR_PICKUP")return failure("發放紀錄與申請進度不一致，請聯繫管理員核對",409);
   }else{
    if(input.etag!==order.etag)return failure("申請資料已更新，請重新整理後再確認",409);
    if(before.status!=="READY_FOR_PICKUP")return failure("只有可領取的申請可以確認發放",409);
    if(!["regularUniform","competitionUniform"].includes(before.kind)||before.acquisition==="RENTAL"||before.acquisition==="PENDING")
     return failure("此取得方式尚無正式發放流程，請先核對",409);
    if(before.acquisition!=="PUBLIC"&&before.paymentStatus!=="VERIFIED")
     return failure("自費申請須先完成財務核帳",409);
    const quantity=before.kind==="regularUniform"?before.quantity:1,key=stockKey(before);
    if(!key||!Number.isSafeInteger(quantity)||quantity<1||quantity>20)return failure("尺寸或件數有誤，無法發放",409);
    const stock=await get(inventory,schoolId,key);
    if(!stock)return failure("此尺寸尚未完成庫存盤點",409);
    const onHand=stock.onHand,reserved=stock.reserved??0,unavailable=stock.unavailable??0;
    if(!Number.isSafeInteger(onHand)||!Number.isSafeInteger(reserved)||!Number.isSafeInteger(unavailable)||
       onHand-reserved-unavailable<quantity)return failure("可用庫存不足，請先核對實際數量",409);
    const issuedAt=new Date().toISOString(),issuedBy=String(ctx.access.email||"admin");
    const ledger={partitionKey:schoolId,rowKey:ledgerKey,requestId:input.id,studentId:before.studentId,
     kind:before.kind,style:before.style||"",size:before.size,quantity,issuedAt,issuedBy,
     receivedBy:input.receivedBy.trim(),note:input.note.trim()};
    try{
     await inventory.submitTransaction([
      ["update",{partitionKey:schoolId,rowKey:key,onHand:onHand-quantity,reserved,unavailable},"Replace",{etag:stock.etag}],
      ["create",ledger]
     ]);
    }catch(error){
     if([409,412].includes(error.statusCode))return failure("庫存或申請已變更，請重新整理後再操作",409);
     // A network timeout can occur after the batch commits. Check its durable ledger.
     if(!await get(inventory,schoolId,ledgerKey))throw error;
    }
   }
   const issued=existing||await get(inventory,schoolId,ledgerKey);
   if(!issued)throw Error("Issuance ledger missing");
   const updated={...before,status:"FULFILLED",issuedAt:issued.issuedAt,issuedBy:issued.issuedBy,
    receivedBy:issued.receivedBy,issuedQuantity:issued.quantity,issueNote:issued.note,updatedAt:new Date().toISOString()};
   try{
    await orders.updateEntity({partitionKey:schoolId,rowKey:input.id,payload:JSON.stringify(updated),updatedAt:updated.updatedAt},"Replace",{etag:order.etag});
   }catch(error){
    if(error.statusCode===412)return failure("庫存已扣減，申請狀態待同步；請重新整理後重試發放操作（不會重複扣庫存）",409);
    throw error;
   }
   return json({item:{...updated,id:input.id},alreadyCompleted:Boolean(existing)});
  }catch(error){
   console.error("uniformFulfillment",error);
   return failure("發放結果未確認，請重新整理並核對庫存與申請；再次操作不會重複扣庫存",500);
  }
 }
});
