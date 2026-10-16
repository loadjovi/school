import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,getStudentAliasInfo,json} from "../lib/auth.js";
import {getStudentMaster,listUserStudentMappings} from "../lib/storage.js";
import {sendUniformRequestStatusEmail} from "../lib/email.js";

const fail=(error,status=400)=>json({error},status);
const validId=value=>typeof value==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const regularSizes=new Set(["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"]);
function validBreakdown(parts,order,total){
 if(!Array.isArray(parts)||!parts.length||parts.length>regularSizes.size)return false;
 const seen=new Set();let sum=0,parent=0;
 for(const part of parts){
  if(!part||!regularSizes.has(part.size)||seen.has(part.size)||!Number.isSafeInteger(part.quantity)||part.quantity<1||part.quantity>100)return false;
  seen.add(part.size);sum+=part.quantity;if(part.size===order.size)parent=part.quantity;
 }
 return sum===total&&parent>=order.quantity;
}
function sameBreakdown(left,right){
 if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length)return false;
 const bySize=parts=>[...parts].sort((a,b)=>String(a?.size).localeCompare(String(b?.size)));
 const actual=bySize(left),expected=bySize(right);
 return actual.every((x,i)=>x?.size===expected[i]?.size&&x?.quantity===expected[i]?.quantity);
}
async function get(table,schoolId,id){try{return await table.getEntity(schoolId,id)}catch(error){if(error.statusCode===404)return null;throw error}}
function stockKey(order){
 if(order.kind==="regularUniform"&&["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"].includes(order.size))return "regular:"+order.size;
 if(order.kind==="competitionUniform"&&((order.style==="男"&&["S","M","L","2L"].includes(order.size))||(order.style==="女"&&["XS","S","M","L"].includes(order.size))))return "competition:"+order.style+":"+order.size;
 return null;
}

