import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../app/admin-attendance-assist.js",import.meta.url),"utf8");
test("saved administrator attendance triggers fresh daily summary",()=>{
 assert.match(src,/await adminAssistLoad\(\)/);
 assert.match(src,/window\.todayAdminFollowup\(\)/);
 assert.match(src,/window\.refreshAdminFollowup\(\)/);
});
test("show current section completion separately from full ensemble-group summary",()=>{
 assert.match(src,/此分部已完成點名/);
 assert.match(src,/const complete=list\.length>0&&savedCount>=list\.length/);
 assert.match(src,/今日全團統計仍須其他分部完成/);
});
