// Generated into the isolated Functional UAT LAB only; never loaded by Production.
// OAuth state and completion tickets are single-use Azure Table entities.
import {app} from "@azure/functions";
import {randomBytes,createHash} from "node:crypto";
import {TableClient,TableServiceClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
import {createLineAccountBindingRequest,bindLineAccount} from "../lib/lineAccountBinding.js";
import {lineBindingCodeHash} from "../lib/lineMessaging.mjs";
import {assertLabIsolation} from "../lib/labIsolation.mjs";

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
    const code=random(),codeHash=lineBindingCodeHash(code,config().secret);
    await createLineAccountBindingRequest({schoolId:ctx.schoolId,email:ctx.access.email,codeHash,expiresAt:new Date(Date.now()+60000).toISOString()});
    const result=await bindLineAccount({codeHash,lineUserId:row.lineUserId,lineDisplayName:row.lineDisplayName});
    if(!result.ok)return response({error:"綁定失敗："+result.reason},409);
    return response({bound:true,friendStatus:row.friendStatus,lineDisplayName:row.lineDisplayName});
  }catch(e){console.error("LAB LINE finish failed",e?.message);return response({error:"LAB LINE 綁定失敗"},500)}
}});
