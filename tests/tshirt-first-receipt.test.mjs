import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isFirstTshirtReceiptEligible,buildFirstReceiptPayload} from "../api/src/lib/tshirtReceiptRules.mjs";
const record={historicalIssued:false,issuedQuantity:0,source:"PARENT_SIZE_SURVEY",size:"8",sizeStatus:"PARENT_RECORDED"};
test("size-only reserve student is eligible only after size is registered",()=>{
 assert.equal(isFirstTshirtReceiptEligible(record),true);
 assert.equal(isFirstTshirtReceiptEligible({...record,size:null}),false);
 assert.equal(isFirstTshirtReceiptEligible({...record,size:"unknown"}),false);
});
test("existing first issue cannot be reconfirmed",()=>{
 assert.equal(isFirstTshirtReceiptEligible({...record,historicalIssued:true}),false);
 assert.equal(isFirstTshirtReceiptEligible({...record,received:true}),false);
 assert.equal(isFirstTshirtReceiptEligible({...record,issuedQuantity:1}),false);
 assert.equal(isFirstTshirtReceiptEligible({...record,source:"PARENT_CONFIRMED_FIRST_PUBLIC"}),false);
});
test("parent confirmation persists one physical receipt and an actor/date",()=>{
 const now="2026-10-18T06:30:00.000Z";
 const result=buildFirstReceiptPayload(record,"parent@example.invalid",now);
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
 assert.throws(()=>buildFirstReceiptPayload({...record,historicalIssued:true},"x","now"));
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
