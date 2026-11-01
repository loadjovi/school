import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const ui=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
const api=readFileSync(new URL("../api/src/functions/privateLesson.js",import.meta.url),"utf8");
test("school admin lookup script parses and is reachable from the work homepage",()=>{
 new vm.Script(ui,{filename:"school-admin-workspace.js"});
 assert.match(ui,/\['privateLookup','個課紀錄查詢'/);
 assert.match(ui,/data-lookup-private-run/);
 assert.match(ui,/awLessonStudent/);
 assert.match(ui,/awLessonMonth/);
 assert.match(ui,/awLessonStatus/);
 assert.match(ui,/lookupPrivateLessons\(\)/);
});
test("only school admin fetches lookup; requests student-scoped or month-scoped data",()=>{
 assert.match(ui,/if\(!studentId\)/);
 assert.match(ui,/if\(state.me\?\.role!=="admin"\|\|!studentId\)return/);
 assert.match(ui,/encodeURIComponent\(studentId\)/);
 assert.match(ui,/encodeURIComponent\(privateLookup.month\)/);
 assert.match(api,/if\(a.role==="admin"\)ids=\[requested\]/);
 assert.match(api,/rowsForStudent\(id,start,end,schoolId\)/);
});
test("admin-only audit data can show previous schedule and does not expose it to teachers or parents",()=>{
 assert.match(api,/if\(a.role==="admin"\)\{/);
 assert.match(api,/item.scheduleHistory=/);
 assert.match(ui,/x.scheduleHistory/);
 assert.match(ui,/scheduleHistory/);
 assert.match(ui,/預約編號/);
 assert.match(ui,/teacherName/);
 assert.doesNotMatch(ui,/method:"PATCH"|method:"POST"/);
});

test("student dropdown reads canonical school administrator student master, not stale state.students",()=>{
 assert.match(ui,/Array\.isArray\(state\.master\)/);
 assert.match(ui,/api\("\/api\/student-master"\)/);
 assert.match(ui,/x\.name\|\|x\.studentName\|\|id/);
 assert.match(ui,/data-lookup-roster-retry/);
 assert.match(ui,/privateLookup\.rosterError/);
 assert.match(ui,/privateLookup\.rosterLoading/);
 assert.match(ui,/privateLookup\.rosterLoaded=true/);
});
