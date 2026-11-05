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
});

test("neither receiving source asks the operator to re-enter procurement quantity",()=>{
 const frontend=readFileSync(new URL("../app/uniform-event-admin.js",import.meta.url),"utf8");
 const backend=readFileSync(new URL("../api/src/functions/uniformReceiving.js",import.meta.url),"utf8");
 const start=frontend.indexOf('if(e.target.dataset.receive!==undefined)'),end=frontend.indexOf('const i=e.target.dataset.update',start),receiving=frontend.slice(start,end);
 assert.match(frontend,/dateWrap\.hidden=existing;noteWrap\.hidden=existing;date\.disabled=existing;note\.disabled=existing/);
 assert.match(frontend,/save\.textContent=existing\?"確認使用現有庫存":"確認驗收入庫"/);
 assert.match(frontend,/date\.required=mode\.value==="new";note\.required=mode\.value==="new"/);
 assert.match(receiving,/const receiptSummary=breakdown\.map/);
 assert.doesNotMatch(receiving,/實際件數|receivedFields|input\.type="number"|payload\.receivedBreakdown/);
 assert.match(frontend,/if\(!useExistingStock\)\{payload\.receivedDate=date\.value;payload\.note=note\.value\.trim\(\)\}/);
 assert.match(backend,/normalizeReceivingDetails\(input\)/);
 assert.doesNotMatch(backend,/input\.receivedBreakdown/);
 assert.match(backend,/source:receiptDetails\.useExistingStock\?"existing_stock":"new_arrival"/);
});
