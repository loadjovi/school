// Copied only into the generated Functional UAT LAB API.
// A random opaque cookie maps to a server-side Azure Table session; the raw
// LINE user ID is never written to browser storage or returned by an API.
import {createHash,randomBytes,randomInt} from "node:crypto";
import {TableClient,TableServiceClient} from "@azure/data-tables";
import {assertLabIsolation} from "./labIsolation.mjs";
import {
  bindLineAccount,
  createLineAccountBindingRequest,
  getLineAccountBinding,
  getLineAccountBindingsByUserId
} from "./lineAccountBinding.js";
import {lineBindingCodeHash} from "./lineMessaging.mjs";
import {resolveLabLineParentIdentity,safeLabLineDisplayName} from "./labLineAuthRules.mjs";

const tableName="LabLineAuthSessions";
const cookieName="orchestra_lab_line_session";
const sessionLifetimeMs=12*60*60*1000;
const hash=value=>createHash("sha256").update(String(value||"")).digest("hex");
let clientPromise=null;

async function client(){
  assertLabIsolation();
  if(!clientPromise){
    const connection=String(process.env.STORAGE_CONNECTION_STRING||"");
    if(!connection)throw Error("LAB storage unavailable");
    clientPromise=(async()=>{
      const service=TableServiceClient.fromConnectionString(connection);
      try{await service.createTable(tableName)}catch(error){if(error.statusCode!==409)throw error}
      return TableClient.fromConnectionString(connection,tableName);
    })();
  }
  try{return await clientPromise}catch(error){clientPromise=null;throw error}
}

function cookieValue(request){
  const raw=String(request.headers.get("cookie")||"");
  for(const part of raw.split(";")){
    const index=part.indexOf("=");
    if(index<0)continue;
    if(part.slice(0,index).trim()===cookieName)return decodeURIComponent(part.slice(index+1).trim());
  }
  return "";
}

export function labLineSessionCookie(token){
  return `${cookieName}=${encodeURIComponent(String(token||""))}; Path=/; Max-Age=${Math.floor(sessionLifetimeMs/1000)}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearLabLineSessionCookie(){
  return `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

async function sessionRow(request){
  const token=cookieValue(request);
  if(!/^[A-Za-z0-9_-]{32,64}$/.test(token))return null;
  try{
    const row=await (await client()).getEntity("SESSION",hash(token));
    if(row.status!=="ACTIVE"||Date.parse(String(row.expiresAt||""))<=Date.now())return null;
    return row;
  }catch(error){if(error.statusCode===404)return null;throw error}
}

export async function createLabLineSession({lineUserId,lineDisplayName}={}){
  assertLabIsolation();
  const bindings=await getLineAccountBindingsByUserId(lineUserId,{includeTarget:false});
  const resolved=resolveLabLineParentIdentity(lineUserId,bindings);
  if(!resolved.ok){
    const error=new Error(resolved.code);
    error.code=resolved.code;
    throw error;
  }
  const token=randomBytes(32).toString("base64url"),now=new Date(),expiresAt=new Date(now.getTime()+sessionLifetimeMs).toISOString();
  const displayName=safeLabLineDisplayName(lineDisplayName);
  await (await client()).createEntity({
    partitionKey:"SESSION",rowKey:hash(token),status:"ACTIVE",
    lineUserId:String(lineUserId),lineDisplayName:displayName,parentEmail:resolved.parentEmail,
    linkedExisting:resolved.linkedExisting,createdAt:now.toISOString(),expiresAt
  });
  return {token,displayName,parentEmail:resolved.parentEmail,linkedExisting:resolved.linkedExisting,expiresAt};
}

export async function getLabLineIdentity(request){
  const row=await sessionRow(request);
  if(!row)return null;
  return {
    sub:"line:"+hash(String(row.lineUserId||"")),
    email:String(row.parentEmail||"").trim().toLowerCase(),
    displayName:safeLabLineDisplayName(row.lineDisplayName),picture:null,
    authSessionId:"line-session:"+String(row.rowKey),authProvider:"line",
    lineUserId:String(row.lineUserId||"")
  };
}

export async function endLabLineSession(request){
  const row=await sessionRow(request);
  if(!row)return false;
  await (await client()).updateEntity({partitionKey:"SESSION",rowKey:row.rowKey,status:"ENDED",endedAt:new Date().toISOString()},"Merge",{etag:row.etag});
  return true;
}

export async function ensureLabLineParentBinding({request,schoolId,parentEmail}={}){
  const identity=await getLabLineIdentity(request);
  if(!identity||identity.authProvider!=="line")return {ok:true,skipped:true};
  const email=String(parentEmail||"").trim().toLowerCase();
  if(!email||email!==identity.email)throw Error("LAB LINE 登入身分不一致");
  const current=await getLineAccountBinding(schoolId,email,{includeTarget:true});
  if(current){
    if(String(current.lineUserId||"")!==String(identity.lineUserId||""))throw Error("此家長帳號已綁定其他 LINE 身分");
    return {ok:true,existing:true};
  }
  const secret=String(process.env.LINE_LOGIN_CHANNEL_SECRET||"");
  if(!secret)throw Error("LAB LINE Login 設定不完整");
  for(let attempt=0;attempt<3;attempt++){
    const code=String(randomInt(0,1_000_000)).padStart(6,"0"),codeHash=lineBindingCodeHash(code,secret);
    await createLineAccountBindingRequest({schoolId,email,codeHash,expiresAt:new Date(Date.now()+60_000).toISOString()});
    const result=await bindLineAccount({codeHash,lineUserId:identity.lineUserId,lineDisplayName:identity.displayName});
    if(result.ok)return {ok:true,existing:false};
    if(result.reason==="already_bound")throw Error("此 LINE 帳號已綁定其他家長身分");
  }
  throw Error("LAB LINE 家長身分綁定失敗");
}
