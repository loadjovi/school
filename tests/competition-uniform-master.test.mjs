import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {originalCompetitionRoster,baseForStudent,latestCompetitionRequest,overlayMaster,comparable} from "../api/src/lib/competitionMasterRules.mjs";
const st={rowKey:"113001",studentName:"李旭恩",grade:"4C",instrument:"大提琴"};
const applicant=(acquisition,status="PENDING",createdAt="2026-10-18T08:00:00Z")=>({
 kind:"competitionUniform",studentId:st.rowKey,style:"男",size:"M",acquisition,status,
 id:"req-new",createdAt,updatedAt:createdAt,paymentStatus:acquisition==="PURCHASE"?"AWAITING_TRANSFER":"NOT_REQUIRED"
});
test("paper roster has exactly 15 unique students and three pending decisions",()=>{
 assert.equal(originalCompetitionRoster.length,15);
 assert.equal(new Set(originalCompetitionRoster.map(x=>x[1])).size,15);
 assert.equal(originalCompetitionRoster.filter(x=>x[4]==="PENDING").length,3);
});
test("student ID anchors historical migration and is not confused by display name",()=>{
 const base=baseForStudent(st);
 assert.equal(base.studentId,"113001");
 assert.equal(base.size,"S");
 assert.equal(base.acquisition,"PENDING");
});
test("Sacred Heart's two public acquisition corrections apply to persisted historical receipts only in that school",async()=>{
 const source=readFileSync(new URL("../api/src/lib/competitionUniformMaster.js",import.meta.url),"utf8")
  .replace(/^import .*;$/gm,"").replace(/^export \{.*\};$/gm,"").replace(/^export /gm,"");
 const rows=new Map(),audit=[];
 const store={
  async createTable(){},
  async getEntity(school,id){return rows.get(school+"|"+id)},
  async updateEntity(entity,_mode,{etag}){
   assert.equal(etag,"v1");
   rows.set(entity.partitionKey+"|"+entity.rowKey,{...entity,etag:"v1"});
  }
 };
 const update=runInNewContext(source+"\nupsertCurrentCompetitionMaster",{
  baseForStudent,overlayMaster,comparable,randomUUID:()=>String(audit.length),
  process:{env:{STORAGE_CONNECTION_STRING:"mock"}},
  TableClient:{fromConnectionString:(_connection,tableName)=>tableName==="TenantUniformEventAudit"?
   {async createTable(){},async createEntity(row){audit.push(row)}}:store}
 });
 for(const student of [st,{rowKey:"113003",studentName:"蔡昀潔",grade:"5A"}]){
  const old={...baseForStudent(student),received:true};
  assert.equal(old.acquisition,"PENDING");
  for(const school of ["sacred-heart","other-school"])rows.set(school+"|"+student.rowKey,{payload:JSON.stringify(old),etag:"v1"});
  const corrected=await update("sacred-heart",student,null,"admin");
  assert.deepEqual({...corrected},{...old,acquisition:"PUBLIC"});
  await update("sacred-heart",student,null,"admin");
  assert.equal(JSON.parse(rows.get("sacred-heart|"+student.rowKey).payload).acquisition,"PUBLIC");
  assert.equal((await update("other-school",student,null,"admin")).acquisition,"PENDING");
 }
 assert.equal(audit.length,2);
 for(const entry of audit){
  const {before,after}=JSON.parse(entry.details);
  assert.deepEqual(after,{...before,acquisition:"PUBLIC"});
 }
 assert.equal(baseForStudent({...st,studentName:"蘇聖翔"},"sacred-heart").acquisition,"PENDING");
 const historical=baseForStudent(st,"sacred-heart");
 assert.equal(overlayMaster(historical,applicant("PURCHASE"),st).acquisition,"PURCHASE");
});
test("new parent PUBLIC application overwrites the canonical historic choice and size",()=>{
 const next=overlayMaster(baseForStudent(st),applicant("PUBLIC"),st);
 assert.equal(next.studentId,st.rowKey);
 assert.equal(next.acquisition,"PUBLIC");
 assert.equal(next.style,"男");
 assert.equal(next.size,"M");
 assert.equal(next.requestStatus,"PENDING");
 assert.equal(next.received,false);
 assert.equal(next.source,"parent_request");
});
test("new PURCHASE application does not create a false issued event",()=>{
 const next=overlayMaster(baseForStudent(st),applicant("PURCHASE","APPROVED"),st);
 assert.equal(next.acquisition,"PURCHASE");
 assert.equal(next.paymentStatus,"AWAITING_TRANSFER");
 assert.equal(next.received,false);
});
test("historical handover remains true when new application is still pending",()=>{
 const historical=baseForStudent({rowKey:"113002",studentName:"林心澄",grade:"4A"});
 assert.equal(historical.received,true);
 const next=overlayMaster(historical,{...applicant("PURCHASE"),studentId:"113002"}, {studentName:"林心澄",grade:"4A"});
 assert.equal(next.acquisition,"PURCHASE");
 assert.equal(next.received,true);
 assert.equal(next.requestStatus,"PENDING");
});
test("older request updates cannot override a newer application",()=>{
 const older={...applicant("PUBLIC","FULFILLED","2026-09-01T00:00:00Z"),id:"r1",updatedAt:"2026-10-19T00:00:00Z"};
 const newer={...applicant("PURCHASE","PENDING","2026-10-18T00:00:00Z"),id:"r2"};
 assert.equal(latestCompetitionRequest([older,newer],"113001").id,"r2");
});
test("cancelled application is not chosen as current",()=>{
 const cancelled={...applicant("PURCHASE"),id:"cancelled",status:"CANCELLED"};
 assert.equal(latestCompetitionRequest([cancelled],"113001"),null);
});
test("other student's request never changes this student's master",()=>{
 assert.equal(latestCompetitionRequest([{...applicant("PUBLIC"),studentId:"other"}],"113001"),null);
});
test("master comparison detects changes that must trigger audit",()=>{
 const current=baseForStudent(st);
 const next=overlayMaster(current,applicant("PUBLIC"),st);
 assert.notEqual(comparable(current),comparable(next));
});
test("school roster and CSV are generated from the persistent master only",()=>{
 const file=readFileSync(new URL("../app/competition-roster-preview.js",import.meta.url),"utf8");
 assert.match(file,/uniform-events\/competition-master/);
 assert.doesNotMatch(file,/from "\.\/competition-roster-data/);
 assert.match(file,/A團比賽服_正式主檔\.csv/);
 assert.match(file,/unmatched\.length/);
});
test("historical public issuance closes the order without inventing arrival data",async()=>{
 const source=readFileSync(new URL("../api/src/functions/competitionDirectIssue.js",import.meta.url),"utf8")
  .replace(/^import .*;$/gm,"");
 const rows=new Map([
  ["order",{etag:"v1",payload:JSON.stringify(applicant("PUBLIC","ORDERED"))}]
 ]);
 const missing=()=>Object.assign(Error("missing"),{statusCode:404});
 const table={
  createTable:async()=>{},
  async getEntity(school,key){assert.equal(school,"sacred-heart");if(!rows.has(key))throw missing();return rows.get(key)},
  async createEntity(row){assert.equal(row.rowKey,"issued:order");rows.set(row.rowKey,row)},
  async updateEntity(row,mode,options){assert.equal(options.etag,"v1");rows.set(row.rowKey,row)}
 };
 let handler;
 runInNewContext(source,{
  app:{http:(_name,route)=>{handler=route.handler}},
  TableClient:{fromConnectionString:()=>table},
  getTenantContext:async()=>({schoolId:"sacred-heart",access:{role:"admin",email:"admin@example.invalid"}}),
  process:{env:{STORAGE_CONNECTION_STRING:"mock"}},
  json:(value,status=200)=>({value,status})
 });
 const submit=()=>handler({json:async()=>({id:"order",etag:"v1",historicalConfirmation:true,note:"校方確認先前已領取"})});
 const result=await submit();
 assert.equal(result.status,200);
 assert.equal(result.value.item.status,"FULFILLED");
 assert.ok(result.value.item.receiptConfirmedAt);
 assert.equal(result.value.item.stockReceivedDate,undefined);
 assert.equal(result.value.item.receivedBy,undefined);
 assert.equal(rows.get("issued:order").issuedAt,undefined);
 assert.equal((await submit()).value.alreadyCompleted,true);
});
