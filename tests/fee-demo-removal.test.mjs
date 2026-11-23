import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../api/src/lib/lineTenantConfig.js",import.meta.url),"utf8");
const fingerprint=value=>createHash("sha256").update(value).digest("hex");
function configuration({labBuild=true,environment="functional-uat",settings={}}={}){
 const env={LAB_ENVIRONMENT:environment,STORAGE_CONNECTION_STRING:"test",...settings};
 const rows=new Map();
 const db={getEntity:async(_partition,key)=>{const row=rows.get(key);if(!row)throw Object.assign(Error("missing"),{statusCode:404});return row}};
 const code=source.replace(/^import .*;\n/gm,"").replace(/^export /gm,"")
  .replace("const buildEnablesLabPaymentNotifications = false;",`const buildEnablesLabPaymentNotifications = ${labBuild};`)
  .replace("const buildDisablesLabFeeProjects = false;",`const buildDisablesLabFeeProjects = ${labBuild};`);
 const api=runInNewContext(code+";({tenantFeeEnabled,resolveTenantLineChannel})",{createHash,URL,process:{env},defaultTenantId:()=>"sacred-heart",tenantSchoolPartition:String,getTenantDirectory:async schoolId=>({schoolId,status:"active"}),TableClient:{fromConnectionString:()=>db}});
 const setChannel=schoolId=>{
  const prefix="LINE_"+schoolId.replaceAll("-","_").toUpperCase();
  env[prefix+"_CHANNEL_SECRET"]="secret-"+schoolId;env[prefix+"_CHANNEL_ACCESS_TOKEN"]="token-"+schoolId;
  env[prefix+"_LOGIN_CHANNEL_ID"]="1234567890";env[prefix+"_LOGIN_CHANNEL_SECRET"]="login-secret-"+schoolId;env[prefix+"_APP_ORIGIN"]="https://"+schoolId+".example.test";
  rows.set("school-"+schoolId,{status:"active",botUserId:"U"+"a".repeat(32),secretFingerprint:fingerprint(env[prefix+"_CHANNEL_SECRET"]),tokenFingerprint:fingerprint(env[prefix+"_CHANNEL_ACCESS_TOKEN"]),loginFingerprint:fingerprint(JSON.stringify([env[prefix+"_LOGIN_CHANNEL_ID"],env[prefix+"_LOGIN_CHANNEL_SECRET"],env[prefix+"_APP_ORIGIN"]]))});
 };
 return {...api,env,rows,setChannel};
}

