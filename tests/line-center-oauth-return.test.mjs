import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const strip=value=>value.replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const origin="https://school-a.example.test",google={sub:"admin-sub",email:"admin@example.test"};
function identityStore(){
 const rows=new Map();
 const db={createTable:async()=>{},createEntity:async row=>rows.set(row.partitionKey+"|"+row.rowKey,{...row,etag:"version-1"}),getEntity:async(p,k)=>{const row=rows.get(p+"|"+k);if(!row)throw Object.assign(Error(),{statusCode:404});return {...row}},deleteEntity:async(p,k,options={})=>{const row=rows.get(p+"|"+k);if(!row)throw Object.assign(Error(),{statusCode:404});if(options.etag&&options.etag!==row.etag)throw Object.assign(Error(),{statusCode:412});rows.delete(p+"|"+k)}};
 const api=runInNewContext(strip(read("api/src/lib/tenantLineAccounts.js"))+";({createTenantLineOAuth,useTenantLineOAuth,lineCookie})",{createHash,randomBytes,randomUUID,process:{env:{STORAGE_CONNECTION_STRING:"test"}},TableClient:{fromConnectionString:()=>db},tenantSchoolPartition:value=>value});
 return {...api,rows};
}
function harness({role="admin",contextSchool="school-a",identity=google,oauthFailure=false,oauthError=null,conflict=false}={}){
 const handlers={},transactions=[],effects=[],warnings=[],store=identityStore(),channel={schoolId:"school-a",appOrigin:origin,loginConfigured:true,loginId:"1234567890",loginSecret:"secret",botUserId:"U"+"a".repeat(32),oauthVersion:"channel-version"};
 class LineAccountConflict extends Error{}
 const globals={app:{http:(name,options)=>handlers[name]=options.handler},createHash,URL,URLSearchParams,AbortSignal,console:{warn:(...args)=>warnings.push(args)},json:(data,status=200)=>({data,status}),tenantIdValue:value=>value,
  resolveTenantLineChannel:async()=>channel,verifyGoogle:async()=>identity,getTenantContext:async()=>({schoolId:contextSchool,access:{role}}),
  createTenantLineOAuth:async(...args)=>{const created=await store.createTenantLineOAuth(...args);transactions.push({args,created});return created},useTenantLineOAuth:store.useTenantLineOAuth,
  clearOAuthCookie:()=>({name:"__Host-school-line-oauth",value:""}),clearTenantLineLinkConfirmation:()=>({name:"__Host-school-line-link",value:""}),
  getOrCreateTenantLineAccount:async()=>{effects.push("account");if(conflict)throw new LineAccountConflict();return {botUserId:channel.botUserId,lineUserId:"U"+"b".repeat(32),displayName:"管理員"}},
  createTenantLineLinkConfirmation:async()=>{effects.push("pending");return {cookie:{name:"__Host-school-line-link",value:"opaque-confirmation"}}},LineAccountConflict,
  createTenantLineSession:async()=>"session",lineSessionCookie:value=>({name:"__Host-school-line-session",value}),lineCookie:store.lineCookie,refreshTenantLineMenu:async()=>{},recordTenantLineFriendship:async()=>{},
  fetch:async url=>{
   const token=String(url).endsWith("token"),error=oauthError&&String(url).endsWith(oauthError.endpoint||"token")?oauthError:null;
   return {ok:!oauthFailure&&!error,status:error?.status||(oauthFailure?502:200),json:async()=>error?{error:error.code,error_description:error.description}:token?{id_token:"id-token"}:{iss:"https://access.line.me",aud:channel.loginId,nonce:transactions.at(-1)?.created.nonce,sub:"U"+"b".repeat(32),name:"管理員"}};
  }};
 runInNewContext(strip(read("api/src/functions/tenantLineLogin.js")),globals);
 const start=(input={mode:"link",returnTo:"notification-center"},schoolId="school-a",headers={})=>handlers.tenantLineLoginStart({params:{schoolId},headers:new Headers({origin,...headers}),json:async()=>input});
 const callback=async(result,{code="valid-code",extra={},schoolId="school-a",cookie=true}={})=>{
  const state=new URL(result.data.url).searchParams.get("state"),query=new URLSearchParams({state,...extra});if(code!==null)query.set("code",code);
  const item=result.cookies.find(value=>value.name==="__Host-school-line-oauth");
  return handlers.tenantLineLoginCallback({params:{schoolId},headers:new Headers(cookie?{cookie:item.name+"="+item.value}:{}),query});
 };
 return {start,callback,handlers,transactions,store,channel,effects,warnings};
}

