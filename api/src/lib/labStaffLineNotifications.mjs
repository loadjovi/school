import {createHash} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {financeAssignments} from "./financeAccess.js";
import {financeRecipients} from "./financeNoticeRules.mjs";
import {getLineAccountBinding} from "./lineAccountBinding.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {getTenantDirectory,listTenantAdmins} from "./storage.js";

const tableName="LabStaffLineNotification";
const appUrl=()=>"https://icy-ocean-0a2602100.6.azurestaticapps.net/";
const email=value=>String(value||"").trim().toLowerCase();
const key=value=>createHash("sha256").update(String(value)).digest("hex");
const client=()=>TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,tableName);

async function claim(schoolId,eventKey,recipient){
  const db=client();await db.createTable().catch(error=>{if(error.statusCode!==409)throw error});
  try{
    await db.createEntity({partitionKey:String(schoolId),rowKey:key(`${eventKey}:${recipient}`),eventKey:String(eventKey).slice(0,300),recipient:email(recipient),status:"SENDING",createdAt:new Date().toISOString()});
    return true;
  }catch(error){
    if(error.statusCode!==409)throw error;
    const row=await db.getEntity(String(schoolId),key(`${eventKey}:${recipient}`));
    if(row.status!=="FAILED")return false;
    await db.updateEntity({partitionKey:row.partitionKey,rowKey:row.rowKey,status:"SENDING",updatedAt:new Date().toISOString(),error:""},"Merge",{etag:row.etag});
    return true;
  }
}

async function finish(schoolId,eventKey,recipient,status,error=""){
  await client().updateEntity({partitionKey:String(schoolId),rowKey:key(`${eventKey}:${recipient}`),status,updatedAt:new Date().toISOString(),error:String(error||"").slice(0,500)},"Merge");
}

async function deliver(schoolId,eventKey,recipients,text){
  if(process.env.LAB_ENVIRONMENT!=="functional-uat")return {status:"disabled",sent:0,skipped:recipients.length};
  let sent=0,skipped=0,failed=0;
  for(const recipient of [...new Set(recipients.map(email).filter(Boolean))]){
    let binding;
    try{binding=await getLineAccountBinding(schoolId,recipient,{includeTarget:true})}catch(error){console.error("staff LINE binding lookup failed",{schoolId,recipient,error:error.message});failed++;continue}
    if(!binding?.lineUserId){skipped++;continue}
    if(!await claim(schoolId,eventKey,recipient)){skipped++;continue}
    try{await pushLineMessage(binding.lineUserId,text);await finish(schoolId,eventKey,recipient,"SENT");sent++}
    catch(error){await finish(schoolId,eventKey,recipient,"FAILED",error?.message||error);console.error("staff LINE push failed",{schoolId,recipient,error:error?.message});failed++}
  }
  return {status:failed?"partial":"complete",sent,skipped,failed};
}

export async function notifyPendingParentRegistration({schoolId,registrationId,studentName=""}={}){
  try{
    const [admins,school]=await Promise.all([listTenantAdmins(schoolId,"active"),getTenantDirectory(schoolId)]);
    const recipients=admins.filter(item=>item.role==="schoolAdmin"&&item.status==="active").map(item=>item.partitionKey||item.email);
    const text=`🔔 新家長綁定待審\n學校：${school?.schoolName||school?.systemName||"聖心弦樂團"}\n學生：${String(studentName||"待確認").slice(0,40)}\n\n請登入平台的「待辦事項」完成家長身分審核。\n${appUrl()}`;
    return await deliver(schoolId,`parent-registration:${registrationId}`,recipients,text);
  }catch(error){console.error("pending parent LINE notification failed",{schoolId,error:error?.message});return {status:"failed",sent:0,failed:1}}
}

export async function notifyFinanceTransferReports({schoolId,notices=[]}={}){
  try{
    const reported=notices.filter(item=>item.category==="finance"&&item.stage==="reported");
    if(!reported.length)return {status:"not_required",sent:0};
    const [admins,assignments,school]=await Promise.all([listTenantAdmins(schoolId,"active"),financeAssignments(schoolId),getTenantDirectory(schoolId)]);
    const recipients=financeRecipients(admins,assignments);let sent=0,skipped=0,failed=0;
    for(const notice of reported){
      const amount=Number.isSafeInteger(notice.amount)?`NT$ ${notice.amount.toLocaleString("zh-TW")}`:"請至平台確認";
      const text=`💰 家長匯款待核帳\n學校：${school?.schoolName||school?.systemName||"聖心弦樂團"}\n項目：${String(notice.title||"收費項目").slice(0,60)}\n金額：${amount}\n\n請登入平台的「待辦事項／財務核帳」處理。\n${appUrl()}`;
      const result=await deliver(schoolId,`finance-transfer:${notice.sourceType}:${notice.itemId}:${notice.version}`,recipients,text);
      sent+=result.sent||0;skipped+=result.skipped||0;failed+=result.failed||0;
    }
    return {status:failed?"partial":"complete",sent,skipped,failed};
  }catch(error){console.error("finance LINE notification failed",{schoolId,error:error?.message});return {status:"failed",sent:0,failed:1}}
}
