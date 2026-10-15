import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,getStudentAliasInfo,json} from "../lib/auth.js";
import {getStudentMaster,listUserStudentMappings} from "../lib/storage.js";
import {sendUniformRequestStatusEmail} from "../lib/email.js";

const fail=(error,status=400)=>json({error},status);
const validId=value=>typeof value==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
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
    if(String(row.rowKey).startsWith("received:"))items.push({requestId:row.requestId,quantity:row.quantity,receivedAt:row.receivedAt,receivedBy:row.receivedBy});
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
  const quantity=before.kind==="regularUniform"?before.quantity:1,key=stockKey(before);
  if(!key||!Number.isSafeInteger(quantity)||quantity<1||quantity>20||input.quantity!==quantity)return fail("入庫件數須與此申請的款式、尺寸及件數一致",409);
  const ledgerKey="received:"+input.id;
  let ledger=await get(inventory,schoolId,ledgerKey);
  if(!ledger){
   if(input.etag!==order.etag)return fail("申請資料已更新，請重新整理後再入庫",409);
   const stock=await get(inventory,schoolId,key);
   const onHand=stock?.onHand??0,reserved=stock?.reserved??0,unavailable=stock?.unavailable??0;
   if(![onHand,reserved,unavailable].every(n=>Number.isSafeInteger(n)&&n>=0)||onHand+quantity>100000)return fail("庫存數量有誤，請先核對盤點資料",409);
   if(input.useExistingStock===true&&onHand-reserved-unavailable<quantity)return fail("此款式尺寸的現有可用庫存不足，請先核對盤點數量",409);
   const stamp=new Date().toISOString();
   const receipt={partitionKey:schoolId,rowKey:ledgerKey,requestId:input.id,studentId:before.studentId,kind:before.kind,
    style:before.style||"",size:before.size,quantity,receivedDate:input.receivedDate,receivedAt:stamp,
    receivedBy:String(ctx.access.email||"admin"),note:input.note.trim(),source:input.useExistingStock===true?"existing_stock":"new_arrival"};
   const nextStock={partitionKey:schoolId,rowKey:key,onHand:onHand+quantity,reserved,unavailable};
   try{
    await inventory.submitTransaction(input.useExistingStock===true
     ?[["create",receipt]]
     :[stock?["update",nextStock,"Replace",{etag:stock.etag}]:["create",nextStock],["create",receipt]]);
   }catch(error){
    if([409,412].includes(error.statusCode))return fail("庫存或此申請的入庫紀錄已變更，請重新整理後再試",409);
    ledger=await get(inventory,schoolId,ledgerKey);if(!ledger)throw error;
   }
   ledger=ledger||await get(inventory,schoolId,ledgerKey);
  }
  if(!ledger||ledger.requestId!==input.id||ledger.quantity!==quantity)return fail("入庫紀錄與申請不一致，請人工核對",409);
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
   return json({item:{...next,id:input.id},quantity,notificationStatus});
  }
  return json({item:{...before,id:input.id},quantity,alreadyReceived:true});
 }catch(error){console.error("uniformReceiving",error);return fail("入庫結果未確認，請重新整理核對申請與庫存，再重試（不會重複入庫）",500)}
}});