test("same-school admin link stores a fixed center destination and returns there for explicit account confirmation",async()=>{
 const h=harness(),started=await h.start();assert.equal(started.status,200);assert.equal(h.transactions.length,1);
 assert.equal(h.transactions[0].args[3].returnTo,"notification-center");
 assert.equal([...h.store.rows.values()][0].returnTo,"notification-center");
 const result=await h.callback(started),url=new URL(result.headers.Location);
 assert.equal(url.origin,origin);assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("adminLineAccount"),"school-a");assert.equal(url.searchParams.has("tab"),false);assert.equal(url.searchParams.get("line_link"),"confirm");
 assert.ok(result.cookies.some(cookie=>cookie.value==="opaque-confirmation"));assert.equal(h.store.rows.size,0);
 assert.equal(result.headers["Cache-Control"],"no-store");assert.equal(result.headers["Referrer-Policy"],"no-referrer");
});
test("same-school teaching roles return to their own account confirmation without starting a LINE-only session",async()=>{
 for(const role of ["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]){
  const h=harness({role}),started=await h.start({mode:"link",returnTo:"teacher-account"});
  assert.equal(started.status,200);assert.equal(h.transactions[0].args[3].returnTo,"teacher-account");
  assert.equal([...h.store.rows.values()][0].returnTo,"teacher-account");
  const result=await h.callback(started),url=new URL(result.headers.Location);
  assert.equal(url.origin,origin);assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("teacherLineAccount"),"school-a");
  assert.equal(url.searchParams.get("line_link"),"confirm");assert.equal(url.searchParams.has("adminLineAccount"),false);assert.equal(url.searchParams.has("line_session"),false);
  assert.deepEqual(h.effects,["account","pending"]);assert.equal(h.store.rows.size,0);
  assert.ok(result.cookies.some(cookie=>cookie.value==="opaque-confirmation"));
  assert.equal(result.cookies.some(cookie=>["__Host-school-line-session","orchestra_google_id_token"].includes(cookie.name)),false);
 }
});
test("teacher returns require the current same-school teaching identity and authenticated link mode",async()=>{
 for(const role of ["parent","unassigned","admin","contextDenied"]){
  const h=harness({role});assert.equal((await h.start({mode:"link",returnTo:"teacher-account"})).status,403);assert.equal(h.transactions.length,0);
 }
 for(const options of [{identity:null},{contextSchool:"school-b"}]){
  const h=harness({...options,role:"teacher"});assert.equal((await h.start({mode:"link",returnTo:"teacher-account"})).status,options.identity===null?401:403);assert.equal(h.transactions.length,0);
 }
 const login=harness({role:"teacher"});assert.equal((await login.start({mode:"login",returnTo:"teacher-account"})).status,400);assert.equal(login.transactions.length,0);
});
test("teacher authorization carries only the exact verified Gmail session across a new browser tab",async()=>{
 const credential="verified-private-google-credential",authSessionId=createHash("sha256").update(credential).digest("hex");
 const h=harness({role:"teacher",identity:{...google,authSessionId}}),started=await h.start({mode:"link",returnTo:"teacher-account"},"school-a",{"x-google-id-token":credential});
 assert.equal(started.status,200);
 const session=started.cookies.find(cookie=>cookie.name==="orchestra_google_id_token");
 assert.deepEqual(JSON.parse(JSON.stringify(session)),{name:"orchestra_google_id_token",value:credential,maxAge:3600,sameSite:"Lax",path:"/",secure:true,httpOnly:true});
 assert.doesNotMatch(JSON.stringify({url:started.data.url,transactions:[...h.store.rows.values()],warnings:h.warnings}),new RegExp(credential));
 for(const candidate of ["different-header-credential","cookie-session","line-session",""]){
  const other=harness({role:"teacher",identity:{...google,authSessionId}}),result=await other.start({mode:"link",returnTo:"teacher-account"},"school-a",{"x-google-id-token":candidate});
  assert.equal(result.cookies.some(cookie=>cookie.name==="orchestra_google_id_token"),false);
 }
 const noHash=harness({role:"teacher"}),unproven=await noHash.start({mode:"link",returnTo:"teacher-account"},"school-a",{"x-google-id-token":credential});
 assert.equal(unproven.cookies.some(cookie=>cookie.name==="orchestra_google_id_token"),false);
 for(const input of [{mode:"login"},{mode:"link"}]){
  const legacy=harness({role:"teacher",identity:{...google,authSessionId}}),result=await legacy.start(input,"school-a",{"x-google-id-token":credential});
  assert.equal(result.cookies.some(cookie=>cookie.name==="orchestra_google_id_token"),false);
 }
});
test("verified teacher transactions keep their account destination on cancellation or provider failure",async()=>{
 for(const options of [{oauthFailure:true},{conflict:true},{}]){
  const h=harness({...options,role:"teacher"}),started=await h.start({mode:"link",returnTo:"teacher-account"});
  const result=await h.callback(started,options.oauthFailure||options.conflict?{}:{code:null}),url=new URL(result.headers.Location);
  assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("teacherLineAccount"),"school-a");assert.equal(url.searchParams.has("adminLineAccount"),false);
  assert.equal(url.searchParams.get("line_error"),options.conflict?"conflict":options.oauthFailure?"verification":"authorization");
  assert.equal(result.cookies.some(cookie=>cookie.name==="__Host-school-line-link"&&cookie.value),false);
 }
});
test("center return cannot be requested by parent or teaching roles, anonymous links or a mismatched school",async()=>{
 for(const role of ["parent","unassigned","teacher","privateTeacher"]){const h=harness({role});assert.equal((await h.start()).status,403);assert.equal(h.transactions.length,0)}
 const anonymous=harness({identity:null});assert.equal((await anonymous.start()).status,401);assert.equal(anonymous.transactions.length,0);
 const wrongSchool=harness({contextSchool:"school-b"});assert.equal((await wrongSchool.start()).status,403);assert.equal(wrongSchool.transactions.length,0);
});
test("login mode and arbitrary redirect targets are refused before an OAuth transaction is created",async()=>{
 for(const returnTo of ["https://evil.example","//evil.example","/line-announcement.html","notification-center?school=other","account","",null,{},["notification-center"]]){
  const h=harness();assert.equal((await h.start({mode:"link",returnTo})).status,400);assert.equal(h.transactions.length,0);
 }
 const login=harness();assert.equal((await login.start({mode:"login",returnTo:"notification-center"})).status,400);assert.equal(login.transactions.length,0);
});
test("a valid center transaction returns errors and cancelled authorization to the same fixed account tab",async()=>{
 for(const options of [{oauthFailure:true},{conflict:true},{}]){
  const h=harness(options),started=await h.start(),result=await h.callback(started,options.oauthFailure||options.conflict?{}:{code:null});
  const url=new URL(result.headers.Location);assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("adminLineAccount"),"school-a");assert.equal(url.searchParams.has("tab"),false);assert.equal(url.searchParams.get("line_error"),options.conflict?"conflict":options.oauthFailure?"verification":"authorization");
 }
});

