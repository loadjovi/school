import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createPaidActivitySchedulerAuthorizer} from "../api/src/lib/paidActivitySchedulerAuth.mjs";

const pair=generateKeyPairSync("rsa",{modulusLength:2048});
const other=generateKeyPairSync("rsa",{modulusLength:2048});
const key={...pair.publicKey.export({format:"jwk"}),kid:"github-key",alg:"RS256",use:"sig"};
const now=Date.parse("2026-11-24T01:00:00Z"),seconds=Math.floor(now/1000);
const claims={iss:"https://token.actions.githubusercontent.com",aud:"https://lively-field-09afddc00.6.azurestaticapps.net",
  sub:"repo:loadjovi/school:ref:refs/heads/main",repository:"loadjovi/school",repository_id:"1369594952",
  repository_owner:"loadjovi",repository_owner_id:"230955742",ref:"refs/heads/main",ref_type:"branch",
  workflow_ref:"loadjovi/school/.github/workflows/paid-activity-production-dispatch.yml@refs/heads/main",
  event_name:"schedule",runner_environment:"github-hosted",iat:seconds,nbf:seconds-5,exp:seconds+300,jti:"test-job-identity"};
const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
function token(change={},header={},privateKey=pair.privateKey){
  const value=encode({typ:"JWT",alg:"RS256",kid:key.kid,...header})+"."+encode({...claims,...change});
  return "Bearer "+value+"."+sign("RSA-SHA256",Buffer.from(value),privateKey).toString("base64url");
}
function fixture({env={},document={keys:[key]},fetchError=false}={}){
  let time=now;const calls=[];
  const authorize=createPaidActivitySchedulerAuthorizer({now:()=>time,environment:()=>env,fetchImpl:async(url,options)=>{
    calls.push([url,options]);if(fetchError)throw Error("offline");
    return {ok:true,headers:{get:()=>""},text:async()=>JSON.stringify(document)};
  }});
  return {authorize,calls,advance:value=>time+=value};
}

test("only the fixed production main scheduler can authenticate with a valid GitHub signature",async()=>{
  const h=fixture();
  assert.equal((await h.authorize(token())).method,"github-oidc");
  assert.equal((await h.authorize(token({event_name:"workflow_dispatch"}))).authorized,true);
  assert.equal((await h.authorize(token({sub:"repo:loadjovi@230955742/school@1369594952:ref:refs/heads/main"}))).authorized,true);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0][0],"https://token.actions.githubusercontent.com/.well-known/jwks");
  assert.equal(h.calls[0][1].redirect,"error");
});

test("changed tenant environment, repository identity, workflow, audience, event and time claims fail closed before JWKS requests",async()=>{
  const h=fixture();
  const rejected=[{iss:"https://example.test"},{aud:"https://another-school.test"},{aud:[claims.aud]},
    {repository:"attacker/school"},{repository_id:"42"},{repository_owner_id:"42"},{repository_owner:"attacker"},
    {ref:"refs/heads/feature"},{ref_type:"tag"},{workflow_ref:claims.workflow_ref.replace("production-dispatch","other")},
    {sub:"repo:loadjovi/school:pull_request"},{event_name:"pull_request"},{event_name:"push"},
    {runner_environment:"self-hosted"},{iat:seconds+31},{iat:seconds-601},{exp:seconds-31},{exp:seconds+601},
    {nbf:seconds+31},{exp:String(seconds+300)},{nbf:null},{jti:""}];
  for(const change of rejected)assert.equal((await h.authorize(token(change))).authorized,false,JSON.stringify(change));
  for(const env of [{LAB_ENVIRONMENT:"functional-uat"},{LAB_ENVIRONMENT:"preview"}]){
    const lab=fixture({env});assert.equal((await lab.authorize(token())).authorized,false);assert.equal(lab.calls.length,0);
  }
  assert.equal(h.calls.length,0);
});

