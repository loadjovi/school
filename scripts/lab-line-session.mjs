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
  getLineAccountBindingsByEmail,
  getLineAccountBindingsByUserId,
  moveLineAccountBinding
} from "./lineAccountBinding.js";
import {lineBindingCodeHash} from "./lineMessaging.mjs";
import {ensureTenantTables,table,tenantParentPartition,tenantSchoolPartition} from "./storage.js";
import {
  isLabSyntheticParentEmail,
  labParentIdentityPair,
  normalizeLabLineUserId,
  normalizeVerifiedGmail,
  resolveLabLineParentIdentity,
  safeLabLineDisplayName,
  validateLabParentIdentityPair
} from "./labLineAuthRules.mjs";

const tableName="LabLineAuthSessions";
const identityTableName="LabParentIdentityLinks";
const cookieName="orchestra_lab_line_session";
const sessionLifetimeMs=12*60*60*1000;
const hash=value=>createHash("sha256").update(String(value||"")).digest("hex");
let clientPromise=null,identityClientPromise=null;

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

async function identityClient(){
  assertLabIsolation();
  if(!identityClientPromise){
    const connection=String(process.env.STORAGE_CONNECTION_STRING||"");
    if(!connection)throw Error("LAB storage unavailable");
    identityClientPromise=(async()=>{
      const service=TableServiceClient.fromConnectionString(connection);
      try{await service.createTable(identityTableName)}catch(error){if(error.statusCode!==409)throw error}
      return TableClient.fromConnectionString(connection,identityTableName);
    })();
  }
  try{return await identityClientPromise}catch(error){identityClientPromise=null;throw error}
}

async function entityOrNull(db,partitionKey,rowKey){
  try{return await db.getEntity(partitionKey,rowKey)}catch(error){if(error.statusCode===404)return null;throw error}
}

async function identityRows(lineUserId,gmailEmail=""){
  const userId=normalizeLabLineUserId(lineUserId);
  if(!userId)return {pair:null,lineLink:null,gmailLink:null};
  const lineHash=hash(userId),lineRowKey="line_"+lineHash.slice(0,48),db=await identityClient();
  const lineLink=await entityOrNull(db,"IDENTITY",lineRowKey);
  if(!gmailEmail)return {pair:null,lineLink,gmailLink:null};
  const exact=labParentIdentityPair(lineUserId,gmailEmail);
  if(!exact)return {pair:null,lineLink,gmailLink:null};
  const gmailLink=await entityOrNull(db,"IDENTITY",exact.gmailRowKey);
  return {pair:exact,lineLink,gmailLink};
}

export async function getLabParentIdentityLink(lineUserId){
  const {lineLink}=await identityRows(lineUserId);
  if(!lineLink||lineLink.status!=="ACTIVE")return null;
  const parentEmail=normalizeVerifiedGmail(lineLink.parentEmail);
  return parentEmail?{parentEmail,linkedAt:String(lineLink.linkedAt||"")} : null;
}

