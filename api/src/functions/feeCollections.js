import {app} from "@azure/functions";
import {createHash,randomUUID} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {ensureStudentAccess,getTenantContext,json} from "../lib/auth.js";
import {listUserStudentMappings} from "../lib/storage.js";
import {getLineAccountBinding} from "../lib/lineAccountBinding.js";
import {pushLineMessage} from "../lib/lineMessaging.mjs";
import {
  FEE_PROJECT_KINDS,FEE_PROJECT_STATUSES,PAYMENT_STATUSES,canParentReport,isIsoDate,isSafeId,
  maskBankAccount,normalizeFeeProject,projectSourceType,validateTransferReport,validateVerification
} from "../lib/feeCollectionRules.mjs";

const connection=()=>process.env.STORAGE_CONNECTION_STRING;
const tableNames={
  projects:process.env.FEE_PROJECT_TABLE||"TenantFeeProject",
  charges:process.env.FEE_PROJECT_CHARGE_TABLE||"TenantFeeProjectCharge",
  audit:process.env.FEE_AUDIT_TABLE||"TenantFeeAudit",
  uniforms:"TenantUniformEventRequest",
  families:"TenantFamilyEventRegistration",
  configs:process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig",
  accounts:"TenantPaymentAccountTemplates"
};
const clients=new Map();
const fail=(error,status=400)=>json({error},status);
const now=()=>new Date().toISOString();
const safeText=(value,max)=>String(value||"").trim().slice(0,max);
const chargePartition=(schoolId,projectId)=>`${schoolId}|fee|${projectId}`;
const chargeRowKey=(sourceType,sourceId)=>`charge_${createHash("sha256").update(`${sourceType}:${sourceId}`).digest("hex").slice(0,40)}`;

async function table(key){
  if(!connection())throw new Error("STORAGE_CONNECTION_STRING 未設定");
  const name=tableNames[key]||key;
  if(!clients.has(name)){
    const instance=TableClient.fromConnectionString(connection(),name);
    await instance.createTable().catch(error=>{if(error.statusCode!==409)throw error});
    clients.set(name,instance);
  }
  return clients.get(name);
}

async function get(client,partitionKey,rowKey){
  try{return await client.getEntity(partitionKey,rowKey)}catch(error){if(error.statusCode===404)return null;throw error}
}
function decode(row){return {...JSON.parse(row.payload||"{}"),id:row.rowKey,etag:row.etag,updatedAt:row.updatedAt}}
function sourceTableKey(sourceType){return sourceType==="uniform"?"uniforms":sourceType==="family"?"families":""}

async function audit(schoolId,access,action,subjectId,details={}){
  const client=await table("audit"),timestamp=now();
  await client.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:safeText(action,100),subjectId:safeText(subjectId,180),actor:safeText(access.email||"unknown",200),at:timestamp,details:JSON.stringify(details).slice(0,16000)});
}

async function bankTemplate(schoolId,templateId){
  const row=await get(await table("accounts"),schoolId,templateId);if(!row)return null;
  const account=JSON.parse(row.payload||"{}");
  if(account.active!==true||!/^[0-9]{3}$/.test(String(account.bankCode||""))||!/^[0-9]{6,30}$/.test(String(account.accountNumber||""))||!String(account.bankName||"").trim()||!String(account.accountHolder||"").trim())return null;
  return {templateId,label:safeText(account.label,80),bankName:safeText(account.bankName,100),bankCode:String(account.bankCode),accountHolder:safeText(account.accountHolder,100),accountNumber:String(account.accountNumber)};
}

async function listProjects(schoolId){
  const items=[];for await(const row of (await table("projects")).listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}}))items.push(decode(row));
  return items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}

async function listAssociations(schoolId,projectId){
  const partition=chargePartition(schoolId,projectId),items=[];
  for await(const row of (await table("charges")).listEntities({queryOptions:{filter:`PartitionKey eq '${partition.replaceAll("'","''")}'`}}))items.push(decode(row));
  return items;
}

async function loadSource(schoolId,association){
  const key=sourceTableKey(association.sourceType);if(!key)return null;
  const row=await get(await table(key),schoolId,association.sourceId);return row?{row,item:decode(row)}:null;
}

async function dinnerConfig(schoolId,activityId){
  const row=await get(await table("configs"),schoolId,`yearEndDinner:${activityId}`);return row?JSON.parse(row.payload||"{}"):null;
}

