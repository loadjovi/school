import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const api=readFileSync(new URL("../api/src/functions/tshirtParentLoans.js",import.meta.url),"utf8");
const ui=readFileSync(new URL("../app/tshirt-parent-loans.js",import.meta.url),"utf8");
test("volunteer correction is available only for borrowed or washing shirts and requires size and reason",()=>{
 new vm.Script(ui,{filename:"tshirt-parent-loans.js"});
 assert.match(api,/CORRECT_VOLUNTEER_SIZE/);
 assert.match(api,/\["BORROWED","WASHING"\]\.includes\(old\.status\)/);
 assert.match(api,/if\(!sizes\.has\(size\)\|\|!reason\)/);
 assert.match(api,/if\(size===old\.size\)/);
});
test("volunteer correction preserves old loan lifecycle and emits full before/after audit",()=>{
 assert.match(api,/next=\{\.\.\.previous,size,correctionReason:reason\}/);
 assert.match(api,/action:"tshirt\.parent\."\+action/);
 assert.match(api,/before:previous,after:next/);
 assert.match(api,/etag:old\.etag/);
 assert.match(ui,/更正志工團 T 尺寸/);
 assert.match(ui,/action:"CORRECT_VOLUNTEER_SIZE"/);
 assert.match(ui,/請填寫更正原因/);
});