test("forged signatures, unsupported algorithms, embedded keys and malformed tokens cannot authorize dispatch",async()=>{
  const h=fixture();
  for(const value of ["",null,"Bearer abc.def.ghi",token({}, {},other.privateKey),token({}, {alg:"none"}),
    token({}, {typ:"JWE"}),token({}, {jku:"https://attacker.test/keys"}),token({}, {jwk:key}),token({}, {crit:["unknown"]}),
    "Bearer "+"a".repeat(16001)])assert.equal((await h.authorize(value)).authorized,false);
  const valid=token(),parts=valid.split(".");parts[1]=encode({...claims,repository_id:"bad"});
  assert.equal((await h.authorize(parts.join("."))).authorized,false);
});

test("shared-secret Logic Apps remain supported while unsigned requests are rejected without touching storage",async()=>{
  for(const env of [{LINE_PAID_ACTIVITY_SCHEDULER_TOKEN:"existing-secret"},{LAB_ENVIRONMENT:"functional-uat",LINE_PAID_ACTIVITY_SCHEDULER_TOKEN:"existing-secret"}]){
    const h=fixture({env});assert.equal((await h.authorize("Bearer existing-secret")).method,"shared-secret");
    assert.equal((await h.authorize("Bearer wrong-secret")).authorized,false);assert.equal(h.calls.length,0);
  }
  assert.equal((await fixture({env:{LAB_ENVIRONMENT:"functional-uat"}}).authorize("")).status,503);
  assert.equal((await fixture().authorize("")).status,401);
});

test("identity provider failures, invalid or ambiguous keys never authorize and unknown kids do not create a fetch loop",async()=>{
  for(const options of [{fetchError:true},{document:{keys:[]}},{document:{keys:[key,{...key}]}},
    {document:{keys:[{...key,kty:"EC"}]}},{document:{keys:[{...key,n:"AA"}]}},
    {document:{keys:[{...key,d:"private-material"}]}},{document:{keys:Array(33).fill(key)}}]){
    assert.equal((await fixture(options).authorize(token())).authorized,false);
  }
  const h=fixture();await h.authorize(token({}, {kid:"unknown"}));await h.authorize(token({}, {kid:"another"}));
  assert.equal(h.calls.length,1);h.advance(31000);await h.authorize(token({}, {kid:"another"}));assert.equal(h.calls.length,2);
});

test("dispatch endpoint authenticates first and processes only persisted due rows, never caller-supplied audiences",async()=>{
  const file=readFileSync(new URL("../api/src/functions/paidActivityNoticeDispatch.js",import.meta.url),"utf8");
  const h=fixture(),rows=Array.from({length:6},(_,i)=>({partitionKey:"school-"+i,rowKey:"event-"+i})),dispatched=[];
  let handler,reads=0,filters=[];
  const db={listEntities:({queryOptions})=>{reads++;filters.push(queryOptions.filter);return (async function*(){for(const row of rows)yield row})()}};
  const context={app:{http:(_,route)=>handler=route.handler},TableClient:{fromConnectionString:()=>db},process:{env:{}},Date,
    authorizePaidActivityScheduler:h.authorize,json:(data,status=200)=>({data,status}),
    dispatchPaidActivityNotices:async(client,row)=>{assert.equal(client,db);dispatched.push(row)}};
  runInNewContext(file.replace(/^import .*;$/gm,""),context);
  const request=authorization=>({headers:{get:()=>authorization},json:()=>assert.fail("Dispatcher must not read caller-selected audiences")});
  assert.equal((await handler(request(""))).status,401);assert.equal(reads,0);
  const result=await handler(request(token()));assert.equal(result.status,200);assert.equal(result.data.processed,4);
  assert.equal(dispatched.length,4);assert.equal(dispatched[0].partitionKey,"school-0");
  assert.match(filters[0],/paidLineDueAt gt '' and paidLineDueAt le '/);
});