function dinnerAmount(config,item){
  if([PAYMENT_STATUSES.REPORTED_UNVERIFIED,PAYMENT_STATUSES.VERIFIED].includes(item.paymentStatus)&&Number.isSafeInteger(item.transferReport?.expectedAmount))return item.transferReport.expectedAmount;
  if(config?.feeStatus!=="PUBLISHED")return Number.isSafeInteger(item.estimatedAmount)?item.estimatedAmount:null;
  const rates=[config.firstAdultFee,config.extraAdultFee,config.extraChildFee];
  if(!rates.every(value=>Number.isSafeInteger(value)&&value>=0))return null;
  return rates[0]+Math.max(0,Number(item.adults||1)-1)*rates[1]+Number(item.extraChildren||0)*rates[2];
}

function ownsCharge(access,association,source){
  const email=String(source.parentEmail||association.parentEmail||"").trim().toLowerCase();
  if(association.sourceType==="family")return email===String(access.email||"").toLowerCase();
  return email===String(access.email||"").toLowerCase()||ensureStudentAccess(access,String(source.studentId||association.studentId||""));
}

function safeTransfer(item,allowFinancial){
  if(allowFinancial)return item;
  const {transferReport,verificationNote,bankPostedAt,lastTransferReport,paymentHistory,...safe}=item;return safe;
}

async function buildCharge(schoolId,project,association,access,config){
  const loaded=await loadSource(schoolId,association);
  if(!loaded)return {...association,sourceMissing:true,paymentStatus:"SOURCE_MISSING",amount:association.amountSnapshot||null};
  const source=loaded.item,amount=association.sourceType==="uniform"?source.amount:dinnerAmount(config,source);
  const parentEmail=String(source.parentEmail||association.parentEmail||"").toLowerCase();
  const studentIds=association.sourceType==="family"?(Array.isArray(source.studentIds)?source.studentIds:[]):[source.studentId].filter(Boolean);
  const canViewFinancial=access.role==="parent"||access.capabilities?.financeVerifier===true;
  const safeSource=safeTransfer(source,canViewFinancial);
  return {
    id:association.id,sourceType:association.sourceType,sourceId:association.sourceId,
    parentEmail,studentId:String(source.studentId||association.studentId||""),studentIds,
    amount:Number.isSafeInteger(amount)?amount:null,paymentStatus:String(source.paymentStatus||PAYMENT_STATUSES.AWAITING_TRANSFER),
    transferReport:safeSource.transferReport||null,verifiedAt:safeSource.verifiedAt||"",verifiedBy:safeSource.verifiedBy||"",
    bankPostedAt:safeSource.bankPostedAt||"",verificationNote:safeSource.verificationNote||"",
    correctionReason:safeSource.correctionReason||"",canReport:access.role==="parent"&&ownsCharge(access,association,source)&&canParentReport({projectStatus:project.status,paymentStatus:source.paymentStatus||PAYMENT_STATUSES.AWAITING_TRANSFER,amount}),
    sourceMissing:false,etag:loaded.row.etag
  };
}

function projectSummary(charges){
  const summary={total:charges.length,awaiting:0,reported:0,verified:0,amount:0,verifiedAmount:0,missingSource:0};
  for(const charge of charges){
    if(charge.sourceMissing){summary.missingSource++;continue}
    if(Number.isSafeInteger(charge.amount))summary.amount+=charge.amount;
    if(charge.paymentStatus===PAYMENT_STATUSES.AWAITING_TRANSFER)summary.awaiting++;
    if(charge.paymentStatus===PAYMENT_STATUSES.REPORTED_UNVERIFIED)summary.reported++;
    if(charge.paymentStatus===PAYMENT_STATUSES.VERIFIED){summary.verified++;if(Number.isSafeInteger(charge.amount))summary.verifiedAmount+=charge.amount}
  }
  return summary;
}

async function projectView(schoolId,project,access){
  const config=project.kind===FEE_PROJECT_KINDS.YEAR_END_DINNER?await dinnerConfig(schoolId,project.activityId):null;
  const associations=await listAssociations(schoolId,project.id),charges=[];
  for(const association of associations){
    const loaded=await loadSource(schoolId,association);
    if(access.role==="parent"&&(!loaded||!ownsCharge(access,association,loaded.item)))continue;
    charges.push(await buildCharge(schoolId,project,association,access,config));
  }
  if(access.role==="parent"&&!charges.length)return null;
  const account=project.bankSnapshot||null,showFullAccount=access.capabilities?.financeVerifier===true||(access.role==="parent"&&project.status===FEE_PROJECT_STATUSES.OPEN&&charges.some(charge=>charge.paymentStatus!==PAYMENT_STATUSES.VERIFIED));
  const bankAccount=account?showFullAccount?account:{label:account.label,bankName:account.bankName,bankCode:account.bankCode,accountHolder:account.accountHolder,accountNumber:maskBankAccount(account.accountNumber)}:null;
  return {...project,bankAccount,bankSnapshot:undefined,charges,summary:projectSummary(charges)};
}

