import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const workspace=readFileSync(new URL("../app/student-admin-workspace.js",import.meta.url),"utf8");
const app=readFileSync(new URL("../app/app-v3.js",import.meta.url),"utf8");
const studentChange=readFileSync(new URL("../app/student-change-admin.js",import.meta.url),"utf8");
const roster=readFileSync(new URL("../app/roster-import.js",import.meta.url),"utf8");
const upgrade=readFileSync(new URL("../app/batch-upgrade.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/student-master-compact.css",import.meta.url),"utf8");
const guard=readFileSync(new URL("../app/webview-guard.js",import.meta.url),"utf8");

test("student admin workspace JavaScript parses",()=>{
  new vm.Script(workspace,{filename:"student-admin-workspace.js"});
});

test("student management opens with four plain-language work choices",()=>{
  assert.match(workspace,/查詢／修改學生/);
  assert.match(workspace,/新增單一學生/);
  assert.match(workspace,/匯入學期名單/);
  assert.match(workspace,/學年度批次升級/);
  assert.match(workspace,/state\.adminStudentWorkspaceTask=task/);
  assert.match(workspace,/返回學生管理選單/);
});

test("only the selected student task panel is displayed",()=>{
  assert.match(app,/data-student-task-panel="browse"/);
  assert.match(studentChange,/data-student-task-panel="add"/);
  assert.match(roster,/data-student-task-panel="import"/);
  assert.match(upgrade,/data-student-task-panel="upgrade"/);
  assert.match(css,/data-student-workspace-task="browse"/);
  assert.match(css,/data-student-workspace-task="upgrade"/);
});

test("student lookup supports name or student number search",()=>{
  assert.match(app,/studentMasterQuery/);
  assert.match(app,/runStudentMasterSearch/);
  assert.match(app,/姓名或學號/);
  assert.match(app,/找不到符合條件的學生/);
});

test("student workflow module is cache-busted and loaded after other admin modules",()=>{
  assert.match(guard,/student-admin-workspace\.js\?v=20261102-student-workflow/);
  assert.match(guard,/app-v3\.js\?v=20261102-student-workflow/);
});