test("OAuth failures distinguish channel configuration from expired authorization without exposing provider secrets",async()=>{
 const sensitive="private-provider-response-marker";
 for(const [error,expected] of [
  [{status:400,code:"invalid_client",description:sensitive},"configuration"],
  [{status:400,code:"invalid_request",description:"Invalid client_secret "+sensitive},"configuration"],
  [{status:400,code:"invalid_request",description:"Invalid redirect_uri "+sensitive},"configuration"],
  [{status:401,code:"unauthorized",description:sensitive},"configuration"],
  [{status:400,code:"invalid_grant",description:sensitive},"authorization"],
  [{status:503,code:"temporary_error",description:sensitive},"verification"],
  [{endpoint:"verify",status:401,code:"invalid_client",description:sensitive},"verification"]
 ]){
  const h=harness({oauthError:error}),started=await h.start(),result=await h.callback(started),url=new URL(result.headers.Location);
  assert.equal(url.searchParams.get("line_error"),expected);assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("adminLineAccount"),"school-a");
  assert.deepEqual(h.effects,[]);assert.equal(result.cookies.some(cookie=>cookie.name==="__Host-school-line-link"),false);
  assert.doesNotMatch(JSON.stringify({location:result.headers.Location,warnings:h.warnings}),new RegExp(sensitive));
 }
});
test("callback query destinations cannot replace a legacy return or bypass the state cookie",async()=>{
 const h=harness({role:"privateTeacher"}),started=await h.start({mode:"link"});
 const returned=await h.callback(started,{extra:{returnTo:"notification-center",redirect_uri:"https://evil.example",adminLineAccount:"school-b"}}),url=new URL(returned.headers.Location);
 assert.equal(url.pathname,"/line-account.html");assert.equal(url.searchParams.get("line_link"),"confirm");assert.equal(url.searchParams.has("tab"),false);assert.equal(url.searchParams.has("adminLineAccount"),false);
 const invalid=harness(),fresh=await invalid.start(),denied=await invalid.callback(fresh,{cookie:false,extra:{returnTo:"notification-center"}});
 assert.equal(new URL(denied.headers.Location).pathname,"/");assert.equal(new URL(denied.headers.Location).searchParams.has("tab"),false);assert.equal(new URL(denied.headers.Location).searchParams.has("adminLineAccount"),false);
});
test("teacher callback markers come only from a consumed authenticated transaction",async()=>{
 const teacher=harness({role:"teacher"}),started=await teacher.start({mode:"link",returnTo:"teacher-account"});
 const response=await teacher.callback(started,{extra:{teacherLineAccount:"school-b",returnTo:"https://evil.example",adminLineAccount:"school-b"}}),url=new URL(response.headers.Location);
 assert.equal(url.origin,origin);assert.equal(url.searchParams.get("teacherLineAccount"),"school-a");assert.equal(url.searchParams.has("adminLineAccount"),false);
 const replay=await teacher.callback(started,{extra:{teacherLineAccount:"school-a",returnTo:"teacher-account"}}),replayUrl=new URL(replay.headers.Location);
 assert.equal(replayUrl.searchParams.get("line_error"),"authorization");assert.equal(replayUrl.searchParams.has("teacherLineAccount"),false);assert.equal(replayUrl.searchParams.has("line_link"),false);
 const missingCookie=harness({role:"teacher"}),fresh=await missingCookie.start({mode:"link",returnTo:"teacher-account"});
 const denied=await missingCookie.callback(fresh,{cookie:false,extra:{teacherLineAccount:"school-a",returnTo:"teacher-account"}}),deniedUrl=new URL(denied.headers.Location);
 assert.equal(deniedUrl.searchParams.get("line_error"),"authorization");assert.equal(deniedUrl.searchParams.has("teacherLineAccount"),false);assert.deepEqual(missingCookie.effects,[]);
});
test("center transactions remain bound to school, channel version and one-time state consumption",async()=>{
 const store=identityStore(),config={oauthVersion:"v1"},created=await store.createTenantLineOAuth("school-a",config,google,{returnTo:"notification-center"});
 const request={headers:new Headers({cookie:created.cookie.name+"="+created.cookie.value})};
 assert.equal(await store.useTenantLineOAuth(request,"school-b",created.state,config),null);
 assert.equal(await store.useTenantLineOAuth(request,"school-a",created.state,{oauthVersion:"v2"}),null);
 const first=await store.useTenantLineOAuth(request,"school-a",created.state,config);assert.equal(first.returnTo,"notification-center");assert.equal(first.googleSub,google.sub);
 assert.equal(await store.useTenantLineOAuth(request,"school-a",created.state,config),null);
 await assert.rejects(store.createTenantLineOAuth("school-a",config,google,{returnTo:"https://evil.example"}),/Invalid LINE account return/);
 await assert.rejects(store.createTenantLineOAuth("school-a",config,undefined,{returnTo:"notification-center"}),/Invalid LINE account return/);
});
test("stored teacher destinations retain tenant, configuration, expiry and one-time state checks",async()=>{
 const store=identityStore(),config={oauthVersion:"v1"},created=await store.createTenantLineOAuth("school-a",config,google,{returnTo:"teacher-account"});
 const request={headers:new Headers({cookie:created.cookie.name+"="+created.cookie.value})};
 assert.equal(await store.useTenantLineOAuth(request,"school-b",created.state,config),null);
 assert.equal(await store.useTenantLineOAuth(request,"school-a",created.state,{oauthVersion:"v2"}),null);
 const first=await store.useTenantLineOAuth(request,"school-a",created.state,config);assert.equal(first.returnTo,"teacher-account");assert.equal(first.googleSub,google.sub);
 assert.equal(await store.useTenantLineOAuth(request,"school-a",created.state,config),null);
 const expired=await store.createTenantLineOAuth("school-a",config,google,{returnTo:"teacher-account"});
 store.rows.values().next().value.expires=Date.now()-1;
 assert.equal(await store.useTenantLineOAuth({headers:new Headers({cookie:expired.cookie.name+"="+expired.cookie.value})},"school-a",expired.state,config),null);
 await assert.rejects(store.createTenantLineOAuth("school-a",config,undefined,{returnTo:"teacher-account"}),/Invalid LINE account return/);
});
test("ordinary LINE login and legacy linking keep their original destinations",async()=>{
 const login=harness(),started=await login.start({mode:"login"}),result=await login.callback(started),url=new URL(result.headers.Location);
 assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("line_session"),"school-a");assert.equal(url.searchParams.has("tab"),false);
 const teacher=harness({role:"privateTeacher"}),linked=await teacher.start({mode:"link"});assert.equal(linked.status,200);assert.equal([...teacher.store.rows.values()][0].returnTo,undefined);
 assert.equal(new URL((await teacher.callback(linked)).headers.Location).pathname,"/line-account.html");
});

