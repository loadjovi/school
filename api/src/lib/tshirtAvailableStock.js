import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";
import {tshirtClaimKey} from "./tshirtPurchaseOrderFlow.js";
import {getStudentAliasInfo} from "./auth.js";
import {getStudentMaster,listUserStudentMappings} from "./storage.js";
import {sendUniformRequestStatusEmail} from "./email.js";

const sizes=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
const get=async(table,school,id)=>{try{return await table.getEntity(school,id)}catch(error){if(error.statusCode===404)return null;throw error}};
const eligible=item=>item.kind==="regularUniform"&&item.status==="APPROVED"&&item.paymentStatus==="VERIFIED"&&!item.purchaseOrderId&&sizes.has(item.size)&&Number.isSafeInteger(item.quantity)&&item.quantity>0&&item.quantity<=20;
const decode=row=>JSON.parse(row.payload||"{}");
const validReceipt=(receipt,item,id)=>receipt?.source==="existing_stock"&&receipt.requestId===id&&receipt.kind==="regularUniform"&&receipt.size===item.size&&receipt.quantity===item.quantity&&receipt.reservedQuantity===item.quantity;

// The same claim key as procurement prevents one request being supplied twice.
// Reservation and its receipt are atomic; on-hand stock changes only at actual issue.
export async function allocateTshirtAvailableStock(schoolId,id,{actor="admin",schoolName="弦樂團"}={}){
 const connection=process.env.STORAGE_CONNECTION_STRING;
 const requests=TableClient.fromConnectionString(connection,"TenantUniformEventRequest"),inventory=TableClient.fromConnectionString(connection,"TenantUniformInventory"),claims=TableClient.fromConnectionString(connection,"TenantTshirtPurchaseOrders");
 for(const table of [inventory,claims])await table.createTable().catch(error=>{if(error.statusCode!==409)throw error});
 let row=await get(requests,schoolId,id);if(!row)return {status:"not_found"};
 let before=decode(row),receipt=await get(inventory,schoolId,"received:"+id);
 const alreadyReady=before.status==="READY_FOR_PICKUP"&&validReceipt(receipt,before,id);
 if(!eligible(before)&&!alreadyReady)return {status:"ineligible"};
 const key=tshirtClaimKey("REQUEST",id);let claim=await get(claims,schoolId,key),owned=false;
 if(claim?.active&&claim.source!=="existing_stock")return {status:"purchase_order"};
 if(receipt&&!validReceipt(receipt,before,id))return {status:"receipt_requires_review"};
 const release=async()=>{
  if(!owned)return;
  if(await get(inventory,schoolId,"received:"+id))return;
  await claims.updateEntity({...claim,active:false,leaseUntil:0},"Replace",{etag:claim.etag});
 };
 if(!receipt){
  if(claim?.active&&claim.leaseUntil>Date.now())return {status:"pending"};
  const token=randomUUID(),nextClaim={partitionKey:schoolId,rowKey:key,active:true,source:"existing_stock",orderNumber:"現有庫存",allocationToken:token,leaseUntil:Date.now()+60000};
  try{if(claim)await claims.updateEntity(nextClaim,"Replace",{etag:claim.etag});else await claims.createEntity(nextClaim)}catch(error){if([409,412].includes(error.statusCode))return {status:"pending"};throw error}
  claim=await get(claims,schoolId,key);if(claim?.allocationToken!==token)return {status:"pending"};owned=true;
  row=await get(requests,schoolId,id);const current=row&&decode(row);
  if(!current||!eligible(current)||current.size!==before.size||current.quantity!==before.quantity){await release();return {status:"ineligible"}}
  before=current;
  const stock=await get(inventory,schoolId,"regular:"+before.size),onHand=stock?.onHand,reserved=stock?.reserved??0,unavailable=stock?.unavailable??0;
  if(!stock||![onHand,reserved,unavailable].every(n=>Number.isSafeInteger(n)&&n>=0)||onHand<reserved+unavailable){await release();return {status:"stock_requires_review"}}
  if(onHand-reserved-unavailable<before.quantity){await release();return {status:"procurement_required"}}
  const at=new Date().toISOString(),receivedDate=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(at));
  const nextReceipt={partitionKey:schoolId,rowKey:"received:"+id,requestId:id,studentId:before.studentId,kind:"regularUniform",style:"",size:before.size,quantity:before.quantity,procurementQuantity:before.quantity,breakdown:JSON.stringify([{size:before.size,quantity:before.quantity}]),reservedQuantity:before.quantity,source:"existing_stock",receivedAt:at,receivedDate,receivedBy:actor,note:"核帳完成，自動保留現有庫存；實際發放時才扣除在庫數量"};
  try{await inventory.submitTransaction([["update",{partitionKey:schoolId,rowKey:stock.rowKey,onHand,reserved:reserved+before.quantity,unavailable},"Replace",{etag:stock.etag}],["create",nextReceipt]])}
  catch(error){receipt=await get(inventory,schoolId,"received:"+id);if(!receipt){await release();if([409,412].includes(error.statusCode))return {status:"pending"};throw error}}
  receipt=receipt||await get(inventory,schoolId,"received:"+id);
 }
 if(!validReceipt(receipt,before,id))return {status:"receipt_requires_review"};
 // Re-read after the inventory batch to avoid overwriting a concurrent decision.
 row=await get(requests,schoolId,id);before=decode(row);
 if(before.status!=="READY_FOR_PICKUP"){
  if(!eligible(before)||!validReceipt(receipt,before,id))return {status:"sync_pending"};
  const at=new Date().toISOString(),next={...before,status:"READY_FOR_PICKUP",stockSource:"existing_stock",stockReceivedAt:receipt.receivedAt,stockReceivedDate:receipt.receivedDate,updatedAt:at};
  try{await requests.updateEntity({partitionKey:schoolId,rowKey:id,payload:JSON.stringify(next),updatedAt:at},"Replace",{etag:row.etag})}
  catch(error){if([412,503].includes(error.statusCode))return {status:"sync_pending"};throw error}
  row=await get(requests,schoolId,id);before=decode(row);
 }
 if(before.status==="READY_FOR_PICKUP"&&receipt.pickupNoticeStatus!=="sent"){
  try{
   const recipients=new Set([before.parentEmail].filter(Boolean));
   for(const mapping of await listUserStudentMappings("active",schoolId)){
    if(!mapping.parentEmail)continue;
    const alias=await getStudentAliasInfo(mapping.studentId,schoolId);
    if(String(alias?.canonicalStudentId||mapping.studentId)===String(before.studentId))recipients.add(mapping.parentEmail);
   }
   const student=await getStudentMaster(before.studentId,schoolId);
   const result=await sendUniformRequestStatusEmail({schoolId,schoolName,recipients:[...recipients],studentName:student?.studentName||"學生",kind:"regularUniform",status:"READY_FOR_PICKUP",size:before.size,quantity:before.quantity,notificationId:`uniform-pickup:${id}:${receipt.receivedAt}`});
   const latest=await get(inventory,schoolId,receipt.rowKey);
   await inventory.updateEntity({...latest,pickupNoticeStatus:result.status,pickupNoticeAt:new Date().toISOString()},"Replace",{etag:latest.etag});
  }catch(error){console.error("tshirt stock pickup notice",error)}
 }
 return {status:"ready",item:{...before,id,etag:row.etag}};
}
export async function safeAllocateTshirtAvailableStock(schoolId,id,options){
 try{return await allocateTshirtAvailableStock(schoolId,id,options)}catch(error){console.error("tshirt available stock",error);return {status:"sync_pending"}}
}
