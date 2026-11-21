import {createHash,randomUUID} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {ensureStudentAccess,getStudentAliasInfo} from "./auth.js";
import {financeAssignments} from "./financeAccess.js";
import {financeRecipients} from "./financeNoticeRules.mjs";
import {listTenantAdmins,getMappedStudentsByEmail,getStudentMaster} from "./storage.js";
import {getTenantLineRecipient} from "./tenantLineAccounts.js";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {deliverLabNotice,labNoticeLineResult,labNoticeUrl} from "./labNoticeDelivery.mjs";
import {familyPaymentInfo} from "./paymentNoticeRules.mjs";
import {changePaymentResolution,ownsResolution,resolutionPayer,resolutionExpected,paymentResolutionEnabled,PaymentResolutionError} from "./paymentResolutionRules.mjs";

const tables={uniform:"TenantUniformEventRequest",family:"TenantFamilyEventRegistration",staff:"TenantTshirtStaffDemand"};
const clients=new Map();
const fail=(message,status=400)=>{throw new PaymentResolutionError(message,status)};
async function table(name){if(!clients.has(name))clients.set(name,(async()=>{const db=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);await db.createTable().catch(e=>{if(e.statusCode!==409)throw e});return db})().catch(error=>{clients.delete(name);throw error}));return clients.get(name)}
async function get(db,school,id){try{return await db.getEntity(school,id)}catch(e){if(e.statusCode===404)return null;throw e}}
const decode=row=>({...JSON.parse(row.payload||"{}"),id:row.rowKey,etag:row.etag});
function validateSource(sourceType,id){if(!Object.hasOwn(tables,sourceType)||typeof id!=="string"||id.length>250||!/^[a-zA-Z0-9_:-]+$/.test(id))fail("申請編號不正確")}
const finance=access=>access.role==="admin"&&access.capabilities?.financeVerifier===true;
const labels={uniform:"團服申請",family:"活動報名",staff:"幹部／志工團 T"};
async function studentNames(school,item){return Promise.all((item.studentIds||[item.studentId].filter(Boolean)).map(async id=>{const st=await getStudentMaster(id,school);return st?.studentName||st?.name||String(id)}))}
async function activityConfig(school,item){const row=await get(await table(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig"),school,item.kind+":"+item.activityId);return row?JSON.parse(row.payload||"{}"):null}
async function bankFor(school,sourceType,item){
 const family=sourceType==="family",name=family?"TenantEventPaymentAccounts":"TenantUniformPaymentAccounts",key=family?item.kind+":"+item.activityId:"uniform:"+(sourceType==="staff"?"regularUniform":item.kind);
 const row=await get(await table(name),school,key);if(!row)return null;
 const bank=JSON.parse(row.payload||"{}");return {bankName:bank.bankName,bankCode:bank.bankCode,accountHolder:bank.accountHolder,accountNumber:bank.accountNumber};
}
export async function paymentResolutionView(school,access,sourceType,item){
 if(!finance(access)&&!ownsResolution(access,item,ensureStudentAccess))return null;
 const title=sourceType==="family"?(await activityConfig(school,item))?.title:sourceType==="staff"?labels.staff:item.kind==="regularUniform"?"團 T":"A 團比賽服";
 return {...item,sourceType,studentNames:await studentNames(school,item),title:title||labels[sourceType],...(access.role==="parent"&&item.paymentStatus==="ADJUSTMENT_REQUIRED"&&item.paymentResolution?.balance>0?{paymentAccount:await bankFor(school,sourceType,item)}:{})};
}
export async function listPaymentResolutions(school,access){
 if(!paymentResolutionEnabled())fail("此環境未啟用差額與退費流程",404);
 if(!finance(access)&&access.role!=="parent")fail("僅財務幹部或原繳費家長可查看",403);
 const items=[];
 for(const [sourceType,name] of Object.entries(tables))for await(const row of (await table(name)).listEntities({queryOptions:{filter:`PartitionKey eq '${school.replaceAll("'","''")}'`}})){
  const item=decode(row);if(!item.paymentResolution)continue;
  const view=await paymentResolutionView(school,access,sourceType,item);if(view)items.push(view);
 }
 return items.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
const replyCode=(school,type,id,caseId)=>createHash("sha256").update(JSON.stringify([school,type,id,caseId])).digest("hex").slice(0,14).toUpperCase();
async function notifyResolution(school,sourceType,item,event){
 const stillDue=async()=>{const row=await get(await table(tables[sourceType]),school,item.id);if(!row)return false;const current=JSON.parse(row.payload||"{}");return current.paymentResolution?.revision===event.id&&current.paymentStatus===item.paymentStatus};
 const r=item.paymentResolution,payer=resolutionPayer(item),parentAction=["REPORT_SUPPLEMENT","REQUEST_REFUND","UPDATE_REFUND_ACCOUNT"].includes(event.action);
 const title=sourceType==="family"?(await activityConfig(school,item))?.title:sourceType==="staff"?labels.staff:item.kind==="regularUniform"?"團 T":"A 團比賽服";
 const url=labNoticeUrl(school),amount=n=>"NT$ "+Number(n||0).toLocaleString("zh-TW");
 const heading={REQUEST_ADJUSTMENT:r.balance>0?"請補繳差額":"金額有溢繳，請確認後續處理",REPORT_SUPPLEMENT:"家長已回報補款，請核帳",REQUEST_REFUND:"家長申請退費，請財務處理",UPDATE_REFUND_ACCOUNT:"家長已提供退款帳戶",VERIFY_ADJUSTMENT:"財務已確認足額入帳",COMPLETE_REFUND:"已退款並作廢申請",REFUND_EXCESS:"已退還溢繳差額，核帳完成"}[event.action];
 const text=["【LAB｜"+heading+"】",title||labels[sourceType],(await studentNames(school,item)).join("、")+(item.size?"｜尺寸 "+item.size:""),"應繳："+amount(r.expectedAmount)+"｜銀行確認累計實收："+amount(r.receivedAmount),r.balance>0&&item.paymentStatus!=="REFUNDED"?"待補差額："+amount(r.balance):"",event.action==="REQUEST_ADJUSTMENT"?"原因："+r.reason:"",event.action==="COMPLETE_REFUND"?"已退款："+amount(r.refund.amount)+"，原申請已作廢，不再採購／保留報名。":"",["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED","REFUND_REQUESTED"].includes(item.paymentStatus)?"此筆流程暫停，未完成核帳前不會進入採購／報名完成。":"",parentAction?"請到後台「待財務核帳」處理。":"請至平台「活動團服 → 補款與退費」查看；不同意補款可申請退費。",url].filter(Boolean).join("\n");
 const eventId=`payment-resolution:${sourceType}:${item.id}:${event.id}`;
 if(parentAction){const [admins,assignments]=await Promise.all([listTenantAdmins(school,"active"),financeAssignments(school)]);return labNoticeLineResult(await deliverLabNotice({schoolId:school,eventId,recipients:financeRecipients(admins,assignments),subject:heading,text,stillDue}))}
 return labNoticeLineResult(await deliverLabNotice({schoolId:school,eventId,recipients:[payer],subject:heading,text,stillDue,lineSender:async recipient=>{
  const channel=await resolveTenantLineChannel(school),account=channel.botUserId&&await getTenantLineRecipient(school,recipient,channel.botUserId);
  if(!channel.loginConfigured||!account?.lineUserId)return "not_bound";
  if(!await stillDue())return "ineligible";
  let quickReply,body=text;
  if(event.action==="REQUEST_ADJUSTMENT"){
   const code=replyCode(school,sourceType,item.id,r.caseId);
   await (await table("TenantPaymentResolutionReply")).upsertEntity({partitionKey:school,rowKey:code,sourceType,sourceId:item.id,caseId:r.caseId,email:recipient,userId:account.lineUserId,botUserId:channel.botUserId,expiresAt:Date.now()+30*86400000},"Replace");
   const command="#申請退費 "+code+" 不同意補款，申請退費";
   body+="\n\n不同意補款：點「申請退費並取消」，或回覆下行：\n"+command;
   quickReply={items:[{type:"action",action:{type:"message",label:"申請退費並取消",text:command}}]};
  }
  await pushLineMessage(account.lineUserId,body,{accessToken:channel.accessToken,retryKey:event.id,quickReply});return "accepted";
 }}));
}
export async function applyPaymentResolution(school,access,input){
 if(!paymentResolutionEnabled())fail("此環境未啟用差額與退費流程",404);
 const {sourceType,id}=input;validateSource(sourceType,id);
 if(!/^[a-f0-9-]{36}$/i.test(input.requestId||""))fail("請重新載入操作表單");
 const db=await table(tables[sourceType]),row=await get(db,school,id);if(!row)fail("找不到此申請",404);
 const item=decode(row),owner=ownsResolution(access,item,ensureStudentAccess),canFinance=finance(access);
 if(!canFinance&&!owner)fail("僅指定財務幹部或原繳費家長可處理",403);
 if(!resolutionPayer(item))fail("找不到原繳費家長，請先核對申請與家長綁定",409);
 const prior=(item.paymentResolutionEvents||[]).find(event=>event.requestId===input.requestId);
 if(prior){if(prior.actor!==access.email||prior.action!==input.action)fail("操作編號已使用，請重新整理",409);return {item:await paymentResolutionView(school,access,sourceType,item),alreadyApplied:true}}
 if(item.paymentResolution?(input.revision!==item.paymentResolution.revision):input.etag!==row.etag)fail("資料已更新，請重新整理後操作",409);
 const configured=sourceType==="family"?familyPaymentInfo(await activityConfig(school,item),item).amount:undefined;
 const next=changePaymentResolution(JSON.parse(row.payload||"{}"),input,{sourceType,expectedAmount:resolutionExpected(item,sourceType,configured),finance:canFinance,parent:owner,actor:access.email,at:new Date().toISOString(),id:randomUUID()});
 if(!next.paymentResolution.caseId)next.paymentResolution.caseId=next.paymentResolution.revision;
 try{await db.updateEntity({partitionKey:school,rowKey:id,payload:JSON.stringify(next),updatedAt:next.updatedAt},"Replace",{etag:row.etag})}
 catch(e){if(e.statusCode===412)fail("資料剛被更新，請重新整理；本次未重複執行",409);throw e}
 const event=next.paymentResolutionEvents.at(-1);let auditSaved=true,notification;
 try{await (await table("TenantUniformEventAudit")).createEntity({partitionKey:school,rowKey:event.id,action:"payment-resolution."+event.action,subjectId:sourceType+":"+id,actor:access.email,at:event.at,details:JSON.stringify(event)})}catch{auditSaved=false}
 try{notification=await notifyResolution(school,sourceType,{...next,id},event)}catch{notification={status:"failed"}}
 return {item:await paymentResolutionView(school,access,sourceType,{...next,id}),notification,auditSaved};
}
export async function receivePaymentRefundRequest(channel,userId,text){
 if(!/^#申請退費(?:\s|$)/u.test(text))return null;
 if(!paymentResolutionEnabled())return "此環境未開啟退費回覆。";
 const match=text.trim().match(/^#申請退費\s+([a-f0-9]{14})(?:\s+(.{1,300}))?$/iu);
 if(!userId||!match)return "請在本校官方帳號的一對一聊天室點「申請退費並取消」，或由平台申請。";
 try{
  const record=await get(await table("TenantPaymentResolutionReply"),channel.schoolId,match[1].toUpperCase());
  if(!record||record.userId!==userId||record.botUserId!==channel.botUserId||record.expiresAt<=Date.now())return "退費回覆代碼已失效，請到平台申請。";
  const binding=await getTenantLineRecipient(channel.schoolId,record.email,channel.botUserId);if(binding?.lineUserId!==userId)return "LINE 綁定已變更，請到平台申請。";
  const row=await get(await table(tables[record.sourceType]),channel.schoolId,record.sourceId),item=row&&decode(row);
  if(!item||item.paymentResolution?.caseId!==record.caseId)return "此筆款項已異動，請到平台查看。";
  if(item.paymentStatus==="REFUND_REQUESTED")return "已收到此筆退費申請，請到平台補齊退款帳戶，等待財務處理。";
  const mappings=await getMappedStudentsByEmail(record.email,channel.schoolId),aliases=await Promise.all(mappings.map(row=>getStudentAliasInfo(row.studentId,channel.schoolId))),access={role:"parent",email:record.email,students:[...mappings.map(x=>String(x.studentId)),...aliases.map(x=>String(x.canonicalStudentId))]};
  await applyPaymentResolution(channel.schoolId,access,{sourceType:record.sourceType,id:record.sourceId,action:"REQUEST_REFUND",requestId:randomUUID(),revision:item.paymentResolution.revision,reason:match[2]||"家長透過 LINE 申請退費"});
  return "✅ 已收到退費申請，流程已暫停。\n請至平台「活動團服 → 補款與退費」提供退款帳戶。財務完成退款後，原申請才會作廢。\n"+labNoticeUrl(channel.schoolId);
 }catch(e){return e instanceof PaymentResolutionError?e.message:"退費申請尚未確認，請到平台查看後再操作。"}
}
