import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
const schedule=readFileSync(new URL("../app/schedule-admin.js",import.meta.url),"utf8");
const calendar=readFileSync(new URL("../app/special-calendar.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/school-admin-workspace.css",import.meta.url),"utf8");
const index=readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
const guard=readFileSync(new URL("../app/webview-guard.js",import.meta.url),"utf8");

test("course management JavaScript parses",()=>{
  new vm.Script(workspace,{filename:"school-admin-workspace.js"});
  new vm.Script(schedule,{filename:"schedule-admin.js"});
  new vm.Script(calendar,{filename:"special-calendar.js"});
});

test("course workspace offers five task-first entries",()=>{
  for(const label of ["固定課表","停課／復課","單日分部併班","新增訓練課程","管理訓練行事曆"]){
    assert.match(workspace,new RegExp(label));
  }
  assert.match(workspace,/data-course-work="fixed"/);
  assert.match(workspace,/data-course-work="manageEvents"/);
  assert.match(workspace,/openScheduleAdmin\(task\)/);
  assert.match(workspace,/openSpecialCalendar\(task==='addEvent'\?'add':'manage'\)/);
  assert.match(css,/aw-course-task-grid/);
});

test("fixed schedule, exceptions and merge render as separate workflows",()=>{
  assert.match(schedule,/state\.scheduleAdminTask=state\.scheduleAdminTask\|\|"fixed"/);
  assert.match(schedule,/\["fixed","exceptions","merge"\]\.includes\(task\)/);
  assert.match(schedule,/if\(task==="merge"\)return heading\+sectionMergeCard\(\)/);
  assert.match(schedule,/if\(task==="exceptions"\)return heading\+scheduleList\+scheduleChangeForm\(\)\+exceptionHistory/);
  assert.match(schedule,/返回課表與行事曆/);
  assert.match(schedule,/state\.adminWorkspaceSection="courses"/);
});

test("training course creation and management are separate workflows",()=>{
  assert.match(calendar,/state\.specialCalendarTask=state\.specialCalendarTask\|\|"add"/);
  assert.match(calendar,/\["add","manage"\]\.includes\(task\)/);
  assert.match(calendar,/task==="manage"\?manageCard:addCard/);
  assert.match(calendar,/建立訓練課程/);
  assert.match(calendar,/可取消／恢復/);
  assert.match(calendar,/返回課表與行事曆/);
});

test("course workflow assets are cache-busted",()=>{
  assert.match(index,/schedule-admin\.js\?v=20261102-course-workflow/);
  assert.match(index,/special-calendar\.js\?v=20261102-training-form/);
  assert.match(index,/school-admin-workspace\.css\?v=20261102-learning-workspace/);
  assert.match(index,/webview-guard\.js\?v=20261104-practice-filter-anchor/);
  assert.match(guard,/school-admin-workspace\.js\?v=20261102-learning-workspace/);
});