test("named LINE LAB disables the removed fee-project capability even if old school settings still enable it",()=>{
 const h=configuration({settings:{LINE_SACRED_HEART_FEE_COLLECTIONS_ENABLED:"true",LINE_SCHOOL_B_FEE_COLLECTIONS_ENABLED:"true"}});
 assert.equal(h.tenantFeeEnabled("sacred-heart"),false);assert.equal(h.tenantFeeEnabled("school-b"),false);
});
test("removed LAB project and transfer APIs stop before any read, write or request body processing",async()=>{
 const h=configuration({settings:{LINE_SACRED_HEART_FEE_COLLECTIONS_ENABLED:"true"}}),handlers={};let role="admin",storageCalls=0;
 const apiSource=readFileSync(new URL("../api/src/functions/feeCollections.js",import.meta.url),"utf8").replace(/^import\s+[\s\S]*?;\r?\n/gm,"");
 runInNewContext(apiSource,{createHash,process:{env:h.env},app:{http:(name,options)=>{handlers[name]=options.handler}},getTenantContext:async()=>({schoolId:"sacred-heart",access:{role,capabilities:{financeVerifier:true}}}),tenantFeeEnabled:h.tenantFeeEnabled,json:(jsonBody,status=200)=>({jsonBody,status}),TableClient:{fromConnectionString(){storageCalls++;throw Error("removed API must not access storage")}}});
 for(role of ["admin","parent"])for(const [name,methods] of [["feeCollectionProjects",["GET","POST","PATCH"]],["feeCollectionTransfers",["POST","PATCH"]]])for(const method of methods){
  const response=await handlers[name]({method,json:async()=>{throw Error("removed API must not parse mutations")}});
  assert.equal(response.status,404);assert.match(response.jsonBody.error,/尚未開啟收費專案/);
 }
 assert.equal(storageCalls,0);
});
test("the retired standalone fee DEMO stays disabled in ordinary and production builds despite old feature settings",()=>{
 for(const config of [{labBuild:false,environment:"functional-uat"},{labBuild:false,environment:"production"},{labBuild:true,environment:"production"}]){
  const h=configuration(config);assert.equal(h.tenantFeeEnabled("sacred-heart"),false);assert.equal(h.tenantFeeEnabled("school-b"),false);
  h.env.LINE_SCHOOL_B_FEE_COLLECTIONS_ENABLED="true";assert.equal(h.tenantFeeEnabled("school-b"),false);assert.equal(h.tenantFeeEnabled("sacred-heart"),false);
  h.env.LINE_SCHOOL_B_FEE_COLLECTIONS_ENABLED="false";assert.equal(h.tenantFeeEnabled("school-b"),false);
 }
});
test("removing fee projects keeps the existing named-school LAB payment request, finance and confirmation LINE fallback",async()=>{
 const h=configuration();h.setChannel("sacred-heart");
 const channel=await h.resolveTenantLineChannel("sacred-heart");
 assert.equal(h.tenantFeeEnabled("sacred-heart"),false);assert.equal(channel.loginConfigured,true);
 assert.equal(channel.paymentRequestLineEnabled,true);assert.equal(channel.financeTransferLineEnabled,true);assert.equal(channel.paymentConfirmationLineEnabled,true);
 assert.equal(channel.paymentLineEnabled,false,"the legacy general payment switch is not silently enabled");
});
test("the LAB payment fallback is not inherited by another school, a legacy channel or a production deployment",async()=>{
 const h=configuration();h.setChannel("school-b");const other=await h.resolveTenantLineChannel("school-b");
 assert.equal(other.paymentRequestLineEnabled,false);assert.equal(other.financeTransferLineEnabled,false);assert.equal(other.paymentConfirmationLineEnabled,false);
 const legacy=configuration({settings:{LINE_CHANNEL_SECRET:"legacy-secret",LINE_CHANNEL_ACCESS_TOKEN:"legacy-token"}});const old=await legacy.resolveTenantLineChannel("sacred-heart");
 assert.equal(old.legacy,true);assert.equal(old.paymentRequestLineEnabled,false);assert.equal(old.financeTransferLineEnabled,false);assert.equal(old.paymentConfirmationLineEnabled,false);
 for(const config of [{labBuild:false,environment:"production"},{labBuild:true,environment:"production"},{labBuild:false,environment:"functional-uat"}]){
  const p=configuration(config);p.setChannel("sacred-heart");const channel=await p.resolveTenantLineChannel("sacred-heart");assert.equal(channel.paymentRequestLineEnabled,false);assert.equal(channel.financeTransferLineEnabled,false);assert.equal(channel.paymentConfirmationLineEnabled,false);
 }
});
test("each school's explicit notification switch still controls its own channel after DEMO removal",async()=>{
 const h=configuration();h.setChannel("sacred-heart");h.setChannel("school-b");
 h.env.LINE_SACRED_HEART_PAYMENT_NOTIFICATIONS_ENABLED="false";
 const disabled=await h.resolveTenantLineChannel("sacred-heart");assert.equal(disabled.paymentRequestLineEnabled,false);assert.equal(disabled.financeTransferLineEnabled,false);assert.equal(disabled.paymentConfirmationLineEnabled,false);
 h.env.LINE_SCHOOL_B_PAYMENT_NOTIFICATIONS_ENABLED="true";
 const explicit=await h.resolveTenantLineChannel("school-b");assert.equal(explicit.paymentLineEnabled,true);assert.equal(explicit.paymentRequestLineEnabled,true);assert.equal(explicit.financeTransferLineEnabled,true);assert.equal(explicit.paymentConfirmationLineEnabled,true);
 assert.equal(h.tenantFeeEnabled("school-b"),false,"enabling LINE notifications does not re-enable removed LAB fee projects");
});
