import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {uniformNeedsPayment} from "../api/src/lib/paymentNoticeRules.mjs";
const read=name=>readFileSync(new URL("../api/src/lib/"+name,import.meta.url),"utf8");
const load=(name,scope,exports)=>runInNewContext(read(name).replace(/^import .*;\n/gm,"").replace(/^export /gm,"")+";({"+exports+"})",scope);
const hash=value=>createHash("sha256").update(value).digest("hex");
const request={id:"request-one",kind:"regularUniform",parentEmail:"line-11111111-1111-1111-1111-111111111111@line.invalid",studentId:"student-one",status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",amount:400,size:"S",quantity:1};
function harness(){
 const records=new Map(),requests=new Map(),calls=[],lookups=[];
 let enabled=true,workflow=true,account=true,fail=false,storageFailure=false,target="U"+"a".repeat(32);
 const db={createTable:async()=>{},
  createEntity:async row=>{const key=row.partitionKey+":"+row.rowKey;if(records.has(key))throw Object.assign(Error("exists"),{statusCode:409});records.set(key,{...row})},
  getEntity:async(p,r)=>{const row=records.get(p+":"+r);if(!row)throw Object.assign(Error("missing"),{statusCode:404});return {...row}},
  updateEntity:async row=>{const key=row.partitionKey+":"+row.rowKey;records.set(key,{...records.get(key),...row})},
  listEntities:async function*({queryOptions}){for(const row of records.values())if(queryOptions.filter===`PartitionKey eq '${row.partitionKey}'`)yield {...row}}
 };
 const requestDb={getEntity:async(school,id)=>{const item=requests.get(school+":"+id)||{...request,id};return {payload:JSON.stringify(item)}}};
 const scope={TableClient:{fromConnectionString:(connection,name)=>{if(storageFailure)throw Error("storage unavailable");return name==="TenantUniformEventRequest"?requestDb:db}},lineHash:hash,randomUUID,process:{env:{LAB_ENVIRONMENT:"functional-uat"}},console:{warn(){}},URL,uniformNeedsPayment,
  workflowLineEnabled:()=>workflow,resolveTenantLineChannel:async school=>({loginConfigured:true,botUserId:"bot-"+school,accessToken:"token-"+school,appOrigin:"https://"+school+".example.invalid",paymentRequestLineEnabled:enabled,paymentLineEnabled:false}),
  getTenantLineRecipient:async(school,email,bot)=>{lookups.push({school,email,bot});return account?{lineUserId:target}:null},
  pushLineMessage:async(user,text,options)=>{calls.push({user,text,options});if(fail)throw Error("network response lost")}
 };
 Object.assign(scope,load("tenantLineFeeNotice.js",scope,"sendTenantFeeLine"));
 const functions=load("uniformPaymentLine.js",scope,"notifyUniformPaymentRequired,uniformPaymentLineStates,uniformPaymentLineId");
 return {...functions,records,calls,lookups,setRequest:(school,item)=>requests.set(school+":"+item.id,item),setEnabled:value=>{enabled=value},setWorkflow:value=>{workflow=value},setAccount:value=>{account=value},setFailure:value=>{fail=value},setStorageFailure:value=>{storageFailure=value},setTarget:value=>{target=value}};
}
test("approval pushes the amount and payment instructions to the original parent's own school LINE account once",async()=>{
 const h=harness(),result=await h.notifyUniformPaymentRequired("school-a",request);
 assert.equal(result.status,"accepted");assert.equal(h.calls.length,1);assert.equal(h.calls[0].user,"U"+"a".repeat(32));
 assert.deepEqual(h.lookups[0],{school:"school-a",email:request.parentEmail,bot:"bot-school-a"});
 assert.match(h.calls[0].text,/【LAB｜團服繳款通知】[\s\S]*團 T 申請已核准[\s\S]*尺寸：S｜1 件[\s\S]*NT\$ 400/);
 assert.match(h.calls[0].text,/點「待繳費」[\s\S]*匯款日期與帳號末五碼/);
 assert.match(h.calls[0].text,/https:\/\/school-a\.example\.invalid\/\?schoolId=school-a/);
 assert.equal(h.calls[0].options.accessToken,"token-school-a");assert.ok(h.calls[0].options.retryKey);
 await h.notifyUniformPaymentRequired("school-a",request);assert.equal(h.calls.length,1);
 const states=await h.uniformPaymentLineStates("school-a",[request]);assert.equal(states[request.id].status,"accepted");assert.equal(states[request.id].retryAllowed,false);assert.ok(states[request.id].acceptedAt);
 assert.doesNotMatch(JSON.stringify(states),/retryKey|target|token|lineUserId|@line\.invalid/);
});
test("a network retry preserves the durable provider key and pending notices remain distinguishable from acceptance",async()=>{
 const h=harness();h.setFailure(true);assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"pending");
 assert.equal((await h.uniformPaymentLineStates("school-a",[request]))[request.id].status,"pending");
 h.setFailure(false);assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"accepted");
 assert.equal(h.calls.length,2);assert.equal(h.calls[0].options.retryKey,h.calls[1].options.retryKey);
});
test("an old unresolved attempt cannot silently become a fresh potentially duplicate notification",async()=>{
 const h=harness();h.setFailure(true);await h.notifyUniformPaymentRequired("school-a",request);h.setFailure(false);
 const entry=[...h.records.values()][0];entry.createdAt=new Date(Date.now()-24*60*60*1000).toISOString();
 assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"unconfirmed");assert.equal(h.calls.length,1);
 const state=(await h.uniformPaymentLineStates("school-a",[request]))[request.id];assert.equal(state.status,"unconfirmed");assert.equal(state.retryAllowed,false);
});
test("retry cannot change the initially reserved recipient after the parent's binding changes",async()=>{
 const h=harness();h.setFailure(true);await h.notifyUniformPaymentRequired("school-a",request);h.setFailure(false);h.setTarget("U"+"b".repeat(32));
 assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"target_changed");assert.equal(h.calls.length,1);
});
test("school channels, recipients, public links and history remain isolated for the same request ID",async()=>{
 const h=harness();await h.notifyUniformPaymentRequired("school-a",request);await h.notifyUniformPaymentRequired("school-b",request);
 assert.equal(h.calls.length,2);assert.equal(h.records.size,2);assert.notEqual(h.calls[0].options.retryKey,h.calls[1].options.retryKey);
 assert.equal(h.calls[1].options.accessToken,"token-school-b");assert.match(h.calls[1].text,/https:\/\/school-b\.example\.invalid\/\?schoolId=school-b/);
 assert.equal(h.lookups[1].bot,"bot-school-b");assert.equal((await h.uniformPaymentLineStates("school-c",[request]))[request.id].status,"not_sent");
});
test("pending, public, reported, paid and cancelled requests never produce payable LINE notices",async()=>{
 const h=harness();
 for(const extra of [{status:"PENDING"},{acquisition:"PUBLIC"},{paymentStatus:"REPORTED_UNVERIFIED"},{paymentStatus:"VERIFIED"},{status:"CANCELLED"},{amount:0}])assert.equal((await h.notifyUniformPaymentRequired("school-a",{...request,...extra})).status,"ineligible");
 assert.equal(h.calls.length,0);assert.equal(h.lookups.length,0);
});
test("unbound applicants and disabled environments do not fall back to other parents or staff",async()=>{
 const h=harness();h.setAccount(false);assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"not_bound");
 assert.equal((await h.notifyUniformPaymentRequired("school-a",{...request,parentEmail:""})).status,"applicant_unknown");
 h.setAccount(true);h.setEnabled(false);assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"disabled");
 h.setEnabled(true);h.setWorkflow(false);assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"disabled");assert.equal(h.calls.length,0);
});
test("a self-paid competition uniform uses the same approval notification and correct fee",async()=>{
 const h=harness(),competition={...request,kind:"competitionUniform",style:"女",size:"M",amount:2625};h.setRequest("school-a",competition);assert.equal((await h.notifyUniformPaymentRequired("school-a",competition)).status,"accepted");
 assert.match(h.calls[0].text,/A 團比賽服[\s\S]*女款 M｜1 件[\s\S]*NT\$ 2,625/);
});
test("a transfer reported or amount changed during notification setup prevents a stale payment request",async()=>{
 for(const extra of [{paymentStatus:"REPORTED_UNVERIFIED"},{paymentStatus:"VERIFIED"},{status:"CANCELLED"},{amount:800},{parentEmail:"another@example.invalid"}]){
  const h=harness();h.setRequest("school-a",{...request,...extra});assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"ineligible");assert.equal(h.calls.length,0);
 }
});
test("LAB approval notices follow the isolated school's payment flag and honor an explicit disable",()=>{
 const env={LAB_ENVIRONMENT:"functional-uat"},school="school-a";
 const raw=read("lineTenantConfig.js").replace('const buildEnablesLabPaymentNotifications = false;','const buildEnablesLabPaymentNotifications = true;').replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
 const credentials=runInNewContext(raw+';credentials',{process:{env},URL,defaultTenantId:()=>school,tenantSchoolPartition:value=>value,createHash});
 assert.equal(credentials(school).paymentRequestLineEnabled,true);assert.equal(credentials("school-b").paymentRequestLineEnabled,false);
 env.LINE_SCHOOL_A_PAYMENT_NOTIFICATIONS_ENABLED="false";assert.equal(credentials(school).paymentRequestLineEnabled,false);
 env.LAB_ENVIRONMENT="production";delete env.LINE_SCHOOL_A_PAYMENT_NOTIFICATIONS_ENABLED;assert.equal(credentials(school).paymentRequestLineEnabled,false);
 env.LINE_SCHOOL_A_PAYMENT_NOTIFICATIONS_ENABLED="true";assert.equal(credentials(school).paymentRequestLineEnabled,true);
});
test("storage errors cannot be labelled as notification acceptance or empty successful history",async()=>{
 const h=harness();h.setStorageFailure(true);assert.equal((await h.notifyUniformPaymentRequired("school-a",request)).status,"pending");
 assert.equal(h.calls.length,0);assert.equal((await h.uniformPaymentLineStates("school-a",[request]))[request.id].status,"unknown");
});
