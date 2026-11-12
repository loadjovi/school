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
