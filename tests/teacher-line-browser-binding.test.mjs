import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../api/src/functions/tenantLineLogin.js",import.meta.url),"utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm,"");
const origin="https://school.example.test",schoolId="school-a";
const teacher={sub:"verified-google-sub",email:"teacher@example.test"};
const botUserId="U"+"a".repeat(32),lineUserId="U"+"b".repeat(32);

function fixture({role="teacher",provider="google",identity=teacher,contextSchool=schoolId,contextError=null}={}){
  const handlers={},transactions=[],effects=[];
  const channel={schoolId,appOrigin:origin,loginConfigured:true,loginId:"1234567890",botUserId,oauthVersion:"v1"};
  const account={partitionKey:schoolId,schoolId,botUserId,lineUserId,parentEmail:teacher.email,googleSub:teacher.sub,googleEmail:teacher.email};
  runInNewContext(source,{
    app:{http:(name,options)=>handlers[name]=options.handler},createHash,URL,URLSearchParams,
    tenantIdValue:value=>value,json:(data,status=200)=>({data,status}),
    resolveTenantLineChannel:async()=>channel,verifyGoogle:async()=>identity,
    getTenantContext:async()=>contextError?{error:contextError}:{schoolId:contextSchool,access:{role,authProvider:provider}},
    getTenantGoogleLink:async()=>account,getTenantLineAccount:async()=>account,
    tenantLineSession:async()=>({schoolId,account}),
    createTenantLineOAuth:async(...args)=>{
      transactions.push(args);return {state:"opaque-state",nonce:"opaque-nonce",verifier:"private-verifier",cookie:{name:"__Host-school-line-oauth",value:"opaque-state"}};
    },
    clearTenantLineLinkConfirmation:()=>({name:"__Host-school-line-link",value:""}),
    lineCookie:(name,value,maxAge)=>({name,value,maxAge,httpOnly:true,secure:true,sameSite:"Lax",path:"/"}),
    getOrCreateTenantLineAccount:async()=>{effects.push("account-write");throw Error("unexpected account write")},
    linkTenantGoogle:async()=>{effects.push("link-write");throw Error("unexpected link write")},
    fetch:async()=>{effects.push("external-call");throw Error("unexpected external call")}
  });
  return {transactions,effects,start:(input,headers={})=>handlers.tenantLineLoginStart({params:{schoolId},headers:new Headers({origin,...headers}),json:async()=>input})};
}