async function listDinnerActivities(schoolId){
  const items=[];
  for await(const row of (await table("configs")).listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
    if(!String(row.rowKey||"").startsWith("yearEndDinner:"))continue;
    const config=JSON.parse(row.payload||"{}"),activityId=String(row.rowKey).slice("yearEndDinner:".length);
    items.push({activityId,title:String(config.title||activityId),enabled:config.enabled===true,feeStatus:String(config.feeStatus||"")});
  }
  return items.sort((a,b)=>a.title.localeCompare(b.title,"zh-Hant"));
}

async function syncProjectSources(schoolId,project,access){
  const sourceType=projectSourceType(project.kind),sourceClient=await table(sourceTableKey(sourceType)),associations=await table("charges"),partition=chargePartition(schoolId,project.id),mappings=new Map();
  if(sourceType==="uniform"){
    for(const mapping of await listUserStudentMappings("active",schoolId)){
      const id=String(mapping.studentId||""),email=String(mapping.parentEmail||"").trim().toLowerCase();if(!id||!email)continue;
      if(!mappings.has(id))mappings.set(id,new Set());mappings.get(id).add(email);
    }
  }
  let synced=0,skipped=0;
  for await(const row of sourceClient.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
    const item=decode(row);
    if(sourceType==="uniform"){
      if(item.kind!=="regularUniform"||["PENDING","CANCELLED"].includes(item.status)||!Number.isSafeInteger(item.amount)||item.amount<=0){skipped++;continue}
    }else{
      if(item.kind!=="yearEndDinner"||item.activityId!==project.activityId||item.registrationStatus!=="REGISTERED"){skipped++;continue}
    }
    const candidates=mappings.get(String(item.studentId||""))||new Set(),fallback=candidates.size===1?[...candidates][0]:"",parentEmail=String(item.parentEmail||fallback||"").toLowerCase();
    const timestamp=now(),payload={sourceType,sourceId:item.id,parentEmail,studentId:String(item.studentId||""),amountSnapshot:Number.isSafeInteger(item.amount)?item.amount:null,linkedAt:timestamp,linkedBy:String(access.email||"admin")};
    await associations.upsertEntity({partitionKey:partition,rowKey:chargeRowKey(sourceType,item.id),payload:JSON.stringify(payload),updatedAt:timestamp},"Merge");synced++;
  }
  await audit(schoolId,access,"fee.project.sync",project.id,{sourceType,synced,skipped});
  return {synced,skipped};
}

async function saveProjectRow(client,schoolId,project,row,access,action){
  const timestamp=now(),next={...project,updatedAt:timestamp,updatedBy:String(access.email||"admin")};
  await audit(schoolId,access,action,project.id,{status:next.status,kind:next.kind,dueDate:next.dueDate});
  await client.updateEntity({partitionKey:schoolId,rowKey:project.id,payload:JSON.stringify(next),updatedAt:timestamp},"Replace",{etag:row.etag});
  return next;
}

async function notifyParent(schoolId,parentEmail,text){
  try{
    const binding=await getLineAccountBinding(schoolId,parentEmail,{includeTarget:true});
    if(!binding?.lineUserId)return {sent:false,reason:"not_bound"};
    await pushLineMessage(binding.lineUserId,text);return {sent:true};
  }catch(error){console.warn("LINE private payment notification failed",error?.message||String(error));return {sent:false,reason:"failed"}}
}

