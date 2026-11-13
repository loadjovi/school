// Generated into the isolated Functional UAT LAB only; never loaded by Production.
// OAuth state and completion tickets are single-use Azure Table entities.
import {app} from "@azure/functions";
import {randomBytes,randomInt,randomUUID,createHash} from "node:crypto";
import {TableClient,TableServiceClient} from "@azure/data-tables";
import {getTenantContext,json,verifyGoogleToken} from "../lib/auth.js";
import {tenantSchoolPartition} from "../lib/storage.js";
import {createLineAccountBindingRequest,bindLineAccount,getLineAccountBinding} from "../lib/lineAccountBinding.js";
import {lineBindingCodeHash} from "../lib/lineMessaging.mjs";
import {parentCoverageKey} from "../lib/labLineStudentCoverage.mjs";
import {
  clearLabLineSessionCookie,
  createLabLineSession,
  endLabLineSession,
  issueLabLineApiAssertion,
  getLabParentAccountLinkStatus,
  getLabLineIdentity,
  labLineSessionCookie,
  linkLabLineIdentityToGmail,
  registerLabParentIdentityLink
} from "../lib/labLineSession.mjs";
import {
  LAB_LINE_NOTIFICATION_STATES,
  classifyLinePushResult,
  labSingleTestMessage,
  maskEmail,
  maskLineUserId,
  reserveRollingWindow,
  validateLabRecipient
} from "../lib/labLineNotificationSafety.mjs";

