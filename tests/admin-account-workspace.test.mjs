import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/school-admin-workspace.css",import.meta.url),"utf8");
const index=readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
const guard=readFileSync(new URL("../app/webview-guard.js",import.meta.url),"utf8");

test("account workspace JavaScript parses",()=>{
  new vm.Script(workspace,{filename:"school-admin-workspace.js"});
});

test("account management begins with four plain-language jobs",()=>{
  for(const task of ["pending","families","teachers","school"]){
    assert.match(workspace,new RegExp(`data-account-work=\\"${task}\\"`));
  }
  for(const label of ["家長申請審核","家長綁定查詢／修正","老師帳號","校方查詢帳號"]){
    assert.match(workspace,new RegExp(label));
  }
  assert.match(workspace,/先選擇帳號類型，畫面只會顯示該項工作的資料/);
});

test("selected account work hides unrelated panels and provides a return path",()=>{
  assert.match(workspace,/state\.adminAccountWorkspaceTask='home'/);
  assert.match(workspace,/accountTask!=='pending'/);
  assert.match(workspace,/accountTask!=='school'/);
  assert.match(workspace,/accountTask!=='families'/);
  assert.match(workspace,/accountTask==='teachers'/);
  assert.match(workspace,/data-account-work="home">← 返回帳號工作選單/);
  assert.match(workspace,/dataset\.adminTodo==='parents'[\s\S]*adminAccountWorkspaceTask='pending'/);
  assert.match(workspace,/correctionCard&&correctionCard\.parentElement!==familySlot/);
  assert.match(workspace,/activeStudentIds\.has\(id\)/);
});

test("account jobs explain three steps and stay mobile friendly",()=>{
  assert.match(workspace,/核對申請','選擇學生','核准或退回/);
  assert.match(workspace,/新增或找到老師','設定帳號類型','儲存資料/);
  assert.match(css,/\.aw-account-task-grid/);
  assert.match(css,/@media\(max-width:600px\)\{\.aw-account-task-picker[\s\S]*?\.aw-account-task-grid\{grid-template-columns:1fr/);
  assert.match(css,/\.aw-account-steps/);
});

test("account workflow assets are cache-busted",()=>{
  assert.match(index,/styles\.css\?v=20261104-practice-filter-anchor/);
  assert.match(index,/school-admin-workspace\.css\?v=20261102-learning-workspace/);
  assert.match(index,/webview-guard\.js\?v=20261104-practice-filter-anchor/);
  assert.match(guard,/school-admin-workspace\.js\?v=20261102-learning-workspace/);
});