app.http("feeCollectionProjects",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"fee-collections/projects",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;if(!["admin","parent"].includes(access.role))return fail("Forbidden",403);
    try{
      const projectsClient=await table("projects");
      if(request.method==="GET"){
        const items=[];for(const project of await listProjects(schoolId)){const view=await projectView(schoolId,project,access);if(view&&(access.role==="admin"||project.status!==FEE_PROJECT_STATUSES.DRAFT))items.push(view)}
        return json({items,...(access.role==="admin"?{dinnerActivities:await listDinnerActivities(schoolId)}:{})});
      }
      if(access.role!=="admin")return fail("Admin only",403);
      const body=await request.json();
      if(request.method==="POST"){
        const fields=normalizeFeeProject(body),id=`fee_${randomUUID().replaceAll("-","")}`,timestamp=now(),project={id,...fields,status:FEE_PROJECT_STATUSES.DRAFT,createdAt:timestamp,createdBy:String(access.email||"admin"),updatedAt:timestamp,updatedBy:String(access.email||"admin")};
        await audit(schoolId,access,"fee.project.create",id,{kind:project.kind,title:project.title,dueDate:project.dueDate});
        await projectsClient.createEntity({partitionKey:schoolId,rowKey:id,payload:JSON.stringify(project),updatedAt:timestamp});
        return json({item:project},201);
      }
      if(!isSafeId(body.id))return fail("收費專案編號不正確");
      const row=await get(projectsClient,schoolId,body.id);if(!row)return fail("收費專案不存在",404);
      const current=decode(row),action=String(body.action||"");
      if(action==="SYNC_SOURCE"){
        const result=await syncProjectSources(schoolId,current,access);return json({item:await projectView(schoolId,current,access),sync:result});
      }
      if(action==="UPDATE"){
        if(current.status!==FEE_PROJECT_STATUSES.DRAFT)return fail("只有草稿可修改",409);
        const fields=normalizeFeeProject(body,current),next=await saveProjectRow(projectsClient,schoolId,{...current,...fields},row,access,"fee.project.update");return json({item:await projectView(schoolId,next,access)});
      }
      if(action==="OPEN"||action==="REOPEN"){
        if(access.capabilities?.financeVerifier!==true)return fail("僅指定財務人員可開放收費",403);
        if(action==="OPEN"&&current.status!==FEE_PROJECT_STATUSES.DRAFT||action==="REOPEN"&&current.status!==FEE_PROJECT_STATUSES.CLOSED)return fail("專案狀態不允許開放",409);
        const associations=await listAssociations(schoolId,current.id);if(!associations.length)return fail("請先同步收費對象",409);
        const account=await bankTemplate(schoolId,current.accountTemplateId);if(!account)return fail("收款帳戶不存在、停用或資料不完整",409);
        const next=await saveProjectRow(projectsClient,schoolId,{...current,status:FEE_PROJECT_STATUSES.OPEN,bankSnapshot:account,openedAt:now()},row,access,"fee.project.open");return json({item:await projectView(schoolId,next,access)});
      }
      if(action==="CLOSE"){
        if(current.status!==FEE_PROJECT_STATUSES.OPEN)return fail("只有開放中的專案可結束",409);
        const next=await saveProjectRow(projectsClient,schoolId,{...current,status:FEE_PROJECT_STATUSES.CLOSED,closedAt:now()},row,access,"fee.project.close");return json({item:await projectView(schoolId,next,access)});
      }
      return fail("不支援的專案操作");
    }catch(error){console.error("feeCollectionProjects",error);return fail(error?.message||"收費專案處理失敗",String(error?.message||"").includes("請")?400:500)}
  }
});

