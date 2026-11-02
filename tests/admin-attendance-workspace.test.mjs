import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const assist=readFileSync(new URL("../app/admin-attendance-assist.js",import.meta.url),"utf8");
const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
test("administrative attendance supports simplified admin workspace as well as legacy attendance route",()=>{
 assert.match(assist,/state\.page==="admin"&&state\.adminWorkspaceSection==="attendance"/);
 assert.match(assist,/state\.page!=="attendance"&&!workspace/);
 assert.match(assist,/window\.mountAdminAttendanceAssist=function/);
 assert.match(workspace,/group==='attendance'&&attendanceTask==='regular'&&typeof window\.mountAdminAttendanceAssist==='function'/);
});
test("school-admin attendance uses existing same-record API and does not create separate history",()=>{
 assert.match(assist,/\/api\/section-attendance/);
 assert.match(assist,/window\.adminAssistSave/);
 assert.match(assist,/await api\(postUrl\(\),\{method:"POST"/);
 assert.match(assist,/幹部代點名/);
});
test("attendance opens with four plain-language work choices and hides unrelated detail",()=>{
 assert.match(workspace,/一般課程代點名/);
 assert.match(workspace,/週六加練點名/);
 assert.match(workspace,/請假／缺席追蹤/);
 assert.match(workspace,/查詢／修正紀錄/);
 assert.match(workspace,/state\.adminAttendanceWorkspaceTask=task/);
 assert.match(workspace,/attendanceTask==='regular'/);
 assert.match(workspace,/attendanceTask==='followup'/);
 assert.match(assist,/aw-attendance-assist-slot/);
});
test("general course proxy attendance explains the three required steps",()=>{
 assert.match(assist,/選課程/);
 assert.match(assist,/載入學生/);
 assert.match(assist,/儲存完成/);
 assert.match(assist,/載入學生名單，開始點名/);
 assert.match(assist,/儲存並完成一般課程點名/);
});
