import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";

const fail=(error,status=400)=>json({error},status);
const validId=value=>typeof value==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const get=async(table,schoolId,key)=>{try{return await table.getEntity(schoolId,key)}catch(error){if(error.statusCode===404)return null;throw error}};

// For one-to-one competition uniforms delivered immediately on arrival.
// The issuance ledger records both arrival and handover, without touching stock.
app.http("competitionDirectIssue",{
 methods:["POST"],authLevel:"anonymous",route:"uniform-events/competition-direct-issue",
 handler:async request=>{
  const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
  if(ctx.access.role!=="admin")return fail("僅校方管理員可確認到貨與交付",403);
  try{
   const input=await request.json();
   if(!validId(input?.id)||typeof input.etag!=="string"||input.etag.length>200||
      typeof input.receivedDate!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.receivedDate)||
      !Number.isFinite(Date.parse(input.receivedDate))||
      typeof input.receivedBy!=="string"||!input.receivedBy.trim()||input.receivedBy.length>100||
      typeof input.note!=="string"||!input.note.trim()||input.note.length>300)
    return fail("請填寫到貨日期、實際領取人及驗收交付備註，並重新載入申請資料",400);
   const conn=process.env.STORAGE_CONNECTION_STRING;if(!conn)throw Error("Storage unavailable");
   const schoolId=ctx.schoolId,orders=TableClient.fromConnectionString(conn,"TenantUniformEventRequest"),inventory=TableClient.fromConnectionString(conn,"TenantUniformInventory");
   await inventory.createTable().catch(error=>{if(error.statusCode!==409)throw error});
   const order=await get(orders,schoolId,input.id);if(!order)return fail("找不到申請",404);
   const before=JSON.parse(order.payload||"{}");
   if(before.kind!=="competitionUniform"||before.status!=="ORDERED"&&before.status!=="FULFILLED")return fail("僅可將已採購的 A 團比賽服直接交付",409);
   if(!["PUBLIC","PURCHASE"].includes(before.acquisition))return fail("請先確認此筆比賽服的取得方式",409);
   if(before.acquisition==="PURCHASE"&&before.paymentStatus!=="VERIFIED")return fail("買斷申請須先完成財務核帳，才可交付",409);
   const issuedKey="issued:"+input.id,issued=await get(inventory,schoolId,issuedKey);
   if(before.status==="FULFILLED"){
    if(issued?.source==="direct_arrival")return json({item:{...before,id:input.id,etag:order.etag},alreadyCompleted:true});
    return fail("這筆申請已有其他發放紀錄，請重新整理",409);
   }
   if(issued&&issued.source!=="direct_arrival")return fail("已有其他發放紀錄，請先核對",409);
   if(!issued){
    if(input.etag!==order.etag)return fail("申請資料已更新，請重新整理後再確認",409);
    if(await get(inventory,schoolId,"received:"+input.id))return fail("此筆已辦理正式入庫，請使用原本的庫存發放流程",409);
    const now=new Date().toISOString();
    const ledger={partitionKey:schoolId,rowKey:issuedKey,requestId:input.id,studentId:before.studentId,
     kind:before.kind,style:before.style||"",size:before.size,quantity:1,
     source:"direct_arrival",receivedDate:input.receivedDate,receivedAt:now,
     issuedAt:now,issuedBy:String(ctx.access.email||"admin"),receivedBy:input.receivedBy.trim(),note:input.note.trim()};
    try{await inventory.createEntity(ledger)}catch(error){
     if(error.statusCode===409)return fail("此筆已有人確認交付，請重新整理",409);
     if(!await get(inventory,schoolId,issuedKey))throw error;
    }
   }
   const record=issued||await get(inventory,schoolId,issuedKey);
   if(record?.source!=="direct_arrival"||record.requestId!==input.id||record.studentId!==before.studentId||record.quantity!==1)
    return fail("交付紀錄與申請不符，請人工核對",409);
   const updatedAt=new Date().toISOString();
   const next={...before,status:"FULFILLED",stockReceivedAt:record.receivedAt,stockReceivedDate:record.receivedDate,
    issuedAt:record.issuedAt,issuedBy:record.issuedBy,receivedBy:record.receivedBy,
    issuedQuantity:1,issueNote:record.note,fulfillmentSource:"direct_arrival",updatedAt};
   try{await orders.updateEntity({partitionKey:schoolId,rowKey:input.id,payload:JSON.stringify(next),updatedAt},"Replace",{etag:order.etag})}
   catch(error){if(error.statusCode===412)return fail("交付紀錄已建立，申請狀態待同步；請重新整理後重試，不會重複發放或異動庫存",409);throw error}
   return json({item:{...next,id:input.id},alreadyCompleted:Boolean(issued)});
  }catch(error){console.error("competitionDirectIssue",error);return fail("交付結果未確認，請重新整理查核申請紀錄後再試（不會異動庫存）",500)}
 }
});
