import {tenantSchoolPartition} from "./storage.js";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {getTenantLineDeliveryRecipient,getTenantLineAccount,getTenantGoogleLink,getTenantLineFriendship,lineHash} from "./tenantLineAccounts.js";

const email=value=>String(value||"").trim().toLowerCase();
const validUser=value=>/^U[0-9a-f]{32}$/i.test(value||"");
function timestamp(value){
  if(value===null||value===undefined||value==="")return null;
  const at=new Date(value);
  return Number.isFinite(at.getTime())?at.toISOString():null;
}
function statusView(status,checkedAt){
  return {status,displayName:"",linkedAt:null,friendStatus:"unknown",friendCheckedAt:null,checkedAt};
}

async function bindingFor(schoolId,address,channel,checkedAt){
  const incomplete=()=>statusView("needs_confirmation",checkedAt);
  try{
    // No legacy profile probes, account repairs or external LINE calls are
    // performed when an administrator reads the teacher directory.
    const modernChannel={...channel,acceptsLegacy:false};
    const recipient=await getTenantLineDeliveryRecipient(schoolId,address,modernChannel);
    if(!recipient)return statusView("unpaired",checkedAt);
    const sub=recipient.googleSub,parent=email(recipient.parentEmail),userId=recipient.lineUserId;
    if(recipient.deliveryOnly||typeof sub!=="string"||!sub||!parent||parent!==recipient.parentEmail||
      recipient.googleEmail!==address||!validUser(userId))return incomplete();
    const partition=tenantSchoolPartition(schoolId);
    const googleKey="google-"+lineHash(sub),lineKey="line-"+lineHash(channel.botUserId+":"+userId),parentKey="email-"+lineHash(parent);
    const matches=row=>row&&row.partitionKey===partition&&(!row.schoolId||row.schoolId===schoolId)&&
      row.botUserId===channel.botUserId&&row.lineUserId===userId&&row.parentEmail===parent&&
      row.googleSub===sub&&row.googleEmail===address;
    if(!matches(recipient)||![googleKey,lineKey,parentKey,"email-"+lineHash(address)].includes(recipient.rowKey))return incomplete();
    const [google,identity,parentIndex]=await Promise.all([
      getTenantGoogleLink(schoolId,sub),getTenantLineAccount(schoolId,channel.botUserId,userId),
      getTenantLineDeliveryRecipient(schoolId,parent,modernChannel)
    ]);
    if(!matches(google)||google.rowKey!==googleKey||!matches(identity)||identity.rowKey!==lineKey||
      !matches(parentIndex)||parentIndex.rowKey!==parentKey)return incomplete();
    const result={...statusView("paired",checkedAt),displayName:String(identity.displayName||"").trim().slice(0,100),linkedAt:timestamp(identity.linkedAt)};
    try{
      const friend=await getTenantLineFriendship(schoolId,channel.botUserId,userId);
      result.friendStatus=["friend","not_friend"].includes(friend?.status)?friend.status:"unknown";
      result.friendCheckedAt=timestamp(friend?.checkedAt);
    }catch{result.friendStatus="unavailable";}
    return result;
  }catch{return statusView("unavailable",checkedAt);}
}

// A read-only snapshot for the authorized school's directory. Pairing proves
// account linkage only; it neither grants teaching rights nor proves delivery.
export async function teacherLineBindingStatuses(schoolId,emails){
  const addresses=[...new Set((Array.isArray(emails)?emails:[]).map(email).filter(Boolean))],out=new Map();
  const checkedAt=new Date().toISOString();
  let channel;
  try{channel=await resolveTenantLineChannel(schoolId,{allowLegacyBotLookup:false});}
  catch{
    for(const address of addresses)out.set(address,statusView("unavailable",checkedAt));
    return out;
  }
  if(channel?.schoolId!==schoolId||!channel.loginConfigured||!validUser(channel.botUserId)){
    for(const address of addresses)out.set(address,statusView("not_configured",checkedAt));
    return out;
  }
  for(let start=0;start<addresses.length;start+=8){
    const batch=addresses.slice(start,start+8);
    const results=await Promise.all(batch.map(address=>bindingFor(schoolId,address,channel,checkedAt)));
    batch.forEach((address,index)=>out.set(address,results[index]));
  }
  return out;
}
