import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { getTenantContext, ensureStudentAccess, json } from "../lib/auth.js";
import { getStudentMaster } from "../lib/storage.js";
import { isFirstTshirtHandoffEligible, buildSchoolHandoffPayload, isFirstTshirtReceiptEligible, buildFirstReceiptPayload } from "../lib/tshirtReceiptRules.mjs";

const SIZES=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
const validId=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const clients=new Map();
async function table(name){
 const conn=process.env.STORAGE_CONNECTION_STRING;if(!conn)throw Error("Storage unavailable");
 if(!clients.has(name)){const c=TableClient.fromConnectionString(conn,name);await c.createTable().catch(e=>{if(e.statusCode!==409)throw e});clients.set(name,c)}
 return clients.get(name);
}
const fail=(message,status=400)=>json({error:message},status);
async function get(t,schoolId,id){try{return await t.getEntity(schoolId,id)}catch(e){if(e.statusCode===404)return null;throw e}}
const parse=r=>({...JSON.parse(r.payload||"{}"),studentId:r.rowKey,etag:r.etag});
// The family confirmed this receipt grade on 2026-10-14; other grades require explicit records.
const confirmedReceiptGrade={"sacred-heart":{"112068":"3"}};
function historicalStudentInfo(student,schoolId,studentId,existing){
 const saved=existing?.receivedGrade;
 return {groupName:student.groupName||student.group||"",receivedGrade:saved||confirmedReceiptGrade[schoolId]?.[studentId]||null};
}
const group=student=>String(student?.groupName||student?.group||"").trim().toUpperCase().replace(/\s/g,"").replace(/團$/,"");
const activeStudent=student=>["A","B","C","儲備"].includes(group(student));
const historicallyIssued=student=>["A","B"].includes(group(student))&&String(student?.studentName||"").replace(/\s+/g,"")!=="李沛臻";
async function audit(schoolId,actor,action,studentId,details){
 const t=await table("TenantUniformEventAudit");
 await t.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action,subjectId:studentId,actor:String(actor||"unknown").slice(0,200),at:new Date().toISOString(),details:JSON.stringify(details)});
}
app.http("tshirtHistoricalSize",{
 methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"uniform-events/tshirt-historical-size",
 handler:async request=>{
  const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
  const {schoolId,access}=ctx;
  if(!["parent","admin"].includes(access.role))return fail("Forbidden",403);
  try{
   if(access.role==="parent"){
    const configs=await table(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
    const config=await get(configs,schoolId,"regularUniform:default");
    if(!config||JSON.parse(config.payload||"{}").enabled!==true)return fail("團 T 模組目前未啟用",403);
   }
   const t=await table("TenantTshirtHistoricalIssue");
   if(request.method==="GET"){
    const items=[];
    if(access.role==="parent"){
     for(const linked of access.students||[]){
      const id=String(linked?.studentId||"");
      if(!validId(id)||!ensureStudentAccess(access,id))continue;
      const student=await getStudentMaster(id,schoolId);
      if(!student||!activeStudent(student))continue;
      const existing=await get(t,schoolId,id);
      const record=existing?parse(existing):null;
      items.push(record?{...record,studentName:student.studentName,...historicalStudentInfo(student,schoolId,id,record)}:{studentId:id,studentName:student.studentName,...historicalStudentInfo(student,schoolId,id),historicalIssued:historicallyIssued(student),issuedQuantity:historicallyIssued(student)?1:0,size:null,sizeStatus:"PENDING_PARENT",autoBackfill:historicallyIssued(student)});
     }
    }else{
     for await(const row of t.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}}))items.push(parse(row));
    }
    return json({items});
   }
   const body=await request.json().catch(()=>null);
   if(!body||!validId(body.studentId))return fail("Invalid student");
   const student=await getStudentMaster(body.studentId,schoolId);
   if(!student)return fail("Student not found",404);
   if(request.method==="POST"){
    if(access.role!=="admin")return fail("Admin only",403);
    if(body.confirmedIssued!==true||!Number.isSafeInteger(body.quantity)||body.quantity<1||body.quantity>20)return fail("Explicit issuance confirmation and quantity required");
    const previous=await get(t,schoolId,body.studentId);
    if(previous){
     const old=parse(previous);
     if(old.source!=="PARENT_SIZE_SURVEY"||old.schoolIssuedAt)return fail("已有領用紀錄或學校已交付，請勿重複核發",409);
     const now=new Date().toISOString();
     const payload={...JSON.parse(previous.payload),historicalIssued:true,issuedQuantity:body.quantity,source:"ADMIN_VERIFIED_HISTORICAL",verifiedBy:access.email,verifiedAt:now,updatedAt:now};
     await t.updateEntity({partitionKey:schoolId,rowKey:body.studentId,payload:JSON.stringify(payload),updatedAt:now},"Replace",{etag:previous.etag});
     await audit(schoolId,access.email,"tshirt.history.verify",body.studentId,{quantity:body.quantity,previousSize:old.size||null});
     return json({item:{...payload,studentId:body.studentId}});
    }
    const now=new Date().toISOString();
    const payload={kind:"regularUniform",historicalIssued:true,issuedQuantity:body.quantity,size:null,sizeStatus:"PENDING_PARENT",source:"ADMIN_VERIFIED_HISTORICAL",verifiedBy:access.email,verifiedAt:now,createdAt:now,updatedAt:now};
    await audit(schoolId,access.email,"tshirt.history.verify",body.studentId,{quantity:body.quantity});
    try{await t.createEntity({partitionKey:schoolId,rowKey:body.studentId,payload:JSON.stringify(payload),updatedAt:now})}
    catch(e){if(e.statusCode===409)return fail("Historical issuance already exists",409);throw e}
    return json({item:{...payload,studentId:body.studentId}},201);
   }
   if(!ensureStudentAccess(access,body.studentId)&&access.role!=="admin")return fail("Forbidden",403);
   // An admin records a real, single-piece school handoff; the parent then
   // acknowledges receipt. This stage does not consume the free eligibility yet.
   if(body.action==="SCHOOL_CONFIRM_HANDOFF"){
    if(access.role!=="admin"||!activeStudent(student))return fail("僅學校管理員可確認團 T 發放",403);
    const row=await get(t,schoolId,body.studentId);
    if(!row)return fail("學生尚未登記團 T 尺寸",409);
    const previous=parse(row);
    if(body.etag!==row.etag)return fail("資料已更新，請重新整理後再操作",409);
    if(!isFirstTshirtHandoffEligible(previous))return fail("尚未登記尺寸、已交付或已有首次領用紀錄",409);
    if(body.confirmedIssued!==true||body.issuedSize!==previous.size||body.quantity!==1)return fail("請確認實際交付尺寸及數量 1 件",400);
    const recipient=String(body.handoffTo||"").trim();
    if(!recipient||recipient.length>100)return fail("請填寫實際交付對象（100 字內）",400);
    const now=new Date().toISOString();
    const next=buildSchoolHandoffPayload(JSON.parse(row.payload),access.email,now,recipient);
    try{await t.updateEntity({partitionKey:schoolId,rowKey:body.studentId,payload:JSON.stringify(next),updatedAt:now},"Replace",{etag:row.etag})}
    catch(e){if(e.statusCode===412)return fail("資料已更新，請重新整理後再操作",409);throw e}
    await audit(schoolId,access.email,"tshirt.first.public.school.handoff",body.studentId,{size:previous.size,quantity:1,handoffTo:recipient,schoolIssuedAt:now});
    return json({item:{...next,studentId:body.studentId}});
   }
   // Parents confirm only a physical first-time handover after saving the size.
   // This changes the canonical eligibility record; it does not fabricate inventory movements.
   if(body.action==="CONFIRM_FIRST_RECEIPT"){
    if(access.role!=="parent"||!ensureStudentAccess(access,body.studentId)||!activeStudent(student))return fail("Parent access required",403);
    const row=await get(t,schoolId,body.studentId);
    if(!row)return fail("請先儲存團 T 尺寸，再確認實際領取",409);
    const previous=parse(row);
    if(previous.historicalIssued===true)return fail("此學生已有首次領取紀錄，請勿重複確認",409);
    if(!isFirstTshirtReceiptEligible(previous))return fail("請先由學校確認已實際發放團 T，再由家長確認收件",409);
    if(body.etag!==row.etag)return fail("資料已更新，請重新整理後再確認",409);
    if(body.confirmedReceived!==true||body.receivedSize!==previous.size)return fail("請確認學生已實際領取並核對尺寸",400);
    const now=new Date().toISOString();
    const next=buildFirstReceiptPayload(JSON.parse(row.payload),access.email,now);
    try{await t.updateEntity({partitionKey:schoolId,rowKey:body.studentId,payload:JSON.stringify(next),updatedAt:now},"Replace",{etag:row.etag})}
    catch(e){if(e.statusCode===412)return fail("資料已更新，請重新整理後再確認",409);throw e}
    await audit(schoolId,access.email,"tshirt.first.public.parent.received",body.studentId,
     {size:previous.size,quantity:1,receivedAt:now,previousSource:previous.source});
    return json({item:{...next,studentId:body.studentId}});
   }
   if(body.action==="RESET_SIZE"){
    if(access.role!=="admin")return fail("Admin only",403);
    const row=await get(t,schoolId,body.studentId);
    if(!row)return fail("Size record not found",404);
    if(body.etag!==row.etag)return fail("Record changed, refresh and retry",409);
    const previous=parse(row);
    if(previous.schoolIssuedAt||previous.source==="PARENT_CONFIRMED_FIRST_PUBLIC")return fail("團 T 已交付或已確認領取，不能退回待填寫，請先由校方核對",409);
    if(!previous.size)return fail("Size is already pending",409);
    const now=new Date().toISOString();
    const next={...JSON.parse(row.payload),size:null,sizeStatus:"PENDING_PARENT",sizeUpdatedBy:access.email,sizeUpdatedAt:now,updatedAt:now};
    try{await t.updateEntity({partitionKey:schoolId,rowKey:body.studentId,payload:JSON.stringify(next),updatedAt:now},"Replace",{etag:row.etag})}
    catch(e){if(e.statusCode===412)return fail("Record changed, refresh and retry",409);throw e}
    await audit(schoolId,access.email,"tshirt.history.size.reset",body.studentId,{previousSize:previous.size,newSize:null});
    return json({item:{...next,studentId:body.studentId}});
   }
   if(!SIZES.has(body.size))return fail("Invalid shirt size");
   let row=await get(t,schoolId,body.studentId);
   if(!row){
    if(access.role!=="parent"||!activeStudent(student))return fail("No eligible student",404);
    const stamp=new Date().toISOString();
    const issued=historicallyIssued(student);
    const initial={kind:"regularUniform",historicalIssued:issued,issuedQuantity:issued?1:0,size:body.size,sizeStatus:"PARENT_RECORDED",source:issued?"PARENT_BACKFILL_2026":"PARENT_SIZE_SURVEY",sizeUpdatedBy:access.email,sizeUpdatedAt:stamp,createdAt:stamp,updatedAt:stamp};
    try{
     await t.createEntity({partitionKey:schoolId,rowKey:body.studentId,payload:JSON.stringify(initial),updatedAt:stamp});
    }catch(e){if(e.statusCode===409)return fail("Record changed, refresh and retry",409);throw e}
    await audit(schoolId,access.email,issued?"tshirt.history.parent.backfill":"tshirt.size.survey",body.studentId,{size:body.size,issuedQuantity:initial.issuedQuantity});
    return json({item:{...initial,studentId:body.studentId}},201);
   }
   const old=parse(row);
   if(old.schoolIssuedAt||old.source==="PARENT_CONFIRMED_FIRST_PUBLIC")return fail("學校已交付或已完成領取確認，尺寸異動請聯絡學校",409);
   if(!["ADMIN_VERIFIED_HISTORICAL","PARENT_BACKFILL_2026","PARENT_SIZE_SURVEY"].includes(old.source))return fail("Unverified size record",409);
   if(body.etag!==row.etag)return fail("Record changed, refresh and retry",409);
   const now=new Date().toISOString();
   const next={...JSON.parse(row.payload),size:body.size,sizeStatus:"PARENT_RECORDED",sizeUpdatedBy:access.email,sizeUpdatedAt:now,updatedAt:now};
   await audit(schoolId,access.email,"tshirt.history.size",body.studentId,{previousSize:old.size||null,newSize:body.size});
   try{await t.updateEntity({partitionKey:schoolId,rowKey:body.studentId,payload:JSON.stringify(next),updatedAt:now},"Replace",{etag:row.etag})}
   catch(e){if(e.statusCode===412)return fail("Record changed, refresh and retry",409);throw e}
   return json({item:{...next,studentId:body.studentId}});
  }catch(e){console.error("tshirtHistoricalSize",e);return fail("Unable to process historical size",500)}
 }
});
