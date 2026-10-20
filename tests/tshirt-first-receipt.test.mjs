import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isFirstTshirtHandoffEligible,buildSchoolHandoffPayload,isFirstTshirtReceiptEligible,buildFirstReceiptPayload} from "../api/src/lib/tshirtReceiptRules.mjs";
const record={historicalIssued:false,issuedQuantity:0,source:"PARENT_SIZE_SURVEY",size:"8",sizeStatus:"PARENT_RECORDED"};
test("size-only reserve student can be handed over but cannot claim parent receipt yet",()=>{
 assert.equal(isFirstTshirtHandoffEligible(record),true);
 assert.equal(isFirstTshirtReceiptEligible(record),false);
 assert.equal(isFirstTshirtHandoffEligible({...record,size:null}),false);
 assert.equal(isFirstTshirtHandoffEligible({...record,size:"unknown"}),false);
});
const handed=buildSchoolHandoffPayload(record,"admin@example.invalid","2026-10-18T06:00:00Z","學生本人");
test("school handoff persists teacher, recipient, size, timestamp and one piece",()=>{
 assert.equal(handed.schoolIssuedBy,"admin@example.invalid");
 assert.equal(handed.schoolHandoffTo,"學生本人");
 assert.equal(handed.schoolIssuedSize,"8");
 assert.equal(handed.schoolIssuedQuantity,1);
 assert.equal(handed.historicalIssued,false);
 assert.equal(isFirstTshirtHandoffEligible(handed),false);
 assert.equal(isFirstTshirtReceiptEligible(handed),true);
 assert.throws(()=>buildSchoolHandoffPayload(handed,"x","now","學生本人"));
 assert.throws(()=>buildSchoolHandoffPayload(record,"x","now"," "));
});
test("existing first issue cannot be reconfirmed",()=>{
 assert.equal(isFirstTshirtReceiptEligible({...handed,historicalIssued:true}),false);
 assert.equal(isFirstTshirtReceiptEligible({...handed,received:true}),false);
 assert.equal(isFirstTshirtReceiptEligible({...handed,issuedQuantity:1}),false);
 assert.equal(isFirstTshirtReceiptEligible({...handed,source:"PARENT_CONFIRMED_FIRST_PUBLIC"}),false);
});
test("parent confirmation persists one physical receipt and an actor/date",()=>{
 const now="2026-10-18T06:30:00.000Z";
 const result=buildFirstReceiptPayload(handed,"parent@example.invalid",now);
 assert.equal(result.historicalIssued,true);
 assert.equal(result.issuedQuantity,1);
 assert.equal(result.received,true);
 assert.equal(result.receivedSize,"8");
 assert.equal(result.size,"8");
 assert.equal(result.receivedBy,"parent@example.invalid");
 assert.equal(result.receivedAt,now);
 assert.equal(result.source,"PARENT_CONFIRMED_FIRST_PUBLIC");
 assert.equal(record.historicalIssued,false);
});
test("attempt to apply another receipt throws",()=>{
 assert.throws(()=>buildFirstReceiptPayload({...handed,historicalIssued:true},"x","now"));
 assert.throws(()=>buildFirstReceiptPayload(record,"x","now"));
});
test("backend verifies parent authorization and etag and stores audit",()=>{
 const s=readFileSync(new URL("../api/src/functions/tshirtHistoricalSize.js",import.meta.url),"utf8");
 assert.match(s,/body\.action==="CONFIRM_FIRST_RECEIPT"/);
 assert.match(s,/access\.role!=="parent"/);
 assert.match(s,/!ensureStudentAccess\(access,body\.studentId\)/);
 assert.match(s,/body\.etag!==row\.etag/);
 assert.match(s,/body\.confirmedReceived!==true/);
 assert.match(s,/body\.receivedSize!==previous\.size/);
 assert.match(s,/tshirt\.first\.public\.parent\.received/);
 assert.match(s,/previous\.source==="PARENT_CONFIRMED_FIRST_PUBLIC"/);
 assert.match(s,/body\.action==="SCHOOL_CONFIRM_HANDOFF"/);
 assert.match(s,/access\.role!=="admin"/);
 assert.match(s,/tshirt\.first\.public\.school\.handoff/);
});
test("parent inline and standalone views expose actual handover action",()=>{
 for(const p of ["parent-uniform-events.js","tshirt-historical-size.js"]){
  const s=readFileSync(new URL("../app/"+p,import.meta.url),"utf8");
  assert.match(s,/CONFIRM_FIRST_RECEIPT/);
  assert.match(s,/我已收到團 T｜確認領取 1 件/);
 }
});
test("school roster uses persisted first receipt, not hardcoded reserve group",()=>{
 const s=readFileSync(new URL("../app/tshirt-admin-shortcuts.js",import.meta.url),"utf8");
 assert.match(s,/history\?history\.historicalIssued!==true/);
 assert.match(s,/PARENT_CONFIRMED_FIRST_PUBLIC/);
});
test("school CSV includes parent confirmed issue and uses same ledger",()=>{
 const s=readFileSync(new URL("../app/tshirt-eligibility-csv.js",import.meta.url),"utf8");
 assert.match(s,/tshirt-historical-size/);
 assert.match(s,/historical\.get\(id\)/);
 assert.match(s,/item\?item\.historicalIssued===true/);
 assert.match(s,/item\?\.receivedAt/);
});