// The stock row and per-request receipt ledger commit in one Table batch.
// If the later request update fails, the same request can safely finish without adding stock twice.
app.http("uniformReceiving",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/receiving",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 if(ctx.access.role!=="admin")return fail("僅校方管理員可辦理入庫",403);
 try{
  const conn=process.env.STORAGE_CONNECTION_STRING;if(!conn)throw Error("Storage unavailable");
  const inventory=TableClient.fromConnectionString(conn,"TenantUniformInventory");
  await inventory.createTable().catch(error=>{if(error.statusCode!==409)throw error});
  const schoolId=ctx.schoolId;
  if(request.method==="GET"){
   const items=[];
   for await(const row of inventory.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
    if(String(row.rowKey).startsWith("received:"))items.push({requestId:row.requestId,quantity:row.quantity,procurementQuantity:row.procurementQuantity||row.quantity,receivedAt:row.receivedAt,receivedBy:row.receivedBy});
   }
   return json({items});
  }
  const input=await request.json();
  if(!validId(input?.id)||typeof input.etag!=="string"||input.etag.length>200||
   typeof input.note!=="string"||!input.note.trim()||input.note.length>300||
   typeof input.receivedDate!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.receivedDate)||
   !Number.isFinite(Date.parse(input.receivedDate)))return fail("請填寫實際到貨日期與驗收備註，並重新載入申請資料");
  const orders=TableClient.fromConnectionString(conn,"TenantUniformEventRequest");
  const order=await get(orders,schoolId,input.id);if(!order)return fail("找不到申請",404);
  const before=JSON.parse(order.payload||"{}");
  if(!["regularUniform","competitionUniform"].includes(before.kind)||!["ORDERED","ARRIVED","READY_FOR_PICKUP"].includes(before.status))return fail("僅可將已採購或舊有已到貨申請辦理入庫",409);
  if(before.acquisition!=="PUBLIC"&&before.paymentStatus!=="VERIFIED")return fail("自費申請須先完成財務核帳，才可驗收到貨並入庫",409);
  const quantity=before.kind==="regularUniform"?before.quantity:1,key=stockKey(before);
  const procurementQuantity=before.kind==="regularUniform"?(before.procurementQuantity??quantity):1;
  if(!key||!Number.isSafeInteger(quantity)||quantity<1||quantity>20||!Number.isSafeInteger(procurementQuantity)||procurementQuantity<quantity||procurementQuantity>100||input.quantity!==quantity||input.procurementQuantity!==undefined&&input.procurementQuantity!==procurementQuantity)return fail("入庫件數與申請或採購紀錄不一致，請重新整理",409);
  const breakdown=before.kind==="regularUniform"?(before.procurementBreakdown||procurementQuantity===quantity&&[{size:before.size,quantity}]):[{size:before.size,quantity:1}];
  const ledgerKey="received:"+input.id;
  let ledger=await get(inventory,schoolId,ledgerKey);
  if(!ledger){
   if(before.kind==="regularUniform"&&!validBreakdown(breakdown,before,procurementQuantity))return fail("舊採購紀錄尚未分配各尺碼，請先使用『更正採購尺碼』填寫廠商採購明細",409);
   if(!sameBreakdown(input.receivedBreakdown,breakdown))return fail("實際到貨的各尺碼件數須與採購明細一致；若有差異，請先更正採購尺碼再驗收",409);
   if(input.etag!==order.etag)return fail("申請資料已更新，請重新整理後再入庫",409);
   const changes=[];
   for(const part of breakdown){
    const sizeKey=before.kind==="regularUniform"?"regular:"+part.size:key;
    const stock=await get(inventory,schoolId,sizeKey);
    const onHand=stock?.onHand??0,reserved=stock?.reserved??0,unavailable=stock?.unavailable??0;
    if(![onHand,reserved,unavailable].every(n=>Number.isSafeInteger(n)&&n>=0)||onHand+(input.useExistingStock===true?0:part.quantity)>100000)return fail("庫存數量有誤，請先核對盤點資料",409);
    if(input.useExistingStock===true&&onHand-reserved-unavailable<part.quantity)return fail("部分尺碼的現有可用庫存不足，請先核對盤點數量",409);
    if(input.useExistingStock!==true){
     const next={partitionKey:schoolId,rowKey:sizeKey,onHand:onHand+part.quantity,reserved,unavailable};
     changes.push(stock?["update",next,"Replace",{etag:stock.etag}]:["create",next]);
    }
   }
   const stamp=new Date().toISOString();
   const receipt={partitionKey:schoolId,rowKey:ledgerKey,requestId:input.id,studentId:before.studentId,kind:before.kind,
    style:before.style||"",size:before.size,quantity,procurementQuantity,receivedDate:input.receivedDate,receivedAt:stamp,
    breakdown:JSON.stringify(breakdown),receivedBy:String(ctx.access.email||"admin"),note:input.note.trim(),source:input.useExistingStock===true?"existing_stock":"new_arrival"};
   try{
    await inventory.submitTransaction([...changes,["create",receipt]]);
   }catch(error){
    if([409,412].includes(error.statusCode))return fail("庫存或此申請的入庫紀錄已變更，請重新整理後再試",409);
    ledger=await get(inventory,schoolId,ledgerKey);if(!ledger)throw error;
   }
   ledger=ledger||await get(inventory,schoolId,ledgerKey);
  }
  if(!ledger||ledger.requestId!==input.id||ledger.quantity!==quantity||(ledger.procurementQuantity||ledger.quantity)!==procurementQuantity||ledger.breakdown&&(!Array.isArray(breakdown)||!sameBreakdown(JSON.parse(ledger.breakdown),breakdown)))return fail("入庫紀錄與申請或採購尺碼不一致，請人工核對",409);
  if(before.status==="ORDERED"||!before.stockReceivedAt){
   const stamp=new Date().toISOString();
   const next={...before,status:before.status==="ORDERED"?"ARRIVED":before.status,stockReceivedAt:ledger.receivedAt,stockReceivedDate:ledger.receivedDate,updatedAt:stamp};
   try{await orders.updateEntity({partitionKey:schoolId,rowKey:input.id,payload:JSON.stringify(next),updatedAt:stamp},"Replace",{etag:order.etag})}
   catch(error){if(error.statusCode===412)return fail("已入庫但申請進度未同步；請重新整理並再按一次入庫（不會重複增加庫存）",409);throw error}
   let notificationStatus="not_attempted";
   if(before.status==="ORDERED")try{
    const mappings=await listUserStudentMappings("active",schoolId),recipients=new Set();
    for(const mapping of mappings){
     if(!mapping.parentEmail)continue;
     const alias=await getStudentAliasInfo(mapping.studentId,schoolId).catch(()=>null);
     if(String(alias?.canonicalStudentId||mapping.studentId)===String(next.studentId))recipients.add(mapping.parentEmail);
    }
    const student=await getStudentMaster(next.studentId,schoolId);
    const result=await sendUniformRequestStatusEmail({recipients:[...recipients],studentName:student?.studentName||"學生",kind:next.kind,status:"ARRIVED",size:next.size,quantity:next.quantity});
    notificationStatus=result.status;
   }catch(error){notificationStatus="failed";console.error("uniform receiving notification",error)}
   return json({item:{...next,id:input.id},quantity,procurementQuantity,notificationStatus});
  }
  return json({item:{...before,id:input.id},quantity,procurementQuantity,alreadyReceived:true});
 }catch(error){console.error("uniformReceiving",error);return fail("入庫結果未確認，請重新整理核對申請與庫存，再重試（不會重複入庫）",500)}
}});
