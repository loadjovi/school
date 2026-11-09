// Generated into the isolated Functional UAT LAB only; never loaded by Production.
// OAuth state and completion tickets are single-use Azure Table entities.
import {app} from "@azure/functions";
import {randomBytes,randomInt,createHash} from "node:crypto";
import {TableClient,TableServiceClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
import {createLineAccountBindingRequest,bindLineAccount,getLineAccountBinding} from "../lib/lineAccountBinding.js";
import {lineBindingCodeHash} from "../lib/lineMessaging.mjs";

const ORIGIN="https://icy-ocean-0a2602100.6.azurestaticapps.net";
const CALLBACK=ORIGIN+"/api/line/login/callback";
const PAGE=ORIGIN+"/fee-collections.html";
const tableName="LabLineOAuthTransactions";
const hash=v=>createHash("sha256").update(String(v)).digest("hex");
const random=()=>randomBytes(32).toString("base64url");
const response=(body,status=200)=>({status,jsonBody:body,headers:{"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8"}});
const redirect=(result)=>({status:303,headers:{"Location":PAGE+"?line_lab_result="+encodeURIComponent(result),"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
const config=()=>({id:String(process.env.LINE_LOGIN_CHANNEL_ID||""),secret:String(process.env.LINE_LOGIN_CHANNEL_SECRET||""),uri:String(process.env.LINE_LOGIN_REDIRECT_URI||"")});
let table;
async function storage(){
  assertLabIsolation();
  if(!table){
    const conn=process.env.STORAGE_CONNECTION_STRING;
    if(!conn)throw Error("LAB storage unavailable");
    const service=TableServiceClient.fromConnectionString(conn);
    try{await service.createTable(tableName)}catch(e){if(e.statusCode!==409)throw e}
    table=TableClient.fromConnectionString(conn,tableName);
  }
  return table;
}
async function getRow(key){
  try{return await (await storage()).getEntity("LAB",hash(key))}
  catch(e){if(e.statusCode===404)return null;throw e}
}
async function consume(row){
  // ETag optimistic concurrency prevents replay and concurrent redemption.
  await (await storage()).updateEntity({partitionKey:"LAB",rowKey:row.rowKey,status:"USED"},"Merge",{etag:row.etag});
}
async function parent(request){
  const ctx=await getTenantContext(request);
  if(ctx.error)return {error:ctx.error};
  if(ctx.access.role!=="parent")return {error:response({error:"LAB 家長帳號限定"},403)};
  return ctx;
}
function enabled(){
  const c=config();
  return process.env.LAB_ENVIRONMENT==="functional-uat"&&c.id==="2012482463"&&!!c.secret&&c.uri===CALLBACK;
}
app.http("labLineLoginStart",{methods:["POST"],authLevel:"anonymous",route:"line/login/start",handler:async request=>{
  try{
    if(!enabled())return response({error:"LAB LINE Login 尚未啟用或設定不完整"},503);
    const ctx=await parent(request);if(ctx.error)return ctx.error;
    const state=random(),nonce=random(),verifier=random(),challenge=createHash("sha256").update(verifier).digest("base64url");
    await (await storage()).createEntity({partitionKey:"LAB",rowKey:hash(state),kind:"STATE",status:"ACTIVE",nonce,verifier,schoolId:ctx.schoolId,parentEmail:ctx.access.email,expiresAt:Date.now()+600000});
    const q=new URLSearchParams({response_type:"code",client_id:config().id,redirect_uri:CALLBACK,state,nonce,scope:"profile openid",bot_prompt:"aggressive",code_challenge:challenge,code_challenge_method:"S256"});
    return response({authorizationUrl:"https://access.line.me/oauth2/v2.1/authorize?"+q.toString()});
  }catch(e){console.error("LAB LINE start error",e?.message);return response({error:"無法啟動 LINE 連結"},500)}
}});
app.http("labLineLoginCallback",{methods:["GET"],authLevel:"anonymous",route:"line/login/callback",handler:async request=>{
  const url=new URL(request.url),state=url.searchParams.get("state")||"",code=url.searchParams.get("code")||"";
  try{
    if(!enabled()||!state||!code||url.searchParams.has("error"))return redirect("cancelled");
    const row=await getRow(state);
    if(!row||row.kind!=="STATE"||row.status!=="ACTIVE"||Number(row.expiresAt)<Date.now())return redirect("expired");
    await consume(row); // burn state before any external request
    const form=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:CALLBACK,client_id:config().id,client_secret:config().secret,code_verifier:row.verifier});
    const tokenRes=await fetch("https://api.line.me/oauth2/v2.1/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
    if(!tokenRes.ok)return redirect("token_error");
    const token=await tokenRes.json();
    if(!token.id_token||!token.access_token)return redirect("token_error");
    const verifyRes=await fetch("https://api.line.me/oauth2/v2.1/verify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({id_token:token.id_token,client_id:config().id,nonce:row.nonce})});
    if(!verifyRes.ok)return redirect("identity_error");
    const identity=await verifyRes.json();
    if(identity.aud!==config().id||!/^U[0-9a-f]{32}$/i.test(String(identity.sub||""))||identity.nonce!==row.nonce)return redirect("identity_error");
    let friend="unknown";
    try{
      const fr=await fetch("https://api.line.me/friendship/v1/status",{headers:{Authorization:"Bearer "+token.access_token}});
      if(fr.ok){const data=await fr.json();friend=data.friendFlag===true?"friend":"not_friend"}
    }catch{}
    const ticket=random();
    await (await storage()).createEntity({partitionKey:"LAB",rowKey:hash(ticket),kind:"TICKET",status:"ACTIVE",schoolId:row.schoolId,parentEmail:row.parentEmail,lineUserId:identity.sub,lineDisplayName:String(identity.name||"LINE 家長").slice(0,100),friendStatus:friend,expiresAt:Date.now()+180000});
    return redirect("ok."+ticket);
  }catch(e){console.error("LAB LINE callback failed",e?.message);return redirect("failed")}
}});
app.http("labLineLoginFinish",{methods:["POST"],authLevel:"anonymous",route:"line/login/finish",handler:async request=>{
  try{
    if(!enabled())return response({error:"LAB LINE Login 未啟用"},503);
    const ctx=await parent(request);if(ctx.error)return ctx.error;
    const body=await request.json(),ticket=String(body.ticket||"");
    if(!/^[A-Za-z0-9_-]{32,64}$/.test(ticket))return response({error:"無效的 LINE 授權結果"},400);
    const row=await getRow(ticket);
    if(!row||row.kind!=="TICKET"||row.status!=="ACTIVE"||Number(row.expiresAt)<Date.now()||row.schoolId!==ctx.schoolId||row.parentEmail!==ctx.access.email)return response({error:"LINE 授權已過期或不屬於目前家長"},403);
    await consume(row);
    // Legacy binding storage requires a six-digit code; generate it server-side only.
    const code=String(randomInt(0,1000000)).padStart(6,"0"),codeHash=lineBindingCodeHash(code,config().secret);
    if(!codeHash)throw Error("LAB internal binding hash unavailable");
    await createLineAccountBindingRequest({schoolId:ctx.schoolId,email:ctx.access.email,codeHash,expiresAt:new Date(Date.now()+60000).toISOString()});
    const result=await bindLineAccount({codeHash,lineUserId:row.lineUserId,lineDisplayName:row.lineDisplayName});
    if(!result.ok)return response({error:"綁定失敗："+result.reason},409);
    return response({bound:true,friendStatus:row.friendStatus,lineDisplayName:row.lineDisplayName});
  }catch(e){console.error("LAB LINE finish failed",e?.message);return response({error:"LAB LINE 綁定失敗（請由管理員檢查後端日誌）"},500)}
}});

/**
 * Functional UAT ONLY: single recipient, fixed-content LINE test.
 * Disabled until both LAB_LINE_TEST_USER_ID and LAB_LINE_MESSAGING_ACCESS_TOKEN
 * are set in the isolated Azure Static Web App settings.
 * Never accepts a target or message body from the browser.
 */
app.http("labLineSendTestNotification",{
  methods:["POST"],authLevel:"anonymous",route:"line/lab-send-test",
  handler:async request=>{
    try{
      if(!enabled())return response({error:"LAB LINE Login 未啟用"},503);
      assertLabIsolation();
      const ctx=await parent(request);if(ctx.error)return ctx.error;
      const email=String(ctx.access.email||"").trim().toLowerCase();
      const allowedEmail=String(process.env.LAB_LINE_TEST_PARENT_EMAIL||"").trim().toLowerCase();
      const allowedId=String(process.env.LAB_LINE_TEST_USER_ID||"").trim();
      const token=String(process.env.LAB_LINE_MESSAGING_ACCESS_TOKEN||"").trim();
      if(!allowedEmail||email!==allowedEmail)return response({error:"只有指定 LAB 測試家長可以發送"},403);
      if(!/^U[0-9a-f]{32}$/i.test(allowedId)||!token)return response({error:"LAB 單人發送尚未設定；未發送訊息"},503);
      const binding=await getLineAccountBinding(ctx.schoolId,email,{includeTarget:true});
      if(!binding?.bound||binding.lineUserId!==allowedId)return response({error:"LINE 綁定與指定測試帳號不符；未發送訊息"},403);
      // Per-parent throttling stored in LAB-only table; fail closed on errors.
      const key="SEND_"+hash(ctx.schoolId+":"+email);
      const now=Date.now(),db=await storage();
      let old=null;
      try{old=await db.getEntity("LAB",key)}catch(e){if(e.statusCode!==404)throw e}
      if(old&&Number(old.sentAt||0)>now-60000)return response({error:"請至少間隔 60 秒再測試"},429);
      // Reserve a slot before calling LINE to prevent repeated clicks.
      if(old){
        await db.updateEntity({partitionKey:"LAB",rowKey:key,sentAt:now},"Merge",{etag:old.etag});
      }else{
        try{await db.createEntity({partitionKey:"LAB",rowKey:key,sentAt:now})}
        catch(e){if(e.statusCode===409)return response({error:"請稍後重試"},429);throw e}
      }
      const message=["🎻【LAB 測試通知】","聖心弦樂成長平台 LINE 單人通知驗證。","此訊息僅發送至指定測試家長，不代表正式活動通知。"].join(String.fromCharCode(10));
      const sent=await fetch("https://api.line.me/v2/bot/message/push",{
        method:"POST",
        headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify({to:allowedId,messages:[{type:"text",text:message}]})
      });
      if(!sent.ok){
        console.error("LAB LINE single push failed",sent.status);
        return response({error:"LINE 發送失敗，HTTP "+sent.status+"；請檢查 LAB 設定與官方帳號權限"},502);
      }
      return response({accepted:true,message:"LINE 已接受單人測試訊息；請在手機確認實際收到"});
    }catch(e){
      console.error("LAB LINE test send error",e?.message);
      return response({error:"LAB 單人測試發送失敗；未確認訊息送達"},500);
    }
  }
});
