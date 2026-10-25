import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {newStaffDemand,updateStaffDemand,StaffDemandError} from "../src/lib/tshirtStaffDemandRules.mjs";
const input=()=>({parentEmail:"Parent@example.org",parentName:"家長甲",studentId:"111001",category:"CADRE_FIRST",size:"M",quantity:1,schoolYear:115,semester:1,note:"首次"});
const context=()=>({demands:[],unitPrice:400,actor:"admin@x.org",at:"2026-10-26T00:00:00Z"});
test("staff requests validate size, exact quantity and lifetime entitlement without assuming a child equals a parent",()=>{
 const row=newStaffDemand(input(),context());assert.equal(row.parentEmail,"parent@example.org");assert.equal(row.amount,0);assert.equal(row.paymentStatus,"NOT_REQUIRED");
 assert.throws(()=>newStaffDemand({...input(),quantity:2},context()),/限 1 件/);
 assert.throws(()=>newStaffDemand(input(),{...context(),loan:{status:"ISSUED_LIFETIME"}}),/已有/);
 assert.throws(()=>newStaffDemand({...input(),studentId:"111002"},{...context(),demands:[row]}),/重複/);
 assert.throws(()=>newStaffDemand({...input(),size:"14"},context()),/尺寸/);
});
test("cadre and volunteer extra purchases use server price and require financial confirmation before ordering",()=>{
 for(const category of ["CADRE_EXTRA","VOLUNTEER_EXTRA"]){
  const row=newStaffDemand({...input(),category,quantity:3,amount:1,paymentStatus:"VERIFIED"},context());assert.equal(row.amount,1200);assert.equal(row.paymentStatus,"AWAITING_TRANSFER");
  assert.throws(()=>updateStaffDemand(row,{action:"UPDATE_DEMAND_STATUS",status:"ORDERED",note:"已下單"},{...context(),finance:true}),/財務/);
 }
});
test("finance requires capability and matching actual bank amount, date, last five and evidence",()=>{
 const row=newStaffDemand({...input(),category:"VOLUNTEER_EXTRA",quantity:2},context()),payment={action:"VERIFY_DEMAND_PAYMENT",bankPostedDate:"2026-10-26",lastFive:"12345",paidAmount:800,note:"銀行紀錄已核對"};
 assert.throws(()=>updateStaffDemand(row,payment,context()),e=>e.status===403);
 for(const invalid of [{paidAmount:400},{bankPostedDate:"2026-02-31"},{lastFive:"1234"},{note:""}])assert.throws(()=>updateStaffDemand(row,{...payment,...invalid},{...context(),finance:true}));
 const paid=updateStaffDemand(row,payment,{...context(),finance:true});assert.equal(paid.paymentStatus,"VERIFIED");assert.equal(paid.verifiedBy,"admin@x.org");
 const ordered=updateStaffDemand(paid,{action:"UPDATE_DEMAND_STATUS",status:"ORDERED",note:"已交廠商製作"},context());assert.equal(ordered.status,"ORDERED");assert.throws(()=>updateStaffDemand(ordered,{action:"UPDATE_DEMAND_STATUS",status:"FULFILLED",note:"跳步"},context()));
});
function harness({role="admin",finance=false,initial=[]}={}){
 const records=new Map(initial.map(x=>[x.id,{partitionKey:"school-a",rowKey:x.id,etag:"e1",payload:JSON.stringify(x)}])),calls=[],audits=[];
 const client={createTable:async()=>{},listEntities:async function*({queryOptions}){calls.push(["list",queryOptions.filter]);for(const row of records.values())yield row},getEntity:async(school,id)=>{calls.push(["get",school,id]);if(!records.has(id))throw {statusCode:404};return records.get(id)},createEntity:async row=>{if(records.has(row.rowKey))throw {statusCode:409};records.set(row.rowKey,{...row,etag:"e1"})},updateEntity:async(row,mode,{etag})=>{if(records.get(row.rowKey)?.etag!==etag)throw {statusCode:412};records.set(row.rowKey,{...row,etag:"e2"})}};
 const source=readFileSync(new URL("../src/lib/tshirtStaffProcurement.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"").replace("export async function staffProcurement","async function staffProcurement");
 const scope={TableClient:{fromConnectionString:()=>client},randomUUID:()=>"purchase-1",json:(jsonBody,status=200)=>({jsonBody,status}),getUniformPrice:async()=>({unitPrice:400}),newStaffDemand,updateStaffDemand,StaffDemandError,process:{env:{STORAGE_CONNECTION_STRING:"test"}},Buffer,console};
 runInNewContext(source+"\nthis.run=staffProcurement",scope);
 return {records,calls,audits,run:(method,data)=>scope.run({method,json:async()=>data},{schoolId:"school-a",access:{role,email:"admin@x.org",capabilities:{financeVerifier:finance}}},{loanClient:{getEntity:async()=>{throw {statusCode:404}}},audit:{createEntity:async x=>audits.push(x)},linked:async(s,e,id)=>{calls.push(["linked",s,e,id]);return id==="111001"},data})};
}
test("staff procurement endpoint is school-scoped, read-only for GET, and redacts bank details for nonfinance admins",async()=>{
 const h=harness({initial:[{...newStaffDemand({...input(),category:"CADRE_EXTRA"},context()),id:"x",lastFive:"12345",bankPostedDate:"2026-10-26",verificationNote:"銀行",paidAmount:400}]});
 const r=await h.run("GET");assert.equal(r.status,200);assert.equal(r.headers["Cache-Control"],"no-store");assert.equal(r.jsonBody.items[0].lastFive,undefined);assert.equal(h.audits.length,0);assert.match(h.calls[0][1],/school-a/);
 for(const role of ["parent","teacher","school"]){const blocked=harness({role});assert.equal((await blocked.run("GET")).status,403);assert.equal(blocked.calls.length,0)}
});
test("registration validates linked parent, records an audit, and duplicate first entitlement cannot overwrite",async()=>{
 const h=harness();assert.equal((await h.run("POST",{...input(),action:"ADD_DEMAND",studentId:"111999"})).status,403);
 const r=await h.run("POST",{...input(),action:"ADD_DEMAND"});assert.equal(r.status,200);assert.equal(h.records.size,1);assert.equal(h.audits.length,1);assert.equal(h.audits[0].partitionKey,"school-a");
 assert.equal((await h.run("POST",{...input(),action:"ADD_DEMAND"})).status,409);assert.equal(h.records.size,1);
});
test("stale etag and nonfinance payment writes are rejected without mutating demand",async()=>{
 const h=harness({initial:[{...newStaffDemand({...input(),category:"CADRE_EXTRA"},context()),id:"x"}]});
 assert.equal((await h.run("POST",{id:"x",etag:"stale",action:"UPDATE_DEMAND_STATUS",status:"CANCELLED",note:"取消"})).status,409);
 assert.equal((await h.run("POST",{id:"x",etag:"e1",action:"VERIFY_DEMAND_PAYMENT"})).status,403);assert.equal(h.audits.length,0);assert.equal(JSON.parse(h.records.get("x").payload).status,"APPROVED");
});
