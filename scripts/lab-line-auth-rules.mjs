import {createHash} from "node:crypto";

const hash=value=>createHash("sha256").update(String(value||"")).digest("hex");

export function normalizeLabLineUserId(value){
  const userId=String(value||"").trim();
  return /^U[0-9a-f]{32}$/i.test(userId)?userId:"";
}

export function labLineInternalParentEmail(lineUserId){
  const userId=normalizeLabLineUserId(lineUserId);
  return userId?`line.${hash(userId).slice(0,32)}@lab.invalid`:"";
}

export function resolveLabLineParentIdentity(lineUserId,bindings=[]){
  const userId=normalizeLabLineUserId(lineUserId);
  if(!userId)return {ok:false,code:"INVALID_LINE_ID",parentEmail:"",linkedExisting:false};
  const emails=[...new Set((Array.isArray(bindings)?bindings:[])
    .map(row=>String(row?.parentEmail||"").trim().toLowerCase())
    .filter(Boolean))];
  if(emails.length>1)return {ok:false,code:"IDENTITY_CONFLICT",parentEmail:"",linkedExisting:false};
  return {
    ok:true,
    code:"OK",
    parentEmail:emails[0]||labLineInternalParentEmail(userId),
    linkedExisting:emails.length===1
  };
}

export function safeLabLineDisplayName(value){
  return String(value||"LINE 家長").replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,100)||"LINE 家長";
}

export function normalizeVerifiedGmail(value){
  const email=String(value||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.endsWith("@lab.invalid"))return "";
  return email;
}

export function isLabSyntheticParentEmail(value){
  return /^line\.[0-9a-f]{32}@lab\.invalid$/.test(String(value||"").trim().toLowerCase());
}

export function labParentIdentityPair(lineUserId,gmailEmail){
  const userId=normalizeLabLineUserId(lineUserId),email=normalizeVerifiedGmail(gmailEmail);
  if(!userId||!email)return null;
  const lineUserIdHash=hash(userId);
  return {
    gmailEmail:email,lineUserIdHash,
    lineRowKey:"line_"+lineUserIdHash.slice(0,48),
    gmailRowKey:"gmail_"+hash(email).slice(0,48),
    pairKey:hash(lineUserIdHash+":"+email)
  };
}

export function validateLabParentIdentityPair({lineUserId,gmailEmail,lineLink=null,gmailLink=null,lineBindings=[],gmailBindings=[]}={}){
  const pair=labParentIdentityPair(lineUserId,gmailEmail);
  if(!pair)return {ok:false,code:"INVALID_IDENTITY",pair:null};
  const linkedEmail=String(lineLink?.parentEmail||"").trim().toLowerCase();
  if(linkedEmail&&linkedEmail!==pair.gmailEmail)return {ok:false,code:"LINE_ALREADY_LINKED",pair};
  const linkedLineHash=String(gmailLink?.lineUserIdHash||"");
  if(linkedLineHash&&linkedLineHash!==pair.lineUserIdHash)return {ok:false,code:"GMAIL_ALREADY_LINKED",pair};
  if((Array.isArray(lineBindings)?lineBindings:[]).some(row=>{
    const email=String(row?.parentEmail||"").trim().toLowerCase();
    return email&&!isLabSyntheticParentEmail(email)&&email!==pair.gmailEmail;
  }))return {ok:false,code:"LINE_BINDING_CONFLICT",pair};
  if((Array.isArray(gmailBindings)?gmailBindings:[]).some(row=>{
    const userId=normalizeLabLineUserId(row?.lineUserId);
    const userIdHash=String(row?.lineUserIdHash||"")||(userId?hash(userId):"");
    return userIdHash&&userIdHash!==pair.lineUserIdHash;
  }))return {ok:false,code:"GMAIL_BINDING_CONFLICT",pair};
  return {ok:true,code:"OK",pair};
}