app.http("feeCollectionTransfers",{
  methods:["POST","PATCH"],authLevel:"anonymous",route:"fee-collections/transfers",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;if(!["admin","parent"].includes(access.role))return fail("Forbidden",403);
    try{
      const body=await request.json();if(!isSafeId(body.projectId)||!isSafeId(body.chargeId))return fail("收費資料不正確");
      const projectRow=await get(await table("projects"),schoolId,body.projectId);if(!projectRow)return fail("收費專案不存在",404);
      const project=decode(projectRow),associationRow=await get(await table("charges"),chargePartition(schoolId,project.id),body.chargeId);if(!associationRow)return fail("收費項目不存在",404);
      const association=decode(associationRow),loaded=await loadSource(schoolId,association);if(!loaded)return fail("原始收費資料不存在",409);
      const source=loaded.item,sourcePayload=JSON.parse(loaded.row.payload||"{}"),config=project.kind===FEE_PROJECT_KINDS.YEAR_END_DINNER?await dinnerConfig(schoolId,project.activityId):null,amount=association.sourceType==="uniform"?source.amount:dinnerAmount(config,source);
      const timestamp=now(),history=Array.isArray(source.paymentHistory)?source.paymentHistory.slice(-19):[],sourceClient=await table(sourceTableKey(association.sourceType));
      if(request.method==="POST"){
        if(access.role!=="parent"||!ownsCharge(access,association,source))return fail("Forbidden",403);
        if(!canParentReport({projectStatus:project.status,paymentStatus:source.paymentStatus||PAYMENT_STATUSES.AWAITING_TRANSFER,amount}))return fail("此筆目前不可回報匯款",409);
        const report=validateTransferReport(body,amount),next={...sourcePayload,paymentStatus:PAYMENT_STATUSES.REPORTED_UNVERIFIED,transferReport:{...report,expectedAmount:amount,reportedAt:timestamp},correctionReason:"",paymentHistory:[...history,{action:"REPORTED",at:timestamp,amount:report.amount}],updatedAt:timestamp};
        await audit(schoolId,access,"fee.transfer.report",`${project.id}:${association.id}`,{sourceType:association.sourceType,sourceId:association.sourceId,amount:report.amount,transferDate:report.transferDate});
        await sourceClient.updateEntity({partitionKey:schoolId,rowKey:association.sourceId,payload:JSON.stringify(next),updatedAt:timestamp},"Replace",{etag:loaded.row.etag});
        const lineNotification=await notifyParent(schoolId,access.email,`✅ 已收到匯款回報\n專案：${project.title}\n金額：NT$ ${amount.toLocaleString("zh-TW")}\n狀態：等待財務核帳\n\n核帳完成後，平台與 LINE 會更新結果。`);
        return json({paymentStatus:next.paymentStatus,reportedAt:timestamp,lineNotification});
      }
      if(access.role!=="admin"||access.capabilities?.financeVerifier!==true)return fail("僅指定財務人員可核帳",403);
      const action=String(body.action||"");
      if(source.paymentStatus!==PAYMENT_STATUSES.REPORTED_UNVERIFIED)return fail("此筆目前沒有待核對的匯款",409);
      if(action==="VERIFY"){
        if(source.transferReport?.amount!==amount)return fail("家長回報金額與應繳金額不同，請先要求補正",409);
        const verified=validateVerification(body,source.transferReport.amount),next={...sourcePayload,paymentStatus:PAYMENT_STATUSES.VERIFIED,verifiedBy:String(access.email||"finance"),verifiedAt:timestamp,bankPostedAt:verified.bankPostedAt,verificationNote:verified.note,correctionReason:"",paymentHistory:[...history,{action:"VERIFIED",at:timestamp,amount:verified.amount,actor:String(access.email||"")}],updatedAt:timestamp};
        await audit(schoolId,access,"fee.transfer.verify",`${project.id}:${association.id}`,{sourceType:association.sourceType,sourceId:association.sourceId,amount:verified.amount,bankPostedAt:verified.bankPostedAt,note:verified.note});
        await sourceClient.updateEntity({partitionKey:schoolId,rowKey:association.sourceId,payload:JSON.stringify(next),updatedAt:timestamp},"Replace",{etag:loaded.row.etag});
        const lineNotification=await notifyParent(schoolId,source.parentEmail||association.parentEmail,`✅ 匯款核帳完成\n專案：${project.title}\n金額：NT$ ${amount.toLocaleString("zh-TW")}\n狀態：已確認入帳\n\n感謝您的配合。`);
        return json({paymentStatus:next.paymentStatus,verifiedAt:timestamp,lineNotification});
      }
      if(action==="REQUEST_CORRECTION"){
        const reason=String(body.reason||"").trim();if(!reason||reason.length>300)return fail("請填寫 300 字內的補正原因");
        const next={...sourcePayload,paymentStatus:PAYMENT_STATUSES.AWAITING_TRANSFER,lastTransferReport:source.transferReport||null,transferReport:null,correctionReason:reason,paymentHistory:[...history,{action:"CORRECTION_REQUESTED",at:timestamp,actor:String(access.email||""),reason}],updatedAt:timestamp};
        await audit(schoolId,access,"fee.transfer.correction",`${project.id}:${association.id}`,{sourceType:association.sourceType,sourceId:association.sourceId,reason});
        await sourceClient.updateEntity({partitionKey:schoolId,rowKey:association.sourceId,payload:JSON.stringify(next),updatedAt:timestamp},"Replace",{etag:loaded.row.etag});
        const lineNotification=await notifyParent(schoolId,source.parentEmail||association.parentEmail,`⚠️ 匯款資料需要補正\n專案：${project.title}\n原因：${reason}\n\n請登入聖心弦樂成長平台重新回報。`);
        return json({paymentStatus:next.paymentStatus,correctionReason:reason,lineNotification});
      }
      return fail("不支援的核帳操作");
    }catch(error){
      if(error.statusCode===412)return fail("資料已更新，請重新整理後再操作",409);
      console.error("feeCollectionTransfers",error);return fail(error?.message||"匯款核帳處理失敗",String(error?.message||"").includes("請")?400:500);
    }
  }
});