test("an approved Gmail parent returns directly to LINE account confirmation without a new student enrollment",async()=>{
 const parent={sub:"parent-sub",email:"parent@example.test"},h=harness({role:"parent",identity:parent});
 const started=await h.start({mode:"link",returnTo:"parent-account"});assert.equal(started.status,200);
 const transaction=[...h.store.rows.values()][0];assert.equal(transaction.googleSub,parent.sub);assert.equal(transaction.googleEmail,parent.email);assert.equal(transaction.returnTo,"parent-account");
 const result=await h.callback(started),url=new URL(result.headers.Location);
 assert.equal(url.origin,origin);assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("parentLineAccount"),"school-a");assert.equal(url.searchParams.get("line_link"),"confirm");
 for(const name of ["teacherLineAccount","adminLineAccount","line_session","studentId","studentName"])assert.equal(url.searchParams.has(name),false);
 assert.deepEqual(h.effects,["account","pending"]);assert.equal(h.store.rows.size,0);
 assert.ok(result.cookies.some(cookie=>cookie.value==="opaque-confirmation"));
 assert.equal(result.cookies.some(cookie=>["__Host-school-line-session","orchestra_google_id_token"].includes(cookie.name)),false);
});
test("the fixed parent return requires a verified same-school approved Gmail parent",async()=>{
 for(const role of ["unassigned","admin","teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher","contextDenied"]){
  const h=harness({role});assert.equal((await h.start({mode:"link",returnTo:"parent-account"})).status,403);assert.equal(h.transactions.length,0);
 }
 for(const options of [{identity:null},{contextSchool:"school-b"}]){
  const h=harness({...options,role:"parent"});assert.equal((await h.start({mode:"link",returnTo:"parent-account"})).status,options.identity===null?401:403);assert.equal(h.transactions.length,0);
 }
 const login=harness({role:"parent"});assert.equal((await login.start({mode:"login",returnTo:"parent-account"})).status,400);assert.equal(login.transactions.length,0);
 const unassigned=harness({role:"unassigned"});assert.equal((await unassigned.start({mode:"link"})).status,200);assert.equal([...unassigned.store.rows.values()][0].returnTo,undefined);
});
test("parent authorization bridges only the exact verified Gmail credential across browser tabs",async()=>{
 const credential="parent-private-google-credential",authSessionId=createHash("sha256").update(credential).digest("hex");
 const h=harness({role:"parent",identity:{sub:"parent-sub",email:"parent@example.test",authSessionId}}),started=await h.start({mode:"link",returnTo:"parent-account"},"school-a",{"x-google-id-token":credential});
 assert.equal(started.status,200);
 const session=started.cookies.find(cookie=>cookie.name==="orchestra_google_id_token");
 assert.deepEqual(JSON.parse(JSON.stringify(session)),{name:"orchestra_google_id_token",value:credential,maxAge:3600,sameSite:"Lax",path:"/",secure:true,httpOnly:true});
 assert.doesNotMatch(JSON.stringify({url:started.data.url,transactions:[...h.store.rows.values()],warnings:h.warnings}),new RegExp(credential));
 for(const candidate of ["different-header-credential","cookie-session","line-session",""]){
  const other=harness({role:"parent",identity:{...google,authSessionId}}),result=await other.start({mode:"link",returnTo:"parent-account"},"school-a",{"x-google-id-token":candidate});
  assert.equal(result.cookies.some(cookie=>cookie.name==="orchestra_google_id_token"),false);
 }
 const noHash=harness({role:"parent"}),unproven=await noHash.start({mode:"link",returnTo:"parent-account"},"school-a",{"x-google-id-token":credential});assert.equal(unproven.cookies.some(cookie=>cookie.name==="orchestra_google_id_token"),false);
 for(const mode of ["login","link"]){
  const legacy=harness({role:"parent",identity:{...google,authSessionId}}),result=await legacy.start({mode},"school-a",{"x-google-id-token":credential});assert.equal(result.cookies.some(cookie=>cookie.name==="orchestra_google_id_token"),false);
 }
});
test("parent callbacks preserve the account screen for cancellation, conflict and provider errors",async()=>{
 for(const [options,callback,reason] of [
  [{},{code:null},"authorization"],
  [{oauthFailure:true},{},"verification"],
  [{conflict:true},{},"conflict"],
  [{oauthError:{status:400,code:"invalid_client"}},{},"configuration"]
 ]){
  const h=harness({...options,role:"parent"}),started=await h.start({mode:"link",returnTo:"parent-account"});
  const result=await h.callback(started,callback),url=new URL(result.headers.Location);
  assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("parentLineAccount"),"school-a");assert.equal(url.searchParams.get("line_error"),reason);assert.equal(url.searchParams.has("teacherLineAccount"),false);
  assert.equal(result.cookies.some(cookie=>cookie.name==="__Host-school-line-link"&&cookie.value),false);
 }
});
test("parent callback markers cannot be forged or replayed without the consumed same-school OAuth state",async()=>{
 const h=harness({role:"parent"}),started=await h.start({mode:"link",returnTo:"parent-account"});
 const returned=await h.callback(started,{extra:{parentLineAccount:"school-b",returnTo:"https://evil.example",teacherLineAccount:"school-b",adminLineAccount:"school-b"}}),url=new URL(returned.headers.Location);
 assert.equal(url.origin,origin);assert.equal(url.searchParams.get("parentLineAccount"),"school-a");assert.equal(url.searchParams.has("teacherLineAccount"),false);assert.equal(url.searchParams.has("adminLineAccount"),false);
 const replay=await h.callback(started,{extra:{parentLineAccount:"school-a",returnTo:"parent-account"}}),replayUrl=new URL(replay.headers.Location);
 assert.equal(replayUrl.searchParams.get("line_error"),"authorization");assert.equal(replayUrl.searchParams.has("parentLineAccount"),false);assert.equal(replayUrl.searchParams.has("line_link"),false);
 const missing=harness({role:"parent"}),fresh=await missing.start({mode:"link",returnTo:"parent-account"});
 const denied=await missing.callback(fresh,{cookie:false,extra:{parentLineAccount:"school-a",returnTo:"parent-account"}}),deniedUrl=new URL(denied.headers.Location);
 assert.equal(deniedUrl.searchParams.get("line_error"),"authorization");assert.equal(deniedUrl.searchParams.has("parentLineAccount"),false);assert.deepEqual(missing.effects,[]);
 const legacy=harness({role:"parent"}),old=await legacy.start({mode:"link"}),unchanged=new URL((await legacy.callback(old,{extra:{parentLineAccount:"school-a",returnTo:"parent-account"}})).headers.Location);
 assert.equal(unchanged.pathname,"/line-account.html");assert.equal(unchanged.searchParams.has("parentLineAccount"),false);
});
test("stored parent destinations preserve school, configuration, expiration and one-time state validation",async()=>{
 const store=identityStore(),config={oauthVersion:"v1"},created=await store.createTenantLineOAuth("school-a",config,google,{returnTo:"parent-account"});
 const request={headers:new Headers({cookie:created.cookie.name+"="+created.cookie.value})};
 assert.equal(await store.useTenantLineOAuth(request,"school-b",created.state,config),null);assert.equal(await store.useTenantLineOAuth(request,"school-a",created.state,{oauthVersion:"v2"}),null);
 const first=await store.useTenantLineOAuth(request,"school-a",created.state,config);assert.equal(first.returnTo,"parent-account");assert.equal(first.googleSub,google.sub);
 assert.equal(await store.useTenantLineOAuth(request,"school-a",created.state,config),null);
 const expired=await store.createTenantLineOAuth("school-a",config,google,{returnTo:"parent-account"});store.rows.values().next().value.expires=Date.now()-1;
 assert.equal(await store.useTenantLineOAuth({headers:new Headers({cookie:expired.cookie.name+"="+expired.cookie.value})},"school-a",expired.state,config),null);
 await assert.rejects(store.createTenantLineOAuth("school-a",config,undefined,{returnTo:"parent-account"}),/Invalid LINE account return/);
});