async function persistLabParentIdentityLink({lineUserId,gmailEmail,lineBindings=[],gmailBindings=[]}={}){
  const email=normalizeVerifiedGmail(gmailEmail),rows=await identityRows(lineUserId,email);
  const checked=validateLabParentIdentityPair({lineUserId,gmailEmail:email,lineLink:rows.lineLink,gmailLink:rows.gmailLink,lineBindings,gmailBindings});
  if(!checked.ok){const error=Error(checked.code);error.code=checked.code;throw error}
  const {pair}=checked,now=new Date().toISOString(),db=await identityClient(),actions=[];
  if(!rows.lineLink)actions.push(["create",{partitionKey:"IDENTITY",rowKey:pair.lineRowKey,kind:"LINE",status:"ACTIVE",pairKey:pair.pairKey,parentEmail:pair.gmailEmail,lineUserIdHash:pair.lineUserIdHash,linkedAt:now,updatedAt:now}]);
  if(!rows.gmailLink)actions.push(["create",{partitionKey:"IDENTITY",rowKey:pair.gmailRowKey,kind:"GMAIL",status:"ACTIVE",pairKey:pair.pairKey,parentEmail:pair.gmailEmail,lineUserIdHash:pair.lineUserIdHash,linkedAt:now,updatedAt:now}]);
  if(actions.length)try{await db.submitTransaction(actions)}catch(error){
    if(error.statusCode!==409)throw error;
    const latest=await identityRows(lineUserId,email),retry=validateLabParentIdentityPair({lineUserId,gmailEmail:email,lineLink:latest.lineLink,gmailLink:latest.gmailLink,lineBindings,gmailBindings});
    if(!retry.ok){const conflict=Error(retry.code);conflict.code=retry.code;throw conflict}
  }
  return {gmailEmail:pair.gmailEmail,linkedAt:rows.lineLink?.linkedAt||rows.gmailLink?.linkedAt||now};
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

function sessionToken(request){
  // Keep the HttpOnly cookie, but also accept the same opaque LAB session
  // handle in a dedicated header. This is never a LINE access token or user
  // ID; it only identifies the short-lived server-side LAB session.
  const header=String(request.headers.get("x-lab-line-session")||"").trim();
  if(/^[A-Za-z0-9_-]{32,64}$/.test(header))return header;
  // Azure Static Web Apps already carries X-Google-ID-Token for every
  // authenticated API call. Reuse that established transport as a LAB-only
  // compatibility path when an intermediary omits the dedicated header.
  // The value is still only the opaque server-side session handle.
  const compatibility=String(request.headers.get("x-google-id-token")||"").trim();
  if(compatibility.startsWith("line-session.")){
    const handle=compatibility.slice(13);
    if(/^[A-Za-z0-9_-]{32,64}$/.test(handle))return handle;
  }
  return cookieValue(request);
}

export function labLineSessionCookie(token){
  return {
    name:cookieName,value:String(token||""),path:"/",
    maxAge:Math.floor(sessionLifetimeMs/1000),httpOnly:true,secure:true,sameSite:"Lax"
  };
}

export function clearLabLineSessionCookie(){
  return {name:cookieName,value:"",path:"/",maxAge:0,httpOnly:true,secure:true,sameSite:"Lax"};
}

async function sessionRow(request){
  const token=sessionToken(request);
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
  const identityLink=await getLabParentIdentityLink(lineUserId);
  const resolved=resolveLabLineParentIdentity(lineUserId,[...bindings,...(identityLink?[{parentEmail:identityLink.parentEmail}]:[])]);
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
    linkedExisting:resolved.linkedExisting,gmailLinked:Boolean(identityLink)||!isLabSyntheticParentEmail(resolved.parentEmail),createdAt:now.toISOString(),expiresAt
  });
  return {token,displayName,parentEmail:resolved.parentEmail,linkedExisting:resolved.linkedExisting,gmailLinked:Boolean(identityLink)||!isLabSyntheticParentEmail(resolved.parentEmail),expiresAt};
}

export async function getLabLineIdentity(request){
  const row=await sessionRow(request);
  if(!row)return null;
  return {
    sub:"line:"+hash(String(row.lineUserId||"")),
    email:String(row.parentEmail||"").trim().toLowerCase(),
    displayName:safeLabLineDisplayName(row.lineDisplayName),picture:null,
    authSessionId:"line-session:"+String(row.rowKey),authProvider:"line",
    lineUserId:String(row.lineUserId||""),gmailLinked:row.gmailLinked===true||!isLabSyntheticParentEmail(row.parentEmail)
  };
}

export async function endLabLineSession(request){
  const row=await sessionRow(request);
  if(!row)return false;
  await (await client()).updateEntity({partitionKey:"SESSION",rowKey:row.rowKey,status:"ENDED",endedAt:new Date().toISOString()},"Merge",{etag:row.etag});
  return true;
}

function cleanEntity(row,overrides={}){
  const next={...row,...overrides};
  delete next.etag;delete next.timestamp;delete next["odata.metadata"];
  return next;
}

