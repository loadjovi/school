import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { getTenantContext, ensureStudentAccess, getStudentAliasInfo, json } from "../lib/auth.js";
import { getStudentMaster, listUserStudentMappings } from "../lib/storage.js";
import { sendUniformRequestStatusEmail } from "../lib/email.js";
import { getUniformPrice } from "../lib/uniformPricing.js";

const kinds=new Set(["regularUniform","competitionUniform","fieldTrip","yearEndDinner"]);
// 已核對的歷史公費配發，依校別與學生 ID 登錄；不依姓名或尺寸推定資格。
const historicalPublicIssues={"sacred-heart":new Set(["112068"])};
const hasHistoricalPublicIssue=(schoolId,studentId)=>historicalPublicIssues[schoolId]?.has(String(studentId))===true;
async function hasPublicRequest(client,schoolId,studentId,excludeId=""){
 for await(const row of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
  const item=decode(row);
  if(item.id!==excludeId&&item.kind==="competitionUniform"&&String(item.studentId)===String(studentId)&&item.acquisition==="PUBLIC"&&item.status!=="CANCELLED")return true;
 }
 return false;
}
const states=new Set(["PENDING","APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP","CANCELLED","FULFILLED"]);
const allowedNext={PENDING:new Set(["APPROVED","CANCELLED"]),APPROVED:new Set(["ORDERED","CANCELLED"]),ORDERED:new Set(["ARRIVED","CANCELLED"]),ARRIVED:new Set(["READY_FOR_PICKUP","CANCELLED"]),READY_FOR_PICKUP:new Set([]),CANCELLED:new Set([]),FULFILLED:new Set([])};
const connection=()=>process.env.STORAGE_CONNECTION_STRING;
const clients=new Map();
async function table(kind){
  const name=kind==="requests"?"TenantUniformEventRequest":kind==="inventory"?"TenantUniformInventory":"TenantUniformEventAudit";
  if(!connection())throw new Error("Storage unavailable");
  if(!clients.has(name)){const client=TableClient.fromConnectionString(connection(),name);await client.createTable().catch(e=>{if(e.statusCode!==409)throw e});clients.set(name,client)}
  return clients.get(name);
}
const validId=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const qty=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
const safe=(s,n=200)=>typeof s==="string"&&s.length<=n;
const err=(msg,status=400)=>json({error:msg},status);
const encode=x=>JSON.stringify(x);
const decode=e=>({...JSON.parse(e.payload||"{}"),id:e.rowKey,etag:e.etag,updatedAt:e.updatedAt});
async function find(client,schoolId,id){try{return await client.getEntity(schoolId,id)}catch(e){if(e.statusCode===404)return null;throw e}}
async function audit(schoolId,access,action,id,details){
  const client=await table("audit");
  await client.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action,subjectId:id,actor:String(access.email||"unknown").slice(0,200),at:new Date().toISOString(),details:encode(details).slice(0,20000)});
}
async function configuredAndOpen(schoolId,data){
  const client=TableClient.fromConnectionString(connection(),process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
  const id=["fieldTrip","yearEndDinner"].includes(data.kind)?data.activityId:"default";
  if(!validId(id))return false;
  const row=await find(client,schoolId,data.kind+":"+id);
  if(!row)return ["regularUniform","competitionUniform"].includes(data.kind);
  const cfg=JSON.parse(row.payload||"{}"),now=Date.now();
  return (["regularUniform","competitionUniform"].includes(data.kind)||cfg.enabled===true)&&(!cfg.openAt||Date.parse(cfg.openAt)<=now)&&(!cfg.closeAt||Date.parse(cfg.closeAt)>=now);
}
async function studentGuard(access,schoolId,studentId){
  if(!validId(studentId)||!ensureStudentAccess(access,studentId))return false;
  const student=await getStudentMaster(studentId,schoolId);
  return Boolean(student);
}
function validateRequest(data,student){
  if(!data||!kinds.has(data.kind)||!validId(data.studentId))throw new Error("Invalid request");
  if(!safe(data.note||"",1000))throw new Error("Invalid note");
  if(data.kind==="regularUniform"){
    if(!["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"].includes(data.size)||!qty(data.quantity)||data.quantity<1||data.quantity>20)throw new Error("Invalid shirt size or quantity");
    // Eligibility is not client-authoritative; all requests await admin verification.
    return {size:data.size,quantity:data.quantity,freeEligibility:"PENDING",amount:null};
  }
  if(data.kind==="competitionUniform"){
    if(String(student.groupName)!=="A")throw new Error("Only A group");
    const allowed=data.style==="女"?["XS","S","M","L"]:data.style==="男"?["S","M","L","2L"]:[];
    if(!allowed.includes(data.size)||!["PUBLIC","RENTAL","PURCHASE","PENDING"].includes(data.acquisition))throw new Error("Invalid competition selection");
    return {style:data.style,size:data.size,acquisition:data.acquisition,amount:null};
  }
  if(!validId(data.activityId))throw new Error("Activity ID required");
  if(!qty(data.adults??0)||!qty(data.extraChildren??0)||data.adults>20||data.extraChildren>20)throw new Error("Invalid attendees");
  return {activityId:data.activityId,adults:data.adults??0,extraChildren:data.extraChildren??0,amount:null};
}
app.http("uniformEventRequests",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"uniform-events/requests",
  handler:async request=>{
    const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
    const {schoolId,access}=ctx;
    if(!["admin","parent"].includes(access.role))return err("Forbidden",403);
    try{
      const client=await table("requests");
      if(request.method==="GET"){
        const out=[];
        for await(const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
          const item=decode(e);
          if(access.role==="admin"||ensureStudentAccess(access,item.studentId)){
            if(access.role==="admin"&&access.capabilities?.financeVerifier!==true){const {transferReport,verificationNote,bankPostedAt,...safe}=item;out.push(safe)}
            else out.push(item);
          }
        }
        const used=new Set(out.filter(x=>x.kind==="competitionUniform"&&x.acquisition==="PUBLIC"&&x.status!=="CANCELLED").map(x=>String(x.studentId)));
        const historical=[];
        for(const id of historicalPublicIssues[schoolId]||[])if(access.role==="admin"||ensureStudentAccess(access,id)){used.add(id);historical.push(id)}
        return json({items:out,publicUsedStudentIds:[...used],historicalPublicStudentIds:historical});
      }
      const data=await request.json();
      if(request.method==="POST"){
        if(!await studentGuard(access,schoolId,data.studentId))return err("Student not found or forbidden",403);
        if(!await configuredAndOpen(schoolId,data))return err("Module or activity is not open",403);
        const student=await getStudentMaster(data.studentId,schoolId);
        const fields=validateRequest(data,student);
        if(data.kind==="competitionUniform"&&fields.acquisition==="PUBLIC"&&(hasHistoricalPublicIssue(schoolId,data.studentId)||await hasPublicRequest(client,schoolId,data.studentId)))return err("此學生已有公費比賽服領用或申請紀錄，後續只能選擇自費買斷",409);
        const id=randomUUID(),createdAt=new Date().toISOString();
        const payload={kind:data.kind,studentId:data.studentId,...fields,status:"PENDING",note:data.note||"",createdAt,updatedAt:createdAt};
        if(data.kind==="competitionUniform"&&fields.acquisition==="PURCHASE"){
          const account=await find(TableClient.fromConnectionString(connection(),"TenantUniformPaymentAccounts"),schoolId,"uniform:competitionUniform");
          if(!account)return err("學校尚未設定 A 團比賽服的收款帳戶，請稍後再送出買斷申請",409);
          const price=await getUniformPrice(schoolId,"competitionUniform");
          if(!Number.isSafeInteger(price.unitPrice)||price.unitPrice<=0)return err("A 團比賽服價格尚未設定，請聯繫學校",409);
          Object.assign(payload,{status:"APPROVED",unitPrice:price.unitPrice,amount:price.unitPrice,paymentStatus:"AWAITING_TRANSFER"});
        }
        if(data.kind==="competitionUniform"&&fields.acquisition==="PUBLIC")payload.amount=0;
        // Audit before accepting mutation. If audit fails, request is not accepted.
        await audit(schoolId,access,"request.create",id,{kind:data.kind,studentId:data.studentId,acquisition:fields.acquisition||"",status:payload.status});
        await client.createEntity({partitionKey:schoolId,rowKey:id,payload:encode(payload),updatedAt:createdAt});
        return json({item:{...payload,id}},201);
      }
      if(!validId(data.id)||!safe(data.etag,200))return err("Invalid update");
      const previous=await find(client,schoolId,data.id);
      if(!previous)return err("Not found",404);
      if(data.etag!==previous.etag)return err("Record changed, refresh and retry",409);
      const before=decode(previous);
      if(access.role==="parent"&&!await studentGuard(access,schoolId,before.studentId))return err("Forbidden",403);
      const next={...JSON.parse(previous.payload),updatedAt:new Date().toISOString()};
      let action="request.status",auditDetail={},shouldNotify=false;
      if(access.role==="parent"){
        if(before.status!=="PENDING")return err("已進入校方審核或採購流程，請聯繫學校更正",409);
        if(data.action==="CANCEL"){
          next.status="CANCELLED";next.cancelReason="家長自行取消";action="request.parent_cancel";
          auditDetail={studentId:before.studentId,from:before.status,to:next.status};
        }else if(data.action==="EDIT"){
          if(!["regularUniform","competitionUniform"].includes(before.kind))return err("此申請不支援家長修改",400);
          const student=await getStudentMaster(before.studentId,schoolId);
          const fields=validateRequest({...before,...data,kind:before.kind,studentId:before.studentId},student);
          for(const key of ["size","quantity","style"])if(key in fields)next[key]=fields[key];
          if(before.kind==="regularUniform")next.note=`團 T 自費加購 ${next.quantity} 件；待校方審核`;
          action="request.parent_edit";auditDetail={studentId:before.studentId,before:{size:before.size,quantity:before.quantity,style:before.style},after:{size:next.size,quantity:next.quantity,style:next.style}};
        }else return err("不支援的家長操作",400);
      }else if(data.action==="ADJUST"){
        return err("後台不得修改家長申請件數；如家長填錯，請家長於核准前自行更正或取消重填",403);
      }else if(data.action==="SET_AMOUNT"){
        if(access.capabilities?.financeVerifier!==true)return err("僅財務人員可補正應繳金額",403);
        if(before.status!=="APPROVED"||!["regularUniform","competitionUniform"].includes(before.kind)||before.acquisition==="PUBLIC")return err("僅可補正已核准的自費團服金額",409);
        if(["REPORTED_UNVERIFIED","VERIFIED"].includes(before.paymentStatus))return err("已有匯款紀錄，不可變更金額",409);
        const account=await find(TableClient.fromConnectionString(connection(),"TenantUniformPaymentAccounts"),schoolId,"uniform:"+before.kind);
        if(!account)return err("請先設定此團服的收款帳戶",409);
        next.unitPrice=(await getUniformPrice(schoolId,before.kind)).unitPrice;
        next.amount=next.unitPrice*(before.kind==="regularUniform"?before.quantity:1);next.paymentStatus="AWAITING_TRANSFER";
        action="request.amount_confirm";auditDetail={studentId:before.studentId,amount:next.amount};shouldNotify=true;
      }else if(data.action==="SET_PROCUREMENT_QUANTITY"){
        if(before.kind!=="regularUniform"||before.status!=="ORDERED")return err("僅可更正已採購、尚未入庫的團 T 採購數量",409);
        const inventory=TableClient.fromConnectionString(connection(),"TenantUniformInventory");
        if(await find(inventory,schoolId,"received:"+data.id))return err("此筆已驗收入庫，採購數量不可再更正",409);
        if(!Number.isSafeInteger(data.procurementQuantity)||data.procurementQuantity<before.quantity||data.procurementQuantity>100||!safe(data.reason,300)||!data.reason.trim())return err("採購件數須不小於家長申請件數、至多 100 件，並填寫原因",400);
        next.procurementQuantity=data.procurementQuantity;next.procurementReason=data.reason.trim();action="request.procurement_quantity_adjust";
        auditDetail={studentId:before.studentId,requestQuantity:before.quantity,from:before.procurementQuantity??before.quantity,to:next.procurementQuantity,reason:next.procurementReason};
      }else{
        if(!states.has(data.status))return err("Invalid update");
        if(!allowedNext[before.status]?.has(data.status))return err("Invalid status transition; refresh and check the current stage",409);
        if(data.status==="ORDERED"&&["regularUniform","competitionUniform"].includes(before.kind)&&before.acquisition!=="PUBLIC"&&before.paymentStatus!=="VERIFIED")return err("財務尚未確認入帳，不能更新為已統一採購",409);
        if(data.status==="ORDERED"&&before.kind==="regularUniform"&&(!Number.isSafeInteger(data.procurementQuantity)||data.procurementQuantity<before.quantity||data.procurementQuantity>100))return err("請填寫實際向廠商採購的團 T 件數（不得小於家長申請件數）",400);
        if(data.status==="ARRIVED"&&["regularUniform","competitionUniform"].includes(before.kind))return err("請使用驗收入庫功能，入庫後會自動更新為已到貨",409);
        if(data.status==="READY_FOR_PICKUP"&&["regularUniform","competitionUniform"].includes(before.kind)){
          const inventory=TableClient.fromConnectionString(connection(),"TenantUniformInventory");
          if(!await find(inventory,schoolId,"received:"+data.id))return err("此申請尚未驗收入庫，請先入庫再開放領取",409);
        }
        if(data.status==="APPROVED"&&before.kind==="competitionUniform"&&before.acquisition==="PUBLIC"&&(hasHistoricalPublicIssue(schoolId,before.studentId)||await hasPublicRequest(client,schoolId,before.studentId,data.id)))return err("此學生已有公費比賽服領用或其他公費申請，請取消重複申請",409);
        if(data.status==="READY_FOR_PICKUP"&&["regularUniform","competitionUniform"].includes(before.kind)&&before.acquisition!=="PUBLIC"&&before.paymentStatus!=="VERIFIED")return err("自費申請須先完成財務核帳，才可開放領取",409);
        next.status=data.status;
        if(data.status==="ORDERED"&&before.kind==="regularUniform")next.procurementQuantity=data.procurementQuantity;
        if(data.status==="APPROVED"&&["regularUniform","competitionUniform"].includes(before.kind)){
          if(before.kind==="competitionUniform"&&before.acquisition==="PUBLIC"){
            next.amount=0;next.paymentStatus="NOT_REQUIRED";
          }else{
            const account=await find(TableClient.fromConnectionString(connection(),"TenantUniformPaymentAccounts"),schoolId,"uniform:"+before.kind);
            if(!account)return err("請先設定此團服的收款帳戶，再核准申請",409);
            next.unitPrice=(await getUniformPrice(schoolId,before.kind)).unitPrice;
            next.amount=next.unitPrice*(before.kind==="regularUniform"?before.quantity:1);
            next.paymentStatus="AWAITING_TRANSFER";
          }
        }
        if(next.status==="CANCELLED"){
          if(!safe(data.reason,300)||!String(data.reason||"").trim())return err("取消已核准申請請填寫原因",400);
          next.cancelReason=data.reason.trim();
        }
        if(data.status==="FULFILLED")return err("Use inventory issuance workflow before fulfillment",409);
        auditDetail={studentId:before.studentId,from:before.status,to:next.status,procurementQuantity:next.procurementQuantity||null,reason:next.cancelReason||""};shouldNotify=true;
      }
      await audit(schoolId,access,action,data.id,auditDetail);
      try{await client.updateEntity({partitionKey:schoolId,rowKey:data.id,payload:encode(next),updatedAt:next.updatedAt},"Replace",{etag:previous.etag})}
      catch(e){if(e.statusCode===412)return err("Record changed, refresh and retry",409);throw e}
      let notificationStatus="not_attempted";
      if(shouldNotify){
        try{
          const mappings=await listUserStudentMappings("active",schoolId),recipients=new Set();
          for(const mapping of mappings){
            if(!mapping.parentEmail)continue;
            const alias=await getStudentAliasInfo(mapping.studentId,schoolId).catch(()=>null);
            if(String(alias?.canonicalStudentId||mapping.studentId)===String(next.studentId))recipients.add(mapping.parentEmail);
          }
          const student=await getStudentMaster(next.studentId,schoolId);
          const result=await sendUniformRequestStatusEmail({recipients:[...recipients],studentName:student?.studentName||"學生",kind:next.kind,status:next.status,size:next.size,quantity:next.quantity});
          notificationStatus=result.status;
          if(result.status!=="sent")console.warn("uniform request email not fully sent",{requestId:data.id,status:result.status,recipientCount:result.recipientCount||0});
        }catch(e){notificationStatus="failed";console.error("uniform request email failed",{requestId:data.id,error:e?.message||String(e)})}
      }
      return json({item:{...next,id:data.id},notificationStatus});
    }catch(e){
      if(e instanceof SyntaxError||String(e.message||"").startsWith("Invalid")||String(e.message||"").startsWith("Only"))return err(e.message);
      console.error("uniformEventRequests",e);return err("Request processing failed",500);
    }
  }
});
