import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const source=readFileSync(new URL("../src/functions/uniformEventRequests.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"");
function harness({bank=true,price=400}={}){
 let access={role:"parent",email:"parent@example.invalid"},schoolId="school-a",handler,sequence=0,writes=0;
 const tables=new Map(),notices=[];
 const db=name=>{
  if(!tables.has(name))tables.set(name,new Map());const rows=tables.get(name);
  return {createTable:async()=>{},getEntity:async(p,r)=>{const row=rows.get(p+":"+r);if(!row)throw Object.assign(Error("missing"),{statusCode:404});return {...row}},
   createEntity:async row=>{rows.set(row.partitionKey+":"+row.rowKey,{...row,etag:"e1"});if(name==="TenantUniformEventRequest")writes++},
   updateEntity:async(row,mode,options)=>{const key=row.partitionKey+":"+row.rowKey;if(rows.get(key)?.etag!==options.etag)throw Object.assign(Error("conflict"),{statusCode:412});rows.set(key,{...row,etag:"e2"});if(name==="TenantUniformEventRequest")writes++},
   listEntities:async function*({queryOptions}={}){for(const row of rows.values())if(!queryOptions||queryOptions.filter.includes("'"+row.partitionKey+"'"))yield {...row}}
  };
 };
 const setBank=value=>{const name="TenantUniformPaymentAccounts";db(name);const rows=tables.get(name),key="school-a:uniform:regularUniform";if(value)rows.set(key,{partitionKey:"school-a",rowKey:"uniform:regularUniform",payload:'{"templateId":"bank-one"}'});else rows.delete(key)};
 setBank(bank);
 const context={app:{http:(name,config)=>{handler=config.handler}},TableClient:{fromConnectionString:(connection,name)=>db(name)},randomUUID:()=>"record-"+(++sequence),
  getTenantContext:async()=>({access,schoolId}),ensureStudentAccess:(value,id)=>id==="student-one",getStudentAliasInfo:async id=>({canonicalStudentId:id}),json:(body,status=200)=>({status,jsonBody:body}),
  getStudentMaster:async id=>id==="student-one"?{studentName:"學生甲",groupName:"A"}:null,listUserStudentMappings:async()=>[],
  sendUniformRequestStatusEmail:async()=>({status:"disabled"}),safePaymentNotifications:async(school,options)=>{notices.push({school,options});return {status:"disabled"}},paymentNotificationStatus:result=>result?.status||"not_attempted",uniformNeedsPayment:item=>item.status==="APPROVED"&&item.amount>0,
  getUniformPrice:async()=>({unitPrice:price}),upsertCurrentCompetitionMaster:async()=>{},latestCompetitionRequest:items=>items[0],notifyUniformReview:async()=>"not_configured",notifyUniformCancellation:async()=>"not_required",process:{env:{STORAGE_CONNECTION_STRING:"test"}},console
 };
 runInNewContext(source,context);
 const call=(method,body)=>handler({method,query:new URLSearchParams(),json:async()=>body});
 const create=()=>call("POST",{kind:"regularUniform",studentId:"student-one",size:"S",quantity:2});
 const admin=()=>{access={role:"admin",email:"admin@example.invalid",capabilities:{financeVerifier:true}}};
 const get=async()=>{const result=await call("GET");return result.jsonBody.items[0]};
 return {call,create,admin,get,setBank,notices,writes:()=>writes,setAccess:value=>{access=value},setSchool:value=>{schoolId=value}};
}
test("a parent shirt application becomes payable after admin approval and the parent reads the same persisted state",async()=>{
 const h=harness(),created=await h.create();assert.equal(created.status,201);assert.equal(created.jsonBody.item.status,"PENDING");
 h.admin();const before=await h.get();const result=await h.call("PATCH",{id:before.id,etag:before.etag,status:"APPROVED"});assert.equal(result.status,200);
 h.setAccess({role:"parent",email:"parent@example.invalid"});const saved=await h.get();
 assert.equal(saved.id,before.id);assert.equal(saved.status,"APPROVED");assert.equal(saved.amount,800);assert.equal(saved.unitPrice,400);assert.equal(saved.paymentStatus,"AWAITING_TRANSFER");assert.equal(saved.size,"S");assert.equal(saved.quantity,2);
 assert.equal(h.writes(),2);assert.equal(h.notices.length,1);assert.equal(h.notices[0].options.scope.id,before.id);
});
test("missing account rejects approval without changing the request; binding the account lets the same request proceed",async()=>{
 const h=harness({bank:false});await h.create();h.admin();const before=await h.get(),input={id:before.id,etag:before.etag,status:"APPROVED"};
 const rejected=await h.call("PATCH",input);assert.equal(rejected.status,409);assert.equal(rejected.jsonBody.code,"UNIFORM_PAYMENT_ACCOUNT_REQUIRED");
 assert.equal((await h.get()).status,"PENDING");assert.equal(h.writes(),1);assert.equal(h.notices.length,0);
 h.setBank(true);assert.equal((await h.call("PATCH",input)).status,200);assert.equal((await h.get()).status,"APPROVED");assert.equal(h.writes(),2);
});
test("invalid pricing cannot persist an approved request with no payable amount",async()=>{
 for(const price of [0,-1,null,NaN]){
  const h=harness({price});await h.create();h.admin();const before=await h.get(),result=await h.call("PATCH",{id:before.id,etag:before.etag,status:"APPROVED"});
  assert.equal(result.status,409);assert.match(result.jsonBody.error,/價格/);assert.equal((await h.get()).status,"PENDING");assert.equal(h.writes(),1);
 }
});
test("concurrent updates cannot repeat approval or its payment notification",async()=>{
 const h=harness();await h.create();h.admin();const before=await h.get(),input={id:before.id,etag:before.etag,status:"APPROVED"};
 assert.equal((await h.call("PATCH",input)).status,200);assert.equal((await h.call("PATCH",input)).status,409);
 assert.equal(h.writes(),2);assert.equal(h.notices.length,1);
});
test("another school, a parent and a teacher cannot approve the request",async()=>{
 const h=harness();await h.create();h.admin();const before=await h.get(),input={id:before.id,etag:before.etag,status:"APPROVED"};
 h.setSchool("school-b");assert.equal((await h.call("PATCH",input)).status,404);
 h.setSchool("school-a");h.setAccess({role:"parent",email:"parent@example.invalid"});assert.equal((await h.call("PATCH",input)).status,400);
 h.setAccess({role:"teacher",email:"teacher@example.invalid"});assert.equal((await h.call("PATCH",input)).status,403);assert.equal(h.writes(),1);
});
