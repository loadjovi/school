import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const assist=readFileSync(new URL("../app/admin-attendance-assist.js",import.meta.url),"utf8");
const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
test("administrative attendance supports simplified admin workspace as well as legacy attendance route",()=>{
 assert.match(assist,/state\.page==="admin"&&state\.adminWorkspaceSection==="attendance"/);
 assert.match(assist,/state\.page!=="attendance"&&!workspace/);
 assert.match(assist,/window\.mountAdminAttendanceAssist=function/);
 assert.match(workspace,/group==='attendance'&&typeof window\.mountAdminAttendanceAssist==='function'/);
});
test("school-admin attendance uses existing same-record API and does not create separate history",()=>{
 assert.match(assist,/\/api\/section-attendance/);
 assert.match(assist,/window\.adminAssistSave/);
 assert.match(assist,/await api\(postUrl\(\),\{method:"POST"/);
 assert.match(assist,/行政協助點名/);
});