test("every authorized Gmail teaching role keeps link and friendship authorization in its browser",async()=>{
  for(const role of ["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]){
    for(const mode of ["link","friendship"]){
      const h=fixture({role}),result=await h.start({mode,returnTo:"teacher-account"});
      assert.equal(result.status,200);const url=new URL(result.data.url);
      assert.equal(url.origin,"https://access.line.me");assert.equal(url.pathname,"/oauth2/v2.1/authorize");
      assert.equal(url.searchParams.get("disable_auto_login"),"true");
      assert.equal(url.searchParams.get("state"),"opaque-state");assert.equal(url.searchParams.get("nonce"),"opaque-nonce");
      assert.equal(url.searchParams.get("code_challenge_method"),"S256");
      assert.equal(url.searchParams.get("code_challenge"),createHash("sha256").update("private-verifier").digest("base64url"));
      assert.equal(url.searchParams.get("bot_prompt"),"aggressive");
      assert.equal(url.searchParams.get("redirect_uri"),origin+"/api/line/tenant-login/school-a/callback");
      assert.ok(result.cookies.some(cookie=>cookie.name==="__Host-school-line-oauth"&&cookie.value==="opaque-state"));
      assert.equal(h.transactions[0][2].sub,teacher.sub);assert.equal(h.transactions[0][3].returnTo,"teacher-account");
      if(mode==="friendship")assert.equal(h.transactions[0][3].friendshipInitiator,"google");
      assert.deepEqual(h.effects,[]);
    }
  }
});

test("ordinary LINE login and unrelated Google return scopes retain automatic login",async()=>{
  for(const [role,input] of [
    ["teacher",{mode:"login"}], ["teacher",{mode:"link"}], ["teacher",{mode:"friendship"}],
    ["admin",{mode:"link"}], ["admin",{mode:"friendship"}]
  ]){
    const h=fixture({role}),result=await h.start(input);assert.equal(result.status,200);
    assert.equal(new URL(result.data.url).searchParams.has("disable_auto_login"),false);assert.deepEqual(h.effects,[]);
  }
});

test("LINE-origin teacher friendship checks retain automatic login and cannot borrow a Google return",async()=>{
  for(const headers of [{},{"x-google-id-token":"line-session"}]){
    const h=fixture({provider:"line"}),result=await h.start({mode:"friendship",returnTo:"teacher-account"},headers);
    assert.equal(result.status,200);assert.equal(new URL(result.data.url).searchParams.has("disable_auto_login"),false);
    assert.equal(h.transactions[0][2],undefined);assert.equal(h.transactions[0][3].friendshipInitiator,"line");
    assert.equal(h.transactions[0][3].returnTo,undefined);assert.deepEqual(h.effects,[]);
  }
});

test("caller parameters cannot disable or enable browser binding outside its authenticated teacher scope",async()=>{
  for(const mode of ["link","friendship"]){
    const h=fixture(),result=await h.start({mode,returnTo:"teacher-account",disable_auto_login:false,googleSub:"forged"});
    assert.equal(new URL(result.data.url).searchParams.get("disable_auto_login"),"true");
    assert.equal(h.transactions[0][2].sub,teacher.sub);
  }
  const login=fixture(),result=await login.start({mode:"login",disable_auto_login:true,returnTeacher:true});
  assert.equal(result.status,200);assert.equal(new URL(result.data.url).searchParams.has("disable_auto_login"),false);
});

test("anonymous, wrong-role and other-school callers cannot obtain teacher browser binding",async()=>{
  for(const mode of ["link","friendship"]){
    for(const [options,expected] of [[{identity:null},401],[{role:"parent"},403],[{role:"admin"},403],[{contextSchool:"school-b"},403],[{contextError:{status:401,data:{error:"Unauthorized"}}},401]]){
      const h=fixture(options),result=await h.start({mode,returnTo:"teacher-account"});
      assert.equal(result.status,expected);assert.equal(h.transactions.length,0);assert.deepEqual(h.effects,[]);
    }
  }
  const login=fixture(),denied=await login.start({mode:"login",returnTo:"teacher-account"});
  assert.equal(denied.status,400);assert.equal(login.transactions.length,0);
});

test("approved Gmail parents keep browser authorization, isolated from non-parent and LINE-origin contexts",async()=>{
 for(const mode of ['link','friendship']){
  const h=fixture({role:'parent'}),res=await h.start({mode,returnTo:'parent-account'});
  assert.equal(res.status,200);assert.equal(new URL(res.data.url).searchParams.get('disable_auto_login'),'true');assert.deepEqual(h.effects,[]);
  const wrong=fixture({role:'admin'});assert.equal((await wrong.start({mode,returnTo:'parent-account'})).status,403);
  const other=fixture({role:'parent',contextSchool:'school-b'});assert.equal((await other.start({mode,returnTo:'parent-account'})).status,403);
 }
 const line=fixture({role:'parent',provider:'line'}),res=await line.start({mode:'friendship',returnTo:'parent-account'});
 assert.equal(res.status,200);assert.equal(new URL(res.data.url).searchParams.has('disable_auto_login'),false);
});

test('verified Gmail administrators use browser authorization without affecting LINE-origin friendship',async()=>{
 for(const mode of ['link','friendship']){
  const h=fixture({role:'admin'});const result=await h.start({mode,returnTo:'notification-center'});
  assert.equal(result.status,200);assert.equal(new URL(result.data.url).searchParams.get('disable_auto_login'),'true');
  assert.deepEqual(h.effects,[]);
 }
 const line=fixture({role:'admin',provider:'line'}),result=await line.start({mode:'friendship',returnTo:'notification-center'});
 assert.equal(result.status,200);assert.equal(new URL(result.data.url).searchParams.has('disable_auto_login'),false);
});