test("school roster must allow authorized handoff and show pending parent acknowledgement",()=>{
 const s=readFileSync(new URL("../app/tshirt-admin-shortcuts.js",import.meta.url),"utf8");
 assert.match(s,/SCHOOL_CONFIRM_HANDOFF/);
 assert.match(s,/schoolIssuedAt/);
 assert.match(s,/學校已發放，待家長確認/);
 assert.match(s,/雙方確認完成/);
});
test("parent interfaces hide receipt action until school handoff",()=>{
 for(const name of ["parent-uniform-events.js","tshirt-historical-size.js"]){
  const s=readFileSync(new URL("../app/"+name,import.meta.url),"utf8");
  assert.match(s,/item\.schoolIssuedAt/);
 }
});
test("CSV includes school handoff and parent receipt times without breaking legacy import preview",()=>{
 const s=readFileSync(new URL("../app/tshirt-eligibility-csv.js",import.meta.url),"utf8");
 assert.match(s,/schoolHandoffStatus/);
 assert.match(s,/schoolIssuedAt/);
 assert.match(s,/parentReceivedAt/);
 assert.match(s,/\[headers,exportHeaders\]/);
});

import {isCurrentTshirtStudent,tshirtRosterMembers,tshirtArchiveLabel} from "../app/tshirt-roster-status.mjs";
test("withdrawn reserve pupil is excluded from current roster and size planning",()=>{
 const rows=[
  ...Array.from({length:10},(_,i)=>({studentId:String(i),groupName:"儲備",status:"active"})),
  {studentId:"115149",groupName:"儲備",status:"inactive",inactiveReason:"退團"},
  {studentId:"oldA",groupName:"A",status:"inactive",inactiveReason:"畢業"},
  {studentId:"currentA",groupName:"A",status:"active"}
 ];
 assert.equal(tshirtRosterMembers(rows,"C","current").length,10);
 assert.equal(tshirtRosterMembers(rows,"C","archive").length,1);
 assert.equal(tshirtRosterMembers(rows,"ALL","current").length,11);
 assert.equal(tshirtRosterMembers(rows,"ALL","archive").length,2);
 assert.equal(tshirtArchiveLabel(rows[10]),"已退團");
 assert.equal(tshirtArchiveLabel(rows[11]),"已畢業");
 assert.equal(isCurrentTshirtStudent({groupName:"B"}),true);
});
test("school T-shirt historical list is separated, read-only, and CSV has separate exports",()=>{
 const js=readFileSync(new URL("../app/tshirt-admin-shortcuts.js",import.meta.url),"utf8");
 const csv=readFileSync(new URL("../app/tshirt-eligibility-csv.js",import.meta.url),"utf8");
 const html=readFileSync(new URL("../app/uniform-event-admin.html",import.meta.url),"utf8");
 assert.match(js,/tshirtRosterMembers\(students,filter,status\)/);
 assert.match(js,/isCurrentTshirtStudent\(s\)&&history\?\.source/);
 assert.match(js,/isCurrentTshirtStudent\(s\)&&size/);
 assert.match(js,/歷史資料｜不列入目前團服發放/);
 assert.match(html,/id="tshirtStudentStatusFilter"/);
 assert.match(html,/option value="archive"/);
 assert.match(html,/id="exportTshirtFormerEligibility"/);
 assert.match(csv,/tshirtRosterMembers\(students,"ALL",mode\)/);
 assert.match(csv,/const eligible=isCurrentTshirtStudent\(student\)&&/);
 assert.match(csv,/rosterExportHeaders=\[\.\.\.exportHeaders,"studentStatus","inactiveReason"\]/);
 assert.match(csv,/exportEligibility\("current"\)/);
 assert.match(csv,/exportEligibility\("archive"\)/);
});
