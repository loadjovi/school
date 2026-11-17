import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {runInNewContext} from "node:vm";
import {familyPaymentInfo} from "../api/src/lib/paymentNoticeRules.mjs";

const source=readFileSync(new URL("../api/src/functions/familyEventRegistration.js",import.meta.url),"utf8");
function fixture(kind="fieldTrip",fees={}){
 const schoolId="sacred-heart",activityId="test-event",rows=new Map(),notifications=[];
 const access={role:"parent",email:"parent@example.invalid"};
 const config={enabled:true,module:kind,feeStatus:"PUBLISHED",paymentOpen:true,studentFee:400,firstAdultFee:600,extraAdultFee:600,extraChildFee:200,...fees};
 const missing=()=>Object.assign(new Error("Missing"),{statusCode:404});
 let handler;
 const context={
  createHash,randomUUID,process:{env:{STORAGE_CONNECTION_STRING:"mock"}},console,
  app:{http:(_,definition)=>{handler=definition.handler}},
  getTenantContext:async()=>({access,schoolId}),ensureStudentAccess:()=>true,getStudentMaster:async()=>({groupName:"A"}),
  json:(data,status=200)=>({data,status}),activityAllowsGroup:()=>true,familyPaymentInfo,
  safePaymentNotifications:async()=>({status:"ok"}),
  notifyAdminTodo:async()=>{notifications.push("general");return "sent"},
  notifyFinanceTransfer:async(school,ref)=>{
   assert.equal(school,schoolId);
   const row=JSON.parse(rows.get(ref.id).payload);
   assert.equal(ref.kind,"family");
   assert.equal(row.paymentStatus,"REPORTED_UNVERIFIED");
   assert.equal(ref.reportedAt,row.transferReport.reportedAt);
   notifications.push("finance");return "sent";
  },
  notifyTenantPaymentVerified:async()=>{notifications.push("parent");return "sent"},
  TableClient:{fromConnectionString:(_,name)=>({
   async createTable(){},
   async getEntity(_school,id){
    if(name==="TenantUniformEventConfig"&&id===kind+":"+activityId)return {payload:JSON.stringify(config)};
    if(name==="TenantEventPaymentAccounts"&&id===kind+":"+activityId)return {};
    if(name==="TenantFamilyEventRegistration"&&rows.has(id))return rows.get(id);
    throw missing();
   },
   async createEntity(row){if(name==="TenantFamilyEventRegistration")rows.set(row.rowKey,{...row,etag:"one"})},
   async updateEntity(row){rows.set(row.rowKey,{...row,etag:"two"})}
  })}
 };
 runInNewContext(source.replace(/^import .*;\r?\n/gm,""),context);
 const call=(method,body)=>handler({method,json:async()=>({kind,activityId,...body})});
 return {call,access,notifications};
}
const attendance={studentIds:["1"],adults:1,extraChildren:0};
const report={lastFive:"12345",transferDate:"2026-11-18"};

test("a paid activity creates a finance notification only after the valid transfer report is persisted",async()=>{
 const {call,access,notifications}=fixture();
 const registration=await call("POST",attendance);
 assert.equal(registration.status,201);
 assert.equal(registration.data.item.paymentStatus,"NOT_OPEN");
 assert.deepEqual(notifications,[]);
 const transfer={action:"REPORT_TRANSFER",...report,amount:1000};
 assert.equal((await call("PATCH",{...transfer,transferDate:"2026-15-18"})).status,400);
 assert.deepEqual(notifications,[]);
 const sent=await call("PATCH",transfer);
 assert.equal(sent.status,200);
 assert.equal(sent.data.financeLineStatus,"sent");
 assert.deepEqual(notifications,["finance"]);
 assert.equal((await call("PATCH",transfer)).status,409);
 assert.deepEqual(notifications,["finance"]);
 access.role="admin";access.capabilities={financeVerifier:true};
 const verified=await call("PATCH",{action:"VERIFY_PAYMENT",registrationId:registration.data.item.id,amount:1000,bankPostedAt:"2026-11-18",note:"已對帳"});
 assert.equal(verified.data.item.paymentStatus,"VERIFIED");
 assert.deepEqual(notifications,["finance","parent"]);
});

test("a dinner that submits registration and transfer together sends one finance LINE and no general staff LINE",async()=>{
 const {call,notifications}=fixture("yearEndDinner",{studentFee:undefined});
 assert.notEqual((await call("POST",attendance)).status,201);
 assert.deepEqual(notifications,[]);
 const response=await call("POST",{...attendance,...report});
 assert.equal(response.status,201);
 assert.equal(response.data.item.transferReport.expectedAmount,600);
 assert.equal(response.data.financeLineStatus,"sent");
 assert.deepEqual(notifications,["finance"]);
});

test("an activity registration with a zero dinner fee creates no finance task or LINE",async()=>{
 const {call,notifications}=fixture("yearEndDinner",{firstAdultFee:0,extraAdultFee:0,extraChildFee:0});
 const response=await call("POST",{...attendance,...report});
 assert.equal(response.status,201);
 assert.equal(response.data.item.paymentStatus,"NOT_REQUIRED");
 assert.deepEqual(notifications,[]);
});