const ORIGIN="https://icy-ocean-0a2602100.6.azurestaticapps.net";
const CALLBACK=ORIGIN+"/api/line/login/callback";
const PAGE=ORIGIN+"/fee-collections.html";
const LOGIN_PAGE=ORIGIN+"/";
const oauthTableName="LabLineOAuthTransactions";
const notificationTableName="LabLineNotificationLog";
const friendStatusTableName="LabLineFriendStatus";
const hash=v=>createHash("sha256").update(String(v)).digest("hex");
const random=()=>randomBytes(32).toString("base64url");
const response=(body,status=200,headers={},cookies=[])=>({
  status,jsonBody:body,headers:{"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8",...headers},
  ...(cookies.length?{cookies}:{})
});
const redirect=(result,returnTo="fees")=>({status:303,headers:{"Location":(returnTo==="home"?LOGIN_PAGE+"?line_lab_link=":PAGE+"?line_lab_result=")+encodeURIComponent(result),"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
const authRedirect=(result)=>({status:303,headers:{"Location":LOGIN_PAGE+"?line_lab_auth="+encodeURIComponent(result),"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
const config=()=>({id:String(process.env.LINE_LOGIN_CHANNEL_ID||""),secret:String(process.env.LINE_LOGIN_CHANNEL_SECRET||""),uri:String(process.env.LINE_LOGIN_REDIRECT_URI||"")});
const tableClients=new Map();
async function storageTable(name){
  assertLabIsolation();
  if(!tableClients.has(name)){
    const conn=process.env.STORAGE_CONNECTION_STRING;
    if(!conn)throw Error("LAB storage unavailable");
    tableClients.set(name,(async()=>{
      const service=TableServiceClient.fromConnectionString(conn);
      try{await service.createTable(name)}catch(e){if(e.statusCode!==409)throw e}
      return TableClient.fromConnectionString(conn,name);
    })());
  }
  try{return await tableClients.get(name)}catch(error){tableClients.delete(name);throw error}
}
const storage=()=>storageTable(oauthTableName);
const notificationStorage=()=>storageTable(notificationTableName);
const friendStatusStorage=()=>storageTable(friendStatusTableName);
async function saveFriendStatus({schoolId,email,friendStatus}){
  const status=["friend","not_friend","unknown"].includes(String(friendStatus||""))?String(friendStatus):"unknown";
  await (await friendStatusStorage()).upsertEntity({
    partitionKey:tenantSchoolPartition(schoolId),rowKey:parentCoverageKey(schoolId,email),
    friendStatus:status,checkedAt:new Date().toISOString()
  },"Replace");
}
async function migrateFriendStatus({schoolIds=[],sourceEmail,targetEmail}){
  if(!sourceEmail||!targetEmail||sourceEmail===targetEmail)return;
  const db=await friendStatusStorage();
  for(const schoolId of schoolIds){
    const sid=tenantSchoolPartition(schoolId),sourceKey=parentCoverageKey(sid,sourceEmail),targetKey=parentCoverageKey(sid,targetEmail);
    try{
      const row=await db.getEntity(sid,sourceKey);
      await db.upsertEntity({partitionKey:sid,rowKey:targetKey,friendStatus:String(row.friendStatus||"unknown"),checkedAt:String(row.checkedAt||new Date().toISOString()),identityMergedAt:new Date().toISOString()},"Replace");
    }catch(error){if(error.statusCode!==404)throw error}
  }
}
async function getRow(key){
  try{return await (await storage()).getEntity("LAB",hash(key))}
  catch(e){if(e.statusCode===404)return null;throw e}
}
async function consume(row){
  // ETag optimistic concurrency prevents replay and concurrent redemption.
  await (await storage()).updateEntity({partitionKey:"LAB",rowKey:row.rowKey,status:"USED"},"Merge",{etag:row.etag});
}
const notificationPartition=schoolId=>"LAB_"+hash(String(schoolId||"")).slice(0,40);
const safeText=(value,max=100)=>String(value||"").replace(/[\u0000-\u001f\u007f]/g,"").slice(0,max);
async function createNotificationRecord({requestId,schoolId,email,lineUserId}){
  const now=new Date().toISOString(),reverse=String(9_999_999_999_999-Date.now()).padStart(13,"0");
  const record={
    partitionKey:notificationPartition(schoolId),rowKey:reverse+"_"+requestId.replaceAll("-",""),
    requestId,notificationType:"LAB_SINGLE_TEST",recipientParent:maskEmail(email),recipientKey:hash(String(schoolId)+":"+String(email)).slice(0,24),
    lineUserIdMasked:maskLineUserId(lineUserId),source:"PARENT_SELF_TEST",status:LAB_LINE_NOTIFICATION_STATES.CREATED,
    isLab:true,createdAt:now,updatedAt:now,lineApiHttpStatus:0,errorCode:"",lineRequestId:""
  };
  await (await notificationStorage()).createEntity(record);
  return record;
}
async function updateNotificationRecord(record,status,fields={}){
  await (await notificationStorage()).updateEntity({
    partitionKey:record.partitionKey,rowKey:record.rowKey,status,updatedAt:new Date().toISOString(),...fields
  },"Merge");
}
async function markNotificationUnknown(record,errorCode){
  if(!record)return;
  try{await updateNotificationRecord(record,LAB_LINE_NOTIFICATION_STATES.UNKNOWN,{errorCode:safeText(errorCode||"LINE_RESULT_UNKNOWN",80)})}
  catch{console.error("LAB LINE notification audit update failed",record.requestId)}
}
async function listNotificationRecords(schoolId){
  const items=[],partitionKey=notificationPartition(schoolId),db=await notificationStorage();
  for await(const row of db.listEntities({queryOptions:{filter:`PartitionKey eq '${partitionKey}'`}})){
    items.push({
      requestId:safeText(row.requestId,80),notificationType:safeText(row.notificationType,60),recipientParent:safeText(row.recipientParent,120),
      lineUserIdMasked:safeText(row.lineUserIdMasked,40),source:safeText(row.source,60),status:safeText(row.status,30),
      lineApiHttpStatus:Number(row.lineApiHttpStatus||0)||null,errorCode:safeText(row.errorCode,80),lineRequestId:safeText(row.lineRequestId,100),
      isLab:row.isLab===true,createdAt:String(row.createdAt||""),updatedAt:String(row.updatedAt||"")
    });
    if(items.length>=100)break;
  }
  return items;
}
async function parent(request){
  const ctx=await getTenantContext(request);
  if(ctx.error)return {error:ctx.error};
  if(ctx.access.role!=="parent")return {error:response({error:"LAB 家長帳號限定"},403)};
  return ctx;
}
async function parentAccount(request){
  const ctx=await getTenantContext(request,{allowUnassigned:true});
  if(ctx.error)return {error:ctx.error};
  if(!["parent","unassigned"].includes(ctx.access.role))return {error:response({error:"僅家長帳號可設定登入方式"},403)};
  return ctx;
}
function enabled(){
  const c=config();
  return process.env.LAB_ENVIRONMENT==="functional-uat"&&c.id==="2012482463"&&!!c.secret&&c.uri===CALLBACK;
}
app.http("labLineLoginStart",{methods:["POST"],authLevel:"anonymous",route:"line/login/start",handler:async request=>{
  try{
    if(!enabled())return response({error:"LAB LINE Login 尚未啟用或設定不完整"},503);
    const ctx=await parentAccount(request);if(ctx.error)return ctx.error;
    let input={};try{input=await request.json()}catch{}
    const returnTo=input?.returnTo==="home"?"home":"fees";
    const state=random(),nonce=random(),verifier=random(),challenge=createHash("sha256").update(verifier).digest("base64url");
    await (await storage()).createEntity({partitionKey:"LAB",rowKey:hash(state),kind:"STATE",flow:"LINK",returnTo,status:"ACTIVE",nonce,verifier,schoolId:ctx.schoolId,parentEmail:ctx.access.email,expiresAt:Date.now()+600000});
    const q=new URLSearchParams({response_type:"code",client_id:config().id,redirect_uri:CALLBACK,state,nonce,scope:"profile openid",bot_prompt:"aggressive",code_challenge:challenge,code_challenge_method:"S256"});
    return response({authorizationUrl:"https://access.line.me/oauth2/v2.1/authorize?"+q.toString()});
  }catch(e){console.error("LAB LINE start error",e?.message);return response({error:"無法啟動 LINE 連結"},500)}
}});
app.http("labLineAuthStart",{methods:["POST"],authLevel:"anonymous",route:"line/auth/start",handler:async()=>{
  try{
    if(!enabled())return response({error:"LAB LINE Login 尚未啟用或設定不完整"},503);
    assertLabIsolation();
    const state=random(),nonce=random(),verifier=random(),challenge=createHash("sha256").update(verifier).digest("base64url");
    await (await storage()).createEntity({partitionKey:"LAB",rowKey:hash(state),kind:"STATE",flow:"AUTH",status:"ACTIVE",nonce,verifier,expiresAt:Date.now()+600000});
    const q=new URLSearchParams({response_type:"code",client_id:config().id,redirect_uri:CALLBACK,state,nonce,scope:"profile openid",bot_prompt:"aggressive",code_challenge:challenge,code_challenge_method:"S256"});
    return response({authorizationUrl:"https://access.line.me/oauth2/v2.1/authorize?"+q.toString()});
  }catch(error){console.error("LAB LINE auth start error",String(error?.name||"Error"));return response({error:"無法啟動 LINE 登入"},500)}
}});
app.http("labLineLoginCallback",{methods:["GET"],authLevel:"anonymous",route:"line/login/callback",handler:async request=>{
  const url=new URL(request.url),state=url.searchParams.get("state")||"",code=url.searchParams.get("code")||"";
  let callbackIsAuth=false,callbackReturnTo="fees";
  try{
    if(!enabled()||!state)return redirect("cancelled");
    const row=await getRow(state);
    const isAuth=row?.flow==="AUTH";
    callbackIsAuth=isAuth;
    callbackReturnTo=row?.returnTo==="home"?"home":"fees";
    const sendResult=result=>isAuth?authRedirect(result):redirect(result,callbackReturnTo);
    if(!row||row.kind!=="STATE"||row.status!=="ACTIVE"||Number(row.expiresAt)<Date.now())return sendResult("expired");
    if(!code||url.searchParams.has("error")){await consume(row);return sendResult("cancelled")}
    await consume(row); // burn state before any external request
    const form=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:CALLBACK,client_id:config().id,client_secret:config().secret,code_verifier:row.verifier});
    const tokenRes=await fetch("https://api.line.me/oauth2/v2.1/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
    if(!tokenRes.ok)return sendResult("token_error");
    const token=await tokenRes.json();
    if(!token.id_token||!token.access_token)return sendResult("token_error");
    const verifyRes=await fetch("https://api.line.me/oauth2/v2.1/verify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({id_token:token.id_token,client_id:config().id,nonce:row.nonce})});
    if(!verifyRes.ok)return sendResult("identity_error");
    const identity=await verifyRes.json();
    if(identity.aud!==config().id||!/^U[0-9a-f]{32}$/i.test(String(identity.sub||""))||identity.nonce!==row.nonce)return sendResult("identity_error");
    let friend="unknown";
    try{
      const fr=await fetch("https://api.line.me/friendship/v1/status",{headers:{Authorization:"Bearer "+token.access_token}});
      if(fr.ok){const data=await fr.json();friend=data.friendFlag===true?"friend":"not_friend"}
    }catch{}
    const ticket=random();
    await (await storage()).createEntity({partitionKey:"LAB",rowKey:hash(ticket),kind:isAuth?"AUTH_TICKET":"TICKET",status:"ACTIVE",returnTo:callbackReturnTo,schoolId:row.schoolId||"",parentEmail:row.parentEmail||"",lineUserId:identity.sub,lineDisplayName:String(identity.name||"LINE 家長").slice(0,100),friendStatus:friend,expiresAt:Date.now()+180000});
    return sendResult("ok."+ticket);
  }catch(e){console.error("LAB LINE callback failed",String(e?.name||"Error"));return callbackIsAuth?authRedirect("failed"):redirect("failed",callbackReturnTo)}
}});
app.http("labLineAuthFinish",{methods:["POST"],authLevel:"anonymous",route:"line/auth/finish",handler:async request=>{
  try{
    if(!enabled())return response({error:"LAB LINE Login 未啟用"},503);
    assertLabIsolation();
    const body=await request.json(),ticket=String(body.ticket||"");
    if(!/^[A-Za-z0-9_-]{32,64}$/.test(ticket))return response({error:"無效的 LINE 授權結果"},400);
    const row=await getRow(ticket);
    if(!row||row.kind!=="AUTH_TICKET"||row.status!=="ACTIVE"||Number(row.expiresAt)<Date.now())return response({error:"LINE 授權已過期，請重新登入"},403);
    await consume(row);
    const session=await createLabLineSession({lineUserId:row.lineUserId,lineDisplayName:row.lineDisplayName});
    return response({authenticated:true,authProvider:"line",displayName:session.displayName,linkedExisting:session.linkedExisting,sessionToken:session.token,apiToken:session.apiToken},200,{},[labLineSessionCookie(session.token)]);
  }catch(error){
    const conflict=error?.code==="IDENTITY_CONFLICT";
    console.error("LAB LINE auth finish failed",String(error?.code||error?.name||"Error"));
    return response({error:conflict?"此 LINE 帳號對應多個既有家長身分，請由管理員確認":"LAB LINE 登入失敗，請重新操作"},conflict?409:500);
  }
}});
app.http("labLineAuthSession",{methods:["GET"],authLevel:"anonymous",route:"line/auth/session",handler:async request=>{
  try{
    if(!enabled())return response({authenticated:false},401);
    const identity=await getLabLineIdentity(request);
    if(!identity)return response({authenticated:false},401);
    const apiToken=await issueLabLineApiAssertion(request);
    if(!apiToken)return response({authenticated:false},401);
    return response({authenticated:true,authProvider:"line",displayName:identity.displayName,apiToken});
  }catch(error){console.error("LAB LINE session check failed",String(error?.name||"Error"));return response({authenticated:false},401)}
}});
app.http("labLineAuthLogout",{methods:["POST"],authLevel:"anonymous",route:"line/auth/logout",handler:async request=>{
  try{await endLabLineSession(request)}catch(error){console.error("LAB LINE logout failed",String(error?.name||"Error"))}
  return response({ok:true},200,{},[clearLabLineSessionCookie()]);
}});
app.http("labLineAccountStatus",{methods:["GET"],authLevel:"anonymous",route:"line/account/status",handler:async request=>{
  try{
    if(!enabled())return response({error:"LAB 帳號綁定未啟用"},503);
    const ctx=await getTenantContext(request,{allowUnassigned:true});if(ctx.error)return ctx.error;
    if(!["parent","unassigned"].includes(ctx.access.role))return response({error:"僅家長帳號可查看登入綁定狀態"},403);
    const status=await getLabParentAccountLinkStatus({request,schoolId:ctx.schoolId,parentEmail:ctx.access.email,authProvider:ctx.access.authProvider||"google"});
    return response({authProvider:status.authProvider,gmailLinked:status.gmailLinked,gmailMasked:status.gmailLinked?maskEmail(status.gmailEmail):"",lineLinked:status.lineLinked,lineDisplayName:status.lineLinked?status.lineDisplayName:""});
  }catch(error){console.error("LAB account link status failed",String(error?.code||error?.name||"Error"));return response({error:"無法讀取登入方式綁定狀態"},500)}
}});
app.http("labLineLinkGoogle",{methods:["POST"],authLevel:"anonymous",route:"line/account/link-google",handler:async request=>{
  try{
    if(!enabled())return response({error:"LAB 帳號綁定未啟用"},503);
    const lineIdentity=await getLabLineIdentity(request);
    if(!lineIdentity)return response({error:"請先使用 LINE 登入"},401);
    const body=await request.json(),credential=String(body?.credential||"").trim();
    if(!credential||credential.length>10000)return response({error:"Google 授權憑證無效"},400);
    const googleIdentity=await verifyGoogleToken(credential);
    if(!googleIdentity)return response({error:"Gmail 驗證失敗，請重新選擇 Google 帳號"},401);
    const result=await linkLabLineIdentityToGmail({request,gmailEmail:googleIdentity.email});
    await migrateFriendStatus({schoolIds:result.schoolIds,sourceEmail:result.sourceEmail,targetEmail:result.gmailEmail});
    return response({linked:true,gmailMasked:maskEmail(result.gmailEmail),migratedStudents:result.migratedMappings,migratedRegistrations:result.migratedRegistrations});
  }catch(error){
    const code=String(error?.code||"");
    const conflict=code.includes("LINKED")||code.includes("CONFLICT")||code.includes("MISMATCH");
    console.error("LAB Gmail link failed",code||String(error?.name||"Error"));
    return response({error:conflict?"此 Gmail 或 LINE 已連結其他家長身分，請由管理員確認":"Gmail 綁定失敗，請重新操作"},conflict?409:500);
  }
}});
app.http("labLineLoginFinish",{methods:["POST"],authLevel:"anonymous",route:"line/login/finish",handler:async request=>{
  try{
    if(!enabled())return response({error:"LAB LINE Login 未啟用"},503);
    const ctx=await parentAccount(request);if(ctx.error)return ctx.error;
    const body=await request.json(),ticket=String(body.ticket||"");
    if(!/^[A-Za-z0-9_-]{32,64}$/.test(ticket))return response({error:"無效的 LINE 授權結果"},400);
    const row=await getRow(ticket);
    if(!row||row.kind!=="TICKET"||row.status!=="ACTIVE"||Number(row.expiresAt)<Date.now()||row.schoolId!==ctx.schoolId||row.parentEmail!==ctx.access.email)return response({error:"LINE 授權已過期或不屬於目前家長"},403);
    await consume(row);
    await registerLabParentIdentityLink({lineUserId:row.lineUserId,gmailEmail:ctx.access.email});
    // Legacy binding storage requires a six-digit code; generate it server-side only.
    const code=String(randomInt(0,1000000)).padStart(6,"0"),codeHash=lineBindingCodeHash(code,config().secret);
    if(!codeHash)throw Error("LAB internal binding hash unavailable");
    await createLineAccountBindingRequest({schoolId:ctx.schoolId,email:ctx.access.email,codeHash,expiresAt:new Date(Date.now()+60000).toISOString()});
    const result=await bindLineAccount({codeHash,lineUserId:row.lineUserId,lineDisplayName:row.lineDisplayName});
    if(!result.ok)return response({error:"綁定失敗："+result.reason},409);
    try{await saveFriendStatus({schoolId:ctx.schoolId,email:ctx.access.email,friendStatus:row.friendStatus})}
    catch(error){console.error("LAB LINE friend-status persistence failed",String(error?.name||"Error").slice(0,40))}
    return response({bound:true,friendStatus:row.friendStatus,lineDisplayName:row.lineDisplayName});
  }catch(e){
    const code=String(e?.code||"");
    const conflict=code.includes("LINKED")||code.includes("CONFLICT")||code.includes("MISMATCH");
    console.error("LAB LINE finish failed",code||String(e?.name||"Error"));
    return response({error:conflict?"此 Gmail 或 LINE 已連結其他家長身分，請由管理員確認":"LAB LINE 綁定失敗（請由管理員檢查後端日誌）"},conflict?409:500)
  }
}});

/** Functional UAT ONLY: masked delivery-attempt ledger for authorized admins. */
app.http("labLineNotificationLog",{
  methods:["GET"],authLevel:"anonymous",route:"line/lab-notification-log",
  handler:async request=>{
    try{
      assertLabIsolation();
      const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
      if(ctx.access.role!=="admin"||ctx.access.capabilities?.tenantAdmin!==true)return response({error:"僅授權學校管理員可查看 LAB LINE 發送紀錄"},403);
      return response({
        items:await listNotificationRecords(ctx.schoolId),
        states:Object.values(LAB_LINE_NOTIFICATION_STATES),
        note:"LINE API 已接受只代表請求受理，不代表家長已讀或實際送達。"
      });
    }catch(error){
      console.error("LAB LINE notification log query failed",String(error?.name||"Error").slice(0,40));
      return response({error:"無法讀取 LAB LINE 發送紀錄"},500);
    }
  }
});
/**
 * Functional UAT ONLY: single recipient, fixed-content LINE test.
 * Disabled until both LAB_LINE_TEST_USER_ID and LAB_LINE_MESSAGING_ACCESS_TOKEN
 * are set in the isolated Azure Static Web App settings.
 * Never accepts a target or message body from the browser.
 */
app.http("labLineSendTestNotification",{
  methods:["POST"],authLevel:"anonymous",route:"line/lab-send-test",
  handler:async request=>{
    let audit=null;
    try{
      if(!enabled())return response({error:"LAB LINE Login 未啟用"},503);
      assertLabIsolation();
      const ctx=await parent(request);if(ctx.error)return ctx.error;
      const email=String(ctx.access.email||"").trim().toLowerCase();
      const allowedEmail=String(process.env.LAB_LINE_TEST_PARENT_EMAIL||"").trim().toLowerCase();
      const allowedId=String(process.env.LAB_LINE_TEST_USER_ID||"").trim();
      const token=String(process.env.LAB_LINE_MESSAGING_ACCESS_TOKEN||"").trim();
      const binding=await getLineAccountBinding(ctx.schoolId,email,{includeTarget:true});
      const guard=validateLabRecipient({email,allowedEmail,allowedLineUserId:allowedId,binding,tokenConfigured:Boolean(token)});
      if(!guard.ok){
        const messages={
          NOT_ALLOWLISTED:"只有指定 LAB 測試家長可以發送",
          CONFIGURATION_INVALID:"LAB 單人發送尚未設定；未發送訊息",
          NOT_BOUND:"目前家長尚未綁定指定 LINE 帳號；未發送訊息",
          TARGET_MISMATCH:"LINE 綁定與指定測試帳號不符；未發送訊息"
        };
        return response({error:messages[guard.code]||"LAB 單人發送安全檢查失敗；未發送訊息",code:guard.code},guard.httpStatus);
      }
      // Atomic rolling 60-second reservation. Storage errors fail closed and no
      // call to LINE occurs; concurrent requests can never both obtain a slot.
      const key="SEND_"+hash(ctx.schoolId+":"+email);
      const now=Date.now(),db=await storage();
      const slot=await reserveRollingWindow({
        key,now,
        read:async rowKey=>{try{return await db.getEntity("LAB_SEND_RATE",rowKey)}catch(error){if(error.statusCode===404)return null;throw error}},
        create:async({key:rowKey,sentAt})=>db.createEntity({partitionKey:"LAB_SEND_RATE",rowKey,sentAt}),
        replace:async({key:rowKey,sentAt,etag})=>db.updateEntity({partitionKey:"LAB_SEND_RATE",rowKey,sentAt},"Replace",{etag})
      });
      if(!slot.ok)return response({error:"請至少間隔 60 秒再測試",code:slot.code,retryAfterSeconds:Math.max(1,Math.ceil(slot.retryAfterMs/1000))},429);

      const requestId=randomUUID();
      audit=await createNotificationRecord({requestId,schoolId:ctx.schoolId,email,lineUserId:allowedId});
      await updateNotificationRecord(audit,LAB_LINE_NOTIFICATION_STATES.SENDING);
      let sent;
      try{
        sent=await fetch("https://api.line.me/v2/bot/message/push",{
          method:"POST",signal:AbortSignal.timeout(10000),
          headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","X-Line-Retry-Key":requestId},
          body:JSON.stringify({to:allowedId,messages:[{type:"text",text:labSingleTestMessage()}]})
        });
      }catch(error){
        const result=classifyLinePushResult({error});
        await markNotificationUnknown(audit,result.errorCode);
        return response({error:"LINE API 回應狀態未知，請勿立即重送；請由管理員查看發送紀錄",requestId,status:result.state},502);
      }
      const result=classifyLinePushResult({httpStatus:sent.status});
      const lineRequestId=safeText(sent.headers?.get?.("x-line-request-id"),100);
      await updateNotificationRecord(audit,result.state,{lineApiHttpStatus:Number(sent.status||0),errorCode:result.errorCode,lineRequestId});
      if(result.state!==LAB_LINE_NOTIFICATION_STATES.ACCEPTED){
        console.error("LAB LINE single push rejected",sent.status,requestId);
        return response({error:"LINE API 拒絕發送，HTTP "+sent.status+"；請由管理員查看發送紀錄",requestId,status:result.state},502);
      }
      return response({accepted:true,requestId,status:result.state,message:"LINE API 已接受單人測試訊息；這不代表已讀，請在手機確認實際收到"});
    }catch(e){
      await markNotificationUnknown(audit,"LAB_HANDLER_ERROR");
      console.error("LAB LINE test send error",audit?.requestId||"not-created",String(e?.name||"Error").slice(0,40));
      return response({error:audit?"LAB 單人測試狀態未知，請勿立即重送；請由管理員查看發送紀錄":"LAB 單人測試發送失敗；未呼叫 LINE",requestId:audit?.requestId||null,status:audit?LAB_LINE_NOTIFICATION_STATES.UNKNOWN:"NOT_SENT"},500);
    }
  }
});
