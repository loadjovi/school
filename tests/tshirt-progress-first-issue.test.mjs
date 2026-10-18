import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const parent=readFileSync(new URL("../app/parent-uniform-events.js",import.meta.url),"utf8");
const admin=readFileSync(new URL("../app/tshirt-admin-shortcuts.js",import.meta.url),"utf8");
const start=parent.indexOf("function firstTshirtProgress(");
const end=parent.indexOf("function renderFirstTshirtProgress(",start);
assert.ok(start>=0&&end>start,"First T-shirt state model must be present");
const ctx={};vm.runInNewContext(parent.slice(start,end)+"\nthis.progress=firstTshirtProgress;",ctx);
const progress=ctx.progress;

test("existing historical issue remains issued when size is missing",()=>{
 const status=progress({historicalIssued:true,studentId:"1",size:null});
 assert.equal(status.title,"已領取｜尺寸待核對");
 assert.match(status.detail,/不必重新申請或再次領取/);
});
test("historic issued record with size is only a size verification",()=>{
 assert.equal(progress({historicalIssued:true,size:"12"}).title,"已領取｜尺寸已登錄");
});
test("reserve unsized has not placed an order or received shirt",()=>{
 assert.equal(progress({historicalIssued:false,size:null}).title,"待填寫尺寸");
});
test("reserve with saved size but no school handoff is pending school issue",()=>{
 assert.equal(progress({historicalIssued:false,size:"8"}).title,"待學校發放");
});
test("school handoff prompts actual parent receipt, rather than claiming completion",()=>{
 const r=progress({historicalIssued:false,size:"8",schoolIssuedAt:"2026-10-18T08:00:00Z"});
 assert.equal(r.title,"學校已發放，待家長確認");
});
test("parent progress reads authoritative first-issue data even with no new orders",()=>{
 assert.match(parent,/parentApi\("uniform-events\/tshirt-historical-size"\)/);
 assert.match(parent,/renderFirstTshirtProgress\(summary,tshirtOutcome\.items\)/);
 assert.match(parent,/if\(!requests\.length\)\{/);
 assert.match(parent,/if\(!tshirtOutcome\.items\.length\)summary\.append/);
 assert.match(parent,/await loadInlineSizes\(\);await loadUniformRequestProgress\(\)/);
});
test("school lists historic issued students without a pending issue request",()=>{
 assert.match(admin,/已領取｜尺寸待核對/);
 assert.match(admin,/已領取｜尺寸已登錄/);
 assert.match(admin,/待學校發放/);
});
test("existing issued history does not become an additional uniform order",()=>{
 const backend=readFileSync(new URL("../api/src/functions/tshirtHistoricalSize.js",import.meta.url),"utf8");
 assert.match(backend,/historicalIssued:issued/);
 assert.match(backend,/source:issued\?"PARENT_BACKFILL_2026":"PARENT_SIZE_SURVEY"/);
 assert.match(backend,/kind:"regularUniform"/);
});