async function migrateParentStudentAccess(sourceEmail,targetEmail){
  const source=String(sourceEmail||"").trim().toLowerCase(),target=normalizeVerifiedGmail(targetEmail);
  if(!source||!target)throw Error("LAB 家長帳號合併資料不完整");
  if(source===target)return {mappings:0,registrations:0,schoolIds:[]};
  await ensureTenantTables();
  const safe=source.replaceAll("'","''"),mappingTable=table("tenantUserStudentMap"),registrationTable=table("tenantRegistrations");
  const schoolIds=new Set(),mappings=[];
  for await(const row of mappingTable.listEntities({queryOptions:{filter:`parentEmail eq '${safe}'`}}))mappings.push(row);
  let mappingCount=0;
  for(const row of mappings){
    const schoolId=tenantSchoolPartition(row.schoolId||String(row.partitionKey||"").split("|parent|")[0]);
    schoolIds.add(schoolId);
    const destinationPartition=tenantParentPartition(schoolId,target),studentId=String(row.rowKey||"");
    let destination=await entityOrNull(mappingTable,destinationPartition,studentId);
    if(!destination||String(destination.status||"")!=="active"){
      const next=cleanEntity(row,{partitionKey:destinationPartition,rowKey:studentId,schoolId,parentEmail:target,status:"active",identityMergedAt:new Date().toISOString(),identitySourceKey:hash(source).slice(0,32)});
      await mappingTable.upsertEntity(next,"Replace");mappingCount++;
    }
    if(String(row.status||"")==="active")await mappingTable.updateEntity({partitionKey:row.partitionKey,rowKey:studentId,status:"merged",identityMergedAt:new Date().toISOString(),identityTargetKey:hash(target).slice(0,32)},"Merge",{etag:row.etag});
  }
  const registrations=[];
  for await(const row of registrationTable.listEntities({queryOptions:{filter:`parentEmail eq '${safe}'`}}))registrations.push(row);
  for(const row of registrations){
    const schoolId=tenantSchoolPartition(row.schoolId||row.partitionKey);schoolIds.add(schoolId);
    await registrationTable.updateEntity({partitionKey:row.partitionKey,rowKey:row.rowKey,parentEmail:target,identityMergedAt:new Date().toISOString(),identitySourceKey:hash(source).slice(0,32)},"Merge",{etag:row.etag});
  }
  return {mappings:mappingCount,registrations:registrations.length,schoolIds:[...schoolIds]};
}

async function promoteLineSessions(lineUserId,targetEmail){
  const db=await client(),safe=String(lineUserId||"").replaceAll("'","''"),rows=[];
  for await(const row of db.listEntities({queryOptions:{filter:`lineUserId eq '${safe}' and status eq 'ACTIVE'`}}))rows.push(row);
  for(const row of rows)await db.updateEntity({partitionKey:"SESSION",rowKey:row.rowKey,parentEmail:targetEmail,gmailLinked:true,identityLinkedAt:new Date().toISOString()},"Merge",{etag:row.etag});
  return rows.length;
}

export async function registerLabParentIdentityLink({lineUserId,gmailEmail}={}){
  const lineBindings=await getLineAccountBindingsByUserId(lineUserId,{includeTarget:true});
  const gmailBindings=await getLineAccountBindingsByEmail(gmailEmail,{includeTarget:true});
  return persistLabParentIdentityLink({lineUserId,gmailEmail,lineBindings,gmailBindings});
}

