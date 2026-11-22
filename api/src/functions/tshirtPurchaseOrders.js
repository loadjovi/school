import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";
import {getTenantContext,getStudentAliasInfo,json} from "../lib/auth.js";
import {getStudentMaster,listUserStudentMappings} from "../lib/storage.js";
import {sendUniformRequestStatusEmail} from "../lib/email.js";
import {validatePurchaseOrderInput,tshirtPurchaseOrderSizes} from "../lib/tshirtPurchaseOrderRules.mjs";
import {normalizeReceivingDetails} from "../lib/uniformReceivingRules.mjs";
import {tshirtClaimKey} from "../lib/tshirtPurchaseOrderFlow.js";

const clean=(value,max=300)=>String(value||"").trim().slice(0,max);
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const parse=(value,fallback=[])=>{try{return JSON.parse(value||JSON.stringify(fallback))}catch{return fallback}};
const dateKey=value=>{const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return `${parts.year}${parts.month}${parts.day}`};
const reject=(message,status=409)=>{throw Object.assign(Error(message),{httpStatus:status})};
const get=async(table,school,id)=>{try{return await table.getEntity(school,id)}catch(error){if(error.statusCode===404)return null;throw error}};
const sourceTable=(clients,type)=>type==="REQUEST"?clients.requests:clients.staff;
const decode=row=>({...parse(row.payload,{}),id:row.rowKey,etag:row.etag});
const linksOf=order=>parse(order.links);
function view(entity,receipt){
 return {id:entity.rowKey,orderNumber:entity.orderNumber,schoolYear:entity.schoolYear,semester:entity.semester,status:receipt?"RECEIVED":entity.status,items:parse(entity.items),links:linksOf(entity),totalQuantity:entity.totalQuantity,pendingUnknownUnits:entity.pendingUnknownUnits||0,needUnits:entity.needUnits||0,extraUnits:entity.extraUnits||0,note:entity.note||"",createdAt:entity.createdAt,createdBy:entity.createdBy,cancelledAt:entity.cancelledAt||"",cancelledBy:entity.cancelledBy||"",cancelReason:entity.cancelReason||"",receivedAt:receipt?.receivedAt||entity.receivedAt||"",receivedDate:receipt?.receivedDate||entity.receivedDate||"",addedQuantity:receipt?.addedQuantity??entity.addedQuantity??0,creditedQuantity:receipt?.creditedQuantity??entity.creditedQuantity??0,syncPending:entity.syncPending===true||Boolean(receipt&&entity.status!=="RECEIVED"),etag:entity.etag};
}
async function tables(){
 const connection=process.env.STORAGE_CONNECTION_STRING;if(!connection)throw Error("Storage unavailable");
 const result={};
 for(const [key,name] of Object.entries({orders:"TenantTshirtPurchaseOrders",inventory:"TenantUniformInventory",requests:"TenantUniformEventRequest",staff:"TenantTshirtStaffDemand",audit:"TenantUniformEventAudit"})){
  result[key]=TableClient.fromConnectionString(connection,name);await result[key].createTable().catch(error=>{if(error.statusCode!==409)throw error});
 }
 return result;
}
const partsOf=record=>record.status==="APPROVED"?[{size:record.size,quantity:record.quantity}]:record.procurementBreakdown||[{size:record.size,quantity:record.quantity}];
function subtract(capacity,parts){
 const seen=new Set();
 for(const part of parts){if(!tshirtPurchaseOrderSizes.includes(part?.size)||seen.has(part.size)||!Number.isSafeInteger(part.quantity)||part.quantity<1||part.quantity>100||(capacity.get(part.size)||0)<part.quantity)reject("納入需求的尺碼或數量超過這張採購單，請核對明細");seen.add(part.size)}
 for(const part of parts)capacity.set(part.size,capacity.get(part.size)-part.quantity);
}
// Claims and the order snapshot commit atomically: one demand belongs to one order.
async function validateLinks(clients,schoolId,order,inputs){
 if(!Array.isArray(inputs)||inputs.length+linksOf(order).length>80)reject("單張採購單最多納入 80 筆需求",400);
 const links=linksOf(order),capacity=new Map(parse(order.items).map(x=>[x.size,x.quantity])),actions=[],seen=new Set(links.map(x=>x.type+":"+x.id));
 for(const link of links)subtract(capacity,link.parts);
 for(const input of inputs){
  if(!["REQUEST","STAFF"].includes(input?.type)||!/^[a-zA-Z0-9_-]{1,500}$/.test(String(input.id))||typeof input.etag!=="string"||seen.has(input.type+":"+input.id))reject("需求資料不完整或重複，請重新整理",400);
  const row=await get(sourceTable(clients,input.type),schoolId,input.id);if(!row||row.etag!==input.etag)reject("需求已變更，請重新整理後再整合");
  const record=decode(row),parent=input.type==="REQUEST";
  if(parent&&record.kind!=="regularUniform"||!parent&&!["CADRE_FIRST","CADRE_EXTRA","VOLUNTEER_EXTRA"].includes(record.category))reject("此筆不是團 T 採購需求");
  if(record.acquisition!=="PUBLIC"&&record.category!=="CADRE_FIRST"&&record.paymentStatus!=="VERIFIED")reject("需求尚未完成財務核帳，不可納入採購");
  if(!Number.isSafeInteger(record.quantity)||record.quantity<1||record.quantity>20)reject("需求件數異常，請核對");
  const receipt=parent?await get(clients.inventory,schoolId,"received:"+input.id):null,legacy=Boolean(receipt);
  if(legacy&&input.includeReceived!==true)reject("此申請已入庫；請明確核對後再併入，避免重複入庫");
  if(!["APPROVED","ORDERED",...(legacy?["ARRIVED","READY_FOR_PICKUP","FULFILLED"]:[])].includes(record.status))reject("需求已取消或不在可整合的階段");
  if(receipt?.purchaseOrderId&&receipt.purchaseOrderId!==order.rowKey)reject("此入庫紀錄已屬於另一張採購單");
  const key=tshirtClaimKey(input.type,input.id),claim=await get(clients.orders,schoolId,key);
  if(claim?.active||record.purchaseOrderId&&record.purchaseOrderId!==order.rowKey)reject("此筆需求已納入其他採購單，請勿重複採購");
  if(parent&&record.status!=="APPROVED"&&Number(record.procurementQuantity)>record.quantity&&!Array.isArray(record.procurementBreakdown))reject("原採購紀錄尚未分配各尺碼，請先更正採購明細");
  const parts=parent?partsOf(record):[{size:record.size,quantity:record.quantity}];
  if(!parts.some(x=>x.size===record.size&&x.quantity>=record.quantity))reject("原採購尺碼明細未分配完整，請先核對");
  if(legacy){
   if(receipt.requestId!==input.id||receipt.quantity!==record.quantity||!["new_arrival","existing_stock"].includes(receipt.source))reject("既有到貨來源或件數不明，請先核對紀錄");
   const receivedParts=parse(receipt.breakdown,[{size:receipt.size,quantity:receipt.procurementQuantity||receipt.quantity}]);
   if(JSON.stringify([...receivedParts].sort((a,b)=>a.size.localeCompare(b.size)))!==JSON.stringify([...parts].sort((a,b)=>a.size.localeCompare(b.size))))reject("既有到貨明細與申請不符，請先核對庫存");
  }
  subtract(capacity,parts);
  links.push({type:input.type,id:input.id,size:record.size,quantity:record.quantity,parts,previousStatus:record.status,legacyReceipt:legacy,legacySource:receipt?.source||"",studentId:record.studentId||"",name:parent?(await getStudentMaster(record.studentId,schoolId))?.studentName||record.studentId:record.parentName||"幹部／志工"});
  const next={partitionKey:schoolId,rowKey:key,active:true,orderId:order.rowKey,orderNumber:order.orderNumber};
  actions.push(claim?["update",next,"Replace",{etag:claim.etag}]:["create",next]);seen.add(input.type+":"+input.id);
 }
 return {links,actions};
}
async function syncOrder(clients,schoolId,order,ctx){
 const receipt=await get(clients.inventory,schoolId,"po-received:"+order.rowKey),cancelled=order.status==="CANCELLED",problems=[];
 let mappings;
 const synchronize=async link=>{try{
  const table=sourceTable(clients,link.type),row=await get(table,schoolId,link.id);if(!row)throw Error("需求已不存在");
  const before=decode(row),next={...parse(row.payload,{})};
  if(before.purchaseOrderId&&before.purchaseOrderId!==order.rowKey)throw Error("需求已改屬其他採購單");
  if(cancelled){
   if(before.purchaseOrderId===order.rowKey){next.status=link.previousStatus;delete next.purchaseOrderId;delete next.purchaseOrderNumber}
  }else{
   if(before.status==="CANCELLED")throw Error("需求已取消");
   if(before.acquisition!=="PUBLIC"&&before.category!=="CADRE_FIRST"&&before.paymentStatus!=="VERIFIED")throw Error("款項待核對");
   next.purchaseOrderId=order.rowKey;next.purchaseOrderNumber=order.orderNumber;
   if(link.type==="REQUEST"){
    if(!["READY_FOR_PICKUP","FULFILLED"].includes(before.status))next.status=receipt?"READY_FOR_PICKUP":"ORDERED";
    next.procurementBreakdown=link.parts;next.procurementQuantity=link.parts.reduce((n,x)=>n+x.quantity,0);
    if(receipt){next.stockReceivedAt=receipt.receivedAt;next.stockReceivedDate=receipt.receivedDate}
   }else if(before.status!=="FULFILLED")next.status=receipt?"ARRIVED":"ORDERED";
  }
  if(JSON.stringify(next)!==JSON.stringify(parse(row.payload,{}))){next.updatedAt=new Date().toISOString();await table.updateEntity({partitionKey:schoolId,rowKey:link.id,payload:JSON.stringify(next),updatedAt:next.updatedAt},"Replace",{etag:row.etag})}
  if(receipt&&!cancelled&&link.type==="REQUEST"&&!link.legacyReceipt&&next.status==="READY_FOR_PICKUP"){
   const noticeKey="pickup-notice:"+order.rowKey+":"+link.id,notice=await get(clients.orders,schoolId,noticeKey);
   if(notice?.status!=="sent"){
    mappings||=await listUserStudentMappings("active",schoolId);const recipients=new Set();
    for(const mapping of mappings){if(!mapping.parentEmail)continue;const alias=await getStudentAliasInfo(mapping.studentId,schoolId);if(String(alias?.canonicalStudentId||mapping.studentId)===String(next.studentId))recipients.add(mapping.parentEmail)}
    if(next.parentEmail)recipients.add(next.parentEmail);
    const result=await sendUniformRequestStatusEmail({schoolId,schoolName:ctx.tenant?.systemName||ctx.tenant?.schoolName,recipients:[...recipients],studentName:link.name,kind:"regularUniform",status:"READY_FOR_PICKUP",size:next.size,quantity:next.quantity,notificationId:`uniform-pickup:${link.id}:${receipt.receivedAt}`});
    const entity={partitionKey:schoolId,rowKey:noticeKey,status:result.status,at:new Date().toISOString()};
    if(notice)await clients.orders.updateEntity(entity,"Replace",{etag:notice.etag});else await clients.orders.createEntity(entity);
    if(result.status!=="sent")throw Error("領取通知尚未完整送達");
   }
  }
 }catch(error){problems.push({type:link.type,id:link.id,error:error.message})}};
 const queue=[...linksOf(order)];await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(queue.length)await synchronize(queue.shift())}));
 const latest=await get(clients.orders,schoolId,order.rowKey);
 const next={...latest,syncPending:problems.length>0,updatedAt:new Date().toISOString(),...(receipt?{status:"RECEIVED",receivedAt:receipt.receivedAt,receivedDate:receipt.receivedDate,addedQuantity:receipt.addedQuantity,creditedQuantity:receipt.creditedQuantity}:{})};
 await clients.orders.updateEntity(next,"Replace",{etag:latest.etag});
 return {item:view(await get(clients.orders,schoolId,order.rowKey),receipt),syncPending:problems.length>0,problems};
}
async function receiveOrder(clients,schoolId,order,input,actor){
 let ledger=await get(clients.inventory,schoolId,"po-received:"+order.rowKey);if(ledger)return ledger;
 const details=normalizeReceivingDetails(input);if(details.useExistingStock)reject("整張採購單請填實際到貨日期，不可使用現有庫存充作到貨",400);
 if(!["ORDERED","RECEIVING"].includes(order.status))reject("此採購單不可驗收到貨");
 if(order.status==="ORDERED"&&input.etag!==order.etag)reject("採購單已變更，請重新整理");
 // Validate every source before freezing links; a rejected inspection leaves the order editable.
 const add=new Map(parse(order.items).map(x=>[x.size,x.quantity])),reservations=new Map(),changes=[];let creditedQuantity=0;
 for(const link of linksOf(order)){
  const row=await get(sourceTable(clients,link.type),schoolId,link.id);if(!row)reject("部分需求已不存在，請核對後再同步");
  const record=decode(row);
  if(record.status==="CANCELLED"||record.size!==link.size||record.quantity!==link.quantity||record.acquisition!=="PUBLIC"&&record.category!=="CADRE_FIRST"&&record.paymentStatus!=="VERIFIED")reject("需求或款項已異動，請先核對");
  if(link.type!=="REQUEST")continue;
  const old=await get(clients.inventory,schoolId,"received:"+link.id),issued=await get(clients.inventory,schoolId,"issued:"+link.id);
  if(old){
   if(!link.legacyReceipt||old.purchaseOrderId&&old.purchaseOrderId!==order.rowKey)reject("需求已被另行入庫，請核對採購單");
   if(old.source==="new_arrival")for(const part of parse(old.breakdown,link.parts)){if((add.get(part.size)||0)<part.quantity)reject("已入庫數量超過採購單，請核對");add.set(part.size,add.get(part.size)-part.quantity);creditedQuantity+=part.quantity}
   const reserved=Number(old.reservedQuantity||0);if(!issued&&record.status!=="FULFILLED"&&!reserved)reservations.set(link.size,(reservations.get(link.size)||0)+link.quantity);
   changes.push(["update",{...old,purchaseOrderId:order.rowKey,reservedQuantity:!issued&&record.status!=="FULFILLED"?link.quantity:reserved},"Replace",{etag:old.etag}]);
  }else{
   if(link.legacyReceipt||issued||record.status==="FULFILLED")reject("舊申請缺少入庫紀錄，請先人工核對");
   reservations.set(link.size,(reservations.get(link.size)||0)+link.quantity);
   changes.push(["create",{partitionKey:schoolId,rowKey:"received:"+link.id,requestId:link.id,studentId:link.studentId,kind:"regularUniform",style:"",size:link.size,quantity:link.quantity,procurementQuantity:link.parts.reduce((n,x)=>n+x.quantity,0),breakdown:JSON.stringify(link.parts),receivedDate:details.receivedDate,receivedAt:"",receivedBy:actor,note:"整單驗收入庫："+order.orderNumber,source:"purchase_order",purchaseOrderId:order.rowKey,reservedQuantity:link.quantity}]);
  }
 }
 for(const [size,quantity] of add){
  const old=await get(clients.inventory,schoolId,"regular:"+size),onHand=old?.onHand??0,reserved=old?.reserved??0,unavailable=old?.unavailable??0,held=reservations.get(size)||0;
  if(![onHand,reserved,unavailable].every(x=>Number.isSafeInteger(x)&&x>=0)||onHand+quantity>100000||onHand+quantity-reserved-unavailable<held)reject("部分尺碼的庫存不足或數量異常，請核對已入庫與已發放紀錄");
  if(quantity||held){const next={partitionKey:schoolId,rowKey:"regular:"+size,onHand:onHand+quantity,reserved:reserved+held,unavailable};changes.push(old?["update",next,"Replace",{etag:old.etag}]:["create",next])}
 }
 const at=new Date().toISOString();for(const [,row] of changes)if(row.source==="purchase_order"&&!row.receivedAt)row.receivedAt=at;
 ledger={partitionKey:schoolId,rowKey:"po-received:"+order.rowKey,purchaseOrderId:order.rowKey,orderNumber:order.orderNumber,receivedAt:at,receivedDate:details.receivedDate,receivedBy:actor,note:details.note,breakdown:JSON.stringify([...add].filter(([,quantity])=>quantity).map(([size,quantity])=>({size,quantity}))),quantity:order.totalQuantity,addedQuantity:[...add.values()].reduce((n,x)=>n+x,0),creditedQuantity};
 if(order.status==="ORDERED"){
  if(input.etag!==order.etag)reject("採購單已變更，請重新整理");
  await clients.orders.updateEntity({...order,status:"RECEIVING",syncPending:true,updatedAt:new Date().toISOString()},"Replace",{etag:order.etag});
 }
 try{await clients.inventory.submitTransaction([...changes,["create",ledger]])}catch(error){const committed=await get(clients.inventory,schoolId,ledger.rowKey);if(committed)return committed;throw error}
 return ledger;
}
app.http("tshirtPurchaseOrders",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/tshirt-purchase-orders",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 if(ctx.access.role!=="admin")return json({error:"Admin only"},403);
 try{
  const clients=await tables(),schoolId=ctx.schoolId;
  if(request.method==="GET"){
   const items=[],receipts=new Map(),partition=schoolId.replaceAll("'","''");
   for await(const row of clients.inventory.listEntities({queryOptions:{filter:`PartitionKey eq '${partition}' and RowKey ge 'po-received:' and RowKey lt 'po-received;'`}}))if(String(row.rowKey).startsWith("po-received:"))receipts.set(row.rowKey.slice(12),row);
   for await(const row of clients.orders.listEntities({queryOptions:{filter:`PartitionKey eq '${partition}'`}}))if(idPattern.test(row.rowKey))items.push(view(row,receipts.get(row.rowKey)));
   return json({items:items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,100)});
  }
  const input=await request.json(),action=clean(input?.action,30),actor=clean(ctx.access.email,200),now=new Date().toISOString(),id=clean(action==="CREATE"?input.requestKey:input.id,40).toLowerCase();
  if(!idPattern.test(id))reject("採購單識別碼不正確，請重新整理",400);
  let order=await get(clients.orders,schoolId,id);
  if(action==="CREATE"){
   if(order){
    let normalized;try{normalized=validatePurchaseOrderInput(input)}catch(error){reject(error.message,400)}
    if(normalized.schoolYear!==order.schoolYear||normalized.semester!==order.semester||JSON.stringify(normalized.items)!==order.items)reject("這個識別碼已建立不同的採購單，請重新整理核對");
    return json({...await syncOrder(clients,schoolId,order,ctx),alreadyCreated:true});
   }
   let normalized;try{normalized=validatePurchaseOrderInput(input)}catch(error){reject(error.message,400)}
   const orderNumber=`T-${normalized.schoolYear}${normalized.semester}-${dateKey(now)}-${id.slice(0,6).toUpperCase()}`;
   order={partitionKey:schoolId,rowKey:id,schoolId,orderNumber,schoolYear:normalized.schoolYear,semester:normalized.semester,status:"ORDERED",items:JSON.stringify(normalized.items),totalQuantity:normalized.total,pendingUnknownUnits:normalized.pendingUnknownUnits,needUnits:Number.isSafeInteger(Number(input.needUnits))?Number(input.needUnits):0,extraUnits:Number.isSafeInteger(Number(input.extraUnits))?Number(input.extraUnits):0,note:clean(input.note),createdAt:now,createdBy:actor,updatedAt:now,syncPending:true};
   const validated=await validateLinks(clients,schoolId,order,input.links||[]);order.links=JSON.stringify(validated.links);
   await clients.orders.submitTransaction([["create",order],...validated.actions]);
  }else{
   if(!order)reject("找不到採購單",404);
   if(action==="LINK"){
    if(order.status!=="ORDERED"||input.etag!==order.etag)reject("只能整合待到貨採購單；請重新整理");
    const validated=await validateLinks(clients,schoolId,order,input.links||[]);order={...order,links:JSON.stringify(validated.links),updatedAt:now,syncPending:true};
    await clients.orders.submitTransaction([["update",order,"Replace",{etag:input.etag}],...validated.actions]);
   }else if(action==="RECEIVE"){
    if(order.status==="CANCELLED")reject("已取消採購單不可到貨");
    await receiveOrder(clients,schoolId,order,input,actor);
   }else if(action==="CANCEL"){
    if(!clean(input.reason))reject("請填寫取消原因",400);
    if(order.status!=="ORDERED"||input.etag!==order.etag||await get(clients.inventory,schoolId,"po-received:"+id))reject("只有尚未驗收的待到貨採購單可以取消");
    if(linksOf(order).some(x=>x.legacyReceipt))reject("此單已整合先前到貨紀錄，不能取消；請核對整單驗收");
    const changes=[];
    for(const link of linksOf(order)){const claim=await get(clients.orders,schoolId,tshirtClaimKey(link.type,link.id));if(!claim||claim.orderId!==id)reject("需求關聯已變更");changes.push(["update",{...claim,active:false},"Replace",{etag:claim.etag}])}
    order={...order,status:"CANCELLED",cancelledAt:now,cancelledBy:actor,cancelReason:clean(input.reason),updatedAt:now,syncPending:true};
    await clients.orders.submitTransaction([["update",order,"Replace",{etag:input.etag}],...changes]);
   }else if(action!=="SYNC")reject("不支援的採購單操作",400);
  }
  const result=await syncOrder(clients,schoolId,await get(clients.orders,schoolId,id),ctx);
  await clients.audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"tshirt.purchase_order."+action.toLowerCase(),subjectId:id,actor,at:now,details:JSON.stringify({orderNumber:order.orderNumber,totalQuantity:order.totalQuantity,status:result.item.status,links:linksOf(order).map(x=>({type:x.type,id:x.id})),syncPending:result.syncPending}).slice(0,20000)}).catch(error=>console.error("tshirtPurchaseOrders audit",error));
  return json(result,action==="CREATE"?201:200);
 }catch(error){console.error("tshirtPurchaseOrders",error);return json({error:error.httpStatus?error.message:[409,412].includes(error.statusCode)?"採購單、需求或庫存已變更，請重新整理後重試":"採購作業結果待確認，請重新整理；重試同張採購單不會重複入庫"},error.httpStatus||([409,412].includes(error.statusCode)?409:500))}
}});
