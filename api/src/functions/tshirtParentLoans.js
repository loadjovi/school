import {cadreActions,cadreApplication} from "../lib/tshirtCadreApplication.mjs";
import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {getStudentMaster,ensureTenantTables,table as tenantTable,tenantParentPartition} from "../lib/storage.js";
import {staffProcurement} from "../lib/tshirtStaffProcurement.js";

const sizes=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
const actions=new Set([...cadreActions,"BORROW_VOLUNTEER","CORRECT_VOLUNTEER_SIZE","MARK_WASHING","RETURN"]);
let client,audit,inventory;
async function tables(){
 const conn=process.env.STORAGE_CONNECTION_STRING;if(!conn)throw Error("Storage unavailable");
 if(!client){client=TableClient.fromConnectionString(conn,"TenantTshirtParentLoans");await client.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
 if(!audit){audit=TableClient.fromConnectionString(conn,"TenantUniformEventAudit");await audit.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
 if(!inventory){inventory=TableClient.fromConnectionString(conn,"TenantUniformInventory");await inventory.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
 return {client,audit,inventory};
}
function clean(x,n=150){return String(x||"").trim().slice(0,n)}
async function get(table,partitionKey,rowKey){try{return await table.getEntity(partitionKey,rowKey)}catch(e){if(e.statusCode===404)return null;throw e}}
function stockCounts(row){return {onHand:row?.onHand??0,reserved:row?.reserved??0,unavailable:row?.unavailable??0}}
function validCounts(value){return Object.values(value).every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)&&value.onHand-value.reserved-value.unavailable>=0}
function stockRow(schoolId,size,counts){return {partitionKey:schoolId,rowKey:"regular:"+size,...counts}}
function ledgerKey(email){return "tshirt-loan:"+Buffer.from(email).toString("base64url")}
function transactionAction(row,next){return row?["update",next,"Replace",{etag:row.etag}]:["create",next]}
function conflict(message){const error=Error(message);error.statusCode=409;return error}
async function submitStock(inventory,operations){
 try{await inventory.submitTransaction(operations)}
 catch(e){if([409,412].includes(e.statusCode))throw conflict("庫存或借用紀錄已變更，請重新整理後再試");throw e}
}
// The per-parent ledger and the size stock row live in one Azure Table
// partition. Updating them in one transaction makes retries unable to borrow
// or return the same physical shirt twice.
async function mutateVolunteerStock({inventory,schoolId,email,action,size,oldSize,now}){
 const key=ledgerKey(email),ledger=await get(inventory,schoolId,key);
 if(action==="BORROW_VOLUNTEER"){
  if(ledger?.status==="BORROWED"){
   if(ledger.size!==size)throw conflict("此志工已有不同尺寸的借用庫存紀錄，請先核對");
   return {applied:false,idempotent:true,operation:"BORROW",size};
  }
  if(ledger&&ledger.status!=="RETURNED")throw conflict("此志工的借用庫存狀態異常，請先核對");
  const stock=await get(inventory,schoolId,"regular:"+size),before=stockCounts(stock);
  if(!stock||!validCounts(before)||before.onHand-before.reserved-before.unavailable<1)throw conflict(size+" 尺寸目前沒有可借用庫存");
  const after={...before,onHand:before.onHand-1};
  const nextLedger={partitionKey:schoolId,rowKey:key,kind:"tshirtVolunteerLoan",parentEmail:email,size,status:"BORROWED",borrowedAt:now,returnedAt:"",updatedAt:now};
  await submitStock(inventory,[["update",stockRow(schoolId,size,after),"Replace",{etag:stock.etag}],transactionAction(ledger,nextLedger)]);
  return {applied:true,operation:"BORROW",size,before,after};
 }
 if(action==="RETURN"){
  if(ledger?.status==="RETURNED"){
   if(ledger.size!==size)throw conflict("歸還尺寸與借用庫存紀錄不一致，請先核對");
   return {applied:false,idempotent:true,operation:"RETURN",size};
  }
  if(ledger&&ledger.status!=="BORROWED")throw conflict("此志工的借用庫存狀態異常，請先核對");
  if(ledger&&ledger.size!==size)throw conflict("歸還尺寸與借用庫存紀錄不一致，請先核對");
  const stock=await get(inventory,schoolId,"regular:"+size),before=stockCounts(stock),after={...before,onHand:before.onHand+1};
  if(!validCounts(before)||!validCounts(after))throw conflict("庫存數量異常，請先核對");
  const nextLedger={partitionKey:schoolId,rowKey:key,kind:"tshirtVolunteerLoan",parentEmail:email,size,status:"RETURNED",borrowedAt:ledger?.borrowedAt||"",returnedAt:now,updatedAt:now,legacyLoan:!ledger};
  await submitStock(inventory,[transactionAction(stock,stockRow(schoolId,size,after)),transactionAction(ledger,nextLedger)]);
  return {applied:true,operation:"RETURN",size,before,after,legacyLoan:!ledger};
 }
 if(action==="CORRECT_VOLUNTEER_SIZE"){
  if(!ledger)return {applied:false,tracked:false,operation:"CORRECT_SIZE",from:oldSize,to:size};
  if(ledger.status!=="BORROWED")throw conflict("此志工的借用庫存狀態異常，請先核對");
  if(ledger.size===size)return {applied:false,idempotent:true,operation:"CORRECT_SIZE",from:oldSize,to:size};
  if(ledger.size!==oldSize)throw conflict("借用尺寸已變更，請重新整理後再試");
  const oldStock=await get(inventory,schoolId,"regular:"+oldSize),newStock=await get(inventory,schoolId,"regular:"+size);
  const oldBefore=stockCounts(oldStock),newBefore=stockCounts(newStock);
  if(!oldStock||!validCounts(oldBefore)||oldBefore.onHand>=100000)throw conflict("原尺寸庫存數量異常，請先核對");
  if(!newStock||!validCounts(newBefore)||newBefore.onHand-newBefore.reserved-newBefore.unavailable<1)throw conflict(size+" 尺寸目前沒有可借用庫存");
  const oldAfter={...oldBefore,onHand:oldBefore.onHand+1},newAfter={...newBefore,onHand:newBefore.onHand-1};
  const nextLedger={partitionKey:schoolId,rowKey:key,kind:"tshirtVolunteerLoan",parentEmail:email,size,status:"BORROWED",borrowedAt:ledger.borrowedAt||now,returnedAt:"",updatedAt:now};
  await submitStock(inventory,[["update",stockRow(schoolId,oldSize,oldAfter),"Replace",{etag:oldStock.etag}],["update",stockRow(schoolId,size,newAfter),"Replace",{etag:newStock.etag}],["update",nextLedger,"Replace",{etag:ledger.etag}]]);
  return {applied:true,operation:"CORRECT_SIZE",from:oldSize,to:size,oldBefore,oldAfter,newBefore,newAfter};
 }
 return null;
}
async function linked(schoolId,email,studentId){
 await ensureTenantTables();
 try{
  const e=await tenantTable("tenantUserStudentMap").getEntity(tenantParentPartition(schoolId,email),studentId);
  return e.status==="active"&&!!await getStudentMaster(studentId,schoolId);
 }catch(e){if(e.statusCode===404)return false;throw e}
}
app.http("tshirtParentLoans",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/parent-loans",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 if(ctx.access.role!=="admin")return json({error:"Admin only"},403);
 try{
  const {client,audit,inventory}=await tables(),schoolId=ctx.schoolId;
  if(request.method==="GET"&&request.query.get("view")==="procurement")return staffProcurement(request,ctx,{loanClient:client,audit,linked});
  if(request.method==="GET"){
   const items=[];for await(const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
    items.push({parentEmail:e.rowKey,parentName:e.parentName,studentId:e.studentId,role:e.role,size:e.size,status:e.status,issuedAt:e.issuedAt,returnedAt:e.returnedAt,requestedAt:e.requestedAt,schoolYear:e.schoolYear,semester:e.semester,correctionReason:e.correctionReason,etag:e.etag});
   }
   return json({items});
  }
  const data=await request.json();
  if(["ADD_DEMAND","UPDATE_DEMAND_STATUS","VERIFY_DEMAND_PAYMENT"].includes(data?.action))return staffProcurement(request,ctx,{loanClient:client,audit,linked:async(s,e,id)=>{if(!await linked(s,e,id))return false;const student=await getStudentMaster(id,s);return String(student?.status||"active").toLowerCase()==="active"},data});
  const email=clean(data.parentEmail,320).toLowerCase(),studentId=clean(data.studentId,40),action=clean(data.action,40);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{6}$/.test(studentId)||!actions.has(action))return json({error:"Invalid parent, student or action"},400);
  if(!await linked(schoolId,email,studentId))return json({error:"Parent is not actively linked to this student"},403);
  let old;try{old=await client.getEntity(schoolId,email)}catch(e){if(e.statusCode!==404)throw e}
  const previous=old?{parentName:old.parentName,studentId:old.studentId,role:old.role,size:old.size,status:old.status,issuedAt:old.issuedAt,returnedAt:old.returnedAt,requestedAt:old.requestedAt||"",schoolYear:old.schoolYear||0,semester:old.semester||0,previousIssuedAt:old.previousIssuedAt||"",correctionReason:old.correctionReason||""}:null;
  if(old&&data.etag!==old.etag)return json({error:"Record changed; refresh and retry"},409);
  if(!old&&data.etag)return json({error:"Record changed; refresh and retry"},409);
  const now=new Date().toISOString(),name=clean(data.parentName,80),size=clean(data.size,10);
  let next,stockResult=null;
  if(cadreActions.has(action)){
   try{next=cadreApplication(previous,{action,size,parentName:name,studentId,reason:data.reason},now)}
   catch(e){return json({error:e.message},e.statusCode||400)}
  }else if(action==="BORROW_VOLUNTEER"){
   if(!sizes.has(size)||!name)return json({error:"Parent name and size required"},400);
   if(old&&old.status!=="RETURNED")return json({error:"Parent has an active loan or lifetime issued shirt"},409);
   next={parentName:name,studentId,role:"VOLUNTEER",size,status:"BORROWED",issuedAt:now,returnedAt:""};
  }else if(action==="CORRECT_VOLUNTEER_SIZE"){
   if(!old||old.role!=="VOLUNTEER"||!["BORROWED","WASHING"].includes(old.status))return json({error:"Only an active volunteer loan may be corrected"},409);
   const reason=clean(data.reason,300);
   if(!sizes.has(size)||!reason)return json({error:"Correct size and an audit reason are required"},400);
   if(size===old.size)return json({error:"Size is unchanged"},400);
   // Keep original issuance date, student, and status unchanged. Only correct the size.
   next={...previous,size,correctionReason:reason};
  }else{
   if(!old||old.role!=="VOLUNTEER")return json({error:"Volunteer loan not found"},409);
   if(action==="MARK_WASHING"&&old.status!=="BORROWED")return json({error:"Only borrowed shirts can be marked washing"},409);
   if(action==="RETURN"&&!["BORROWED","WASHING"].includes(old.status))return json({error:"Only an active volunteer loan can be returned"},409);
   next={...previous,status:action==="MARK_WASHING"?"WASHING":"RETURNED",returnedAt:action==="RETURN"?now:""};
  }
  if(["BORROW_VOLUNTEER","CORRECT_VOLUNTEER_SIZE","RETURN"].includes(action)){
   try{stockResult=await mutateVolunteerStock({inventory,schoolId,email,action,size:next.size,oldSize:previous?.size,now})}
   catch(e){if(e.statusCode===409)return json({error:e.message},409);throw e}
  }
  await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"tshirt.parent."+action,subjectId:email,actor:clean(ctx.access.email,200),at:now,details:JSON.stringify({studentId,before:previous,after:next,stock:stockResult}).slice(0,20000)});
  const entity={partitionKey:schoolId,rowKey:email,...next,updatedAt:now};
  try{if(old)await client.updateEntity(entity,"Replace",{etag:old.etag});else await client.createEntity(entity)}
  catch(e){if([409,412].includes(e.statusCode))return json({error:"Record changed; refresh and retry"},409);throw e}
  return json({item:{parentEmail:email,...next},stock:stockResult});
 }catch(e){console.error("tshirtParentLoans",e);return json({error:"Parent T-shirt operation failed"},500)}
}});