export async function linkLabLineIdentityToGmail({request,gmailEmail}={}){
  const identity=await getLabLineIdentity(request),targetEmail=normalizeVerifiedGmail(gmailEmail);
  if(!identity||identity.authProvider!=="line"){const error=Error("LINE_SESSION_REQUIRED");error.code="LINE_SESSION_REQUIRED";throw error}
  if(!targetEmail){const error=Error("INVALID_GMAIL");error.code="INVALID_GMAIL";throw error}
  const lineUserId=String(identity.lineUserId||""),sourceEmail=String(identity.email||"").trim().toLowerCase();
  const lineBindings=await getLineAccountBindingsByUserId(lineUserId,{includeTarget:true});
  const gmailBindings=await getLineAccountBindingsByEmail(targetEmail,{includeTarget:true});
  const rows=await identityRows(lineUserId,targetEmail),checked=validateLabParentIdentityPair({lineUserId,gmailEmail:targetEmail,lineLink:rows.lineLink,gmailLink:rows.gmailLink,lineBindings,gmailBindings});
  if(!checked.ok){const error=Error(checked.code);error.code=checked.code;throw error}
  const migrated=await migrateParentStudentAccess(sourceEmail,targetEmail);
  const schoolIds=new Set([...migrated.schoolIds,...lineBindings.map(row=>String(row.schoolId||"")).filter(Boolean).map(tenantSchoolPartition)]);
  for(const schoolId of schoolIds){
    const sourceBinding=lineBindings.find(row=>tenantSchoolPartition(row.schoolId)===schoolId&&String(row.parentEmail||"").toLowerCase()===sourceEmail);
    if(!sourceBinding)continue;
    const moved=await moveLineAccountBinding({schoolId,fromEmail:sourceEmail,toEmail:targetEmail,lineUserId});
    if(!moved.ok){const error=Error("LINE_BINDING_MOVE_"+moved.reason);error.code="LINE_BINDING_CONFLICT";throw error}
  }
  await persistLabParentIdentityLink({lineUserId,gmailEmail:targetEmail,lineBindings,gmailBindings});
  const sessions=await promoteLineSessions(lineUserId,targetEmail);
  return {ok:true,gmailEmail:targetEmail,sourceEmail,migratedMappings:migrated.mappings,migratedRegistrations:migrated.registrations,schoolIds:[...schoolIds],updatedSessions:sessions};
}

export async function getLabParentAccountLinkStatus({request,schoolId,parentEmail,authProvider="google"}={}){
  const provider=authProvider==="line"?"line":"google",email=String(parentEmail||"").trim().toLowerCase();
  let lineIdentity=null,binding=null;
  if(provider==="line")lineIdentity=await getLabLineIdentity(request);
  if(schoolId&&email)binding=await getLineAccountBinding(schoolId,email,{includeTarget:true});
  const lineUserId=String(lineIdentity?.lineUserId||binding?.lineUserId||"");
  if(provider==="google"&&lineUserId&&normalizeVerifiedGmail(email)){
    try{await registerLabParentIdentityLink({lineUserId,gmailEmail:email})}catch(error){if(!String(error?.code||"").includes("LINKED")&&!String(error?.code||"").includes("CONFLICT"))throw error}
  }
  const gmailEmail=normalizeVerifiedGmail(email);
  return {
    authProvider:provider,gmailLinked:Boolean(gmailEmail),gmailEmail,
    lineLinked:provider==="line"||Boolean(binding),lineDisplayName:safeLabLineDisplayName(lineIdentity?.displayName||binding?.lineDisplayName||"LINE 家長")
  };
}

export async function ensureLabLineParentBinding({request,schoolId,parentEmail}={}){
  const identity=await getLabLineIdentity(request);
  if(!identity||identity.authProvider!=="line")return {ok:true,skipped:true};
  const email=String(parentEmail||"").trim().toLowerCase();
  if(!email||email!==identity.email)throw Error("LAB LINE 登入身分不一致");
  const current=await getLineAccountBinding(schoolId,email,{includeTarget:true});
  if(current){
    if(String(current.lineUserId||"")!==String(identity.lineUserId||""))throw Error("此家長帳號已綁定其他 LINE 身分");
    if(normalizeVerifiedGmail(email))await registerLabParentIdentityLink({lineUserId:identity.lineUserId,gmailEmail:email});
    return {ok:true,existing:true};
  }
  const secret=String(process.env.LINE_LOGIN_CHANNEL_SECRET||"");
  if(!secret)throw Error("LAB LINE Login 設定不完整");
  for(let attempt=0;attempt<3;attempt++){
    const code=String(randomInt(0,1_000_000)).padStart(6,"0"),codeHash=lineBindingCodeHash(code,secret);
    await createLineAccountBindingRequest({schoolId,email,codeHash,expiresAt:new Date(Date.now()+60_000).toISOString()});
    const result=await bindLineAccount({codeHash,lineUserId:identity.lineUserId,lineDisplayName:identity.displayName});
    if(result.ok){
      if(normalizeVerifiedGmail(email))await registerLabParentIdentityLink({lineUserId:identity.lineUserId,gmailEmail:email});
      return {ok:true,existing:false};
    }
    if(result.reason==="already_bound")throw Error("此 LINE 帳號已綁定其他家長身分");
  }
  throw Error("LAB LINE 家長身分綁定失敗");
}