test("main bootstrap preserves school account callback errors for the capability-gated workspace",async()=>{
 const app=read("app/app-v3.js"),bootSource=app.slice(app.indexOf("async function boot(){"),app.indexOf("const schoolViewScript="));
 for(const error of ["configuration","authorization","verification","conflict"]){
  const histories=[],logins=[],loads=[];
  const boot=runInNewContext(bootSource+";boot",{teacherLineAccountEntry:()=>"",parentLineAccountEntry:()=>"",URLSearchParams,location:{pathname:"/",search:"?adminLineAccount=school-a&line_error="+error},state:{token:"existing-session"},history:{replaceState:(...args)=>histories.push(args)},window:{},paidActivityEntry:()=>null,loadProfile:async profile=>loads.push(profile),renderLogin:message=>logins.push(message)});
  await boot();assert.equal(histories.length,0);assert.equal(logins.length,0);assert.equal(loads.length,1);
 }
 for(const search of ["?line_error=configuration","?adminLineAccount=https://evil.example&line_error=configuration"]){
  const histories=[],logins=[];
  const boot=runInNewContext(bootSource+";boot",{teacherLineAccountEntry:()=>"",parentLineAccountEntry:()=>"",URLSearchParams,location:{pathname:"/",search},state:{token:""},history:{replaceState:(...args)=>histories.push(args)},renderLogin:message=>logins.push(message)});
  await boot();assert.equal(histories.length,1);assert.equal(logins.length,1);assert.doesNotMatch(histories[0][2],/line_error/);
 }
});
