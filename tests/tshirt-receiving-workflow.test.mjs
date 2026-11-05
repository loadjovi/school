import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeReceivingDetails,taipeiReceiptDate} from "../api/src/lib/uniformReceivingRules.mjs";

test("new arrivals still require an actual date and inspection note",()=>{
 assert.deepEqual(
  normalizeReceivingDetails({receivedDate:"2026-11-05",note:"  尺碼與外觀均已核對  "}),
  {useExistingStock:false,receivedDate:"2026-11-05",note:"尺碼與外觀均已核對"}
 );
 assert.throws(()=>normalizeReceivingDetails({receivedDate:"2026-11-05",note:"  "}),/新貨到校/);
 assert.throws(()=>normalizeReceivingDetails({receivedDate:"",note:"已核對"}),/新貨到校/);
});

test("existing stock needs no arrival date or inspection note from the operator",()=>{
 const now=new Date("2026-11-05T16:30:00.000Z");
 assert.equal(taipeiReceiptDate(now),"2026-11-06");
 assert.deepEqual(
  normalizeReceivingDetails({useExistingStock:true},now),
  {useExistingStock:true,receivedDate:"2026-11-06",note:"使用先前已盤點的現有庫存，不重複增加庫存"}
 );
});

test("receiving form keeps an active draft during background status redraws",()=>{
 const source=readFileSync(new URL("../app/uniform-event-admin.js",import.meta.url),"utf8");
 assert.match(source,/const receivingDrafts=new Map\(\)/);
 assert.match(source,/activeReceivingForm\?\.isConnected&&activeReceivingTab===activeAdminTab\)return/);
 assert.match(source,/form\.addEventListener\("input",saveDraft\)/);
 assert.match(source,/receivingDrafts\.set\(requestKey,\{mode:mode\.value,receivedDate:date\.value,note:note\.value/);
 assert.match(source,/draft\.quantities&&draft\.quantities\[part\.size\]!==undefined/);
});

test("existing-stock mode hides and disables arrival-only fields",()=>{
 const frontend=readFileSync(new URL("../app/uniform-event-admin.js",import.meta.url),"utf8");
 const backend=readFileSync(new URL("../api/src/functions/uniformReceiving.js",import.meta.url),"utf8");
 assert.match(frontend,/dateWrap\.hidden=existing;noteWrap\.hidden=existing;date\.disabled=existing;note\.disabled=existing/);
 assert.match(frontend,/date\.required=mode\.value==="new";note\.required=mode\.value==="new"/);
 assert.match(frontend,/if\(!useExistingStock\)\{payload\.receivedDate=date\.value;payload\.note=note\.value\.trim\(\)\}/);
 assert.match(backend,/normalizeReceivingDetails\(input\)/);
 assert.match(backend,/source:receiptDetails\.useExistingStock\?"existing_stock":"new_arrival"/);
});
