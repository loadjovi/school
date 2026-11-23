import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const assist=readFileSync(new URL("../app/admin-attendance-assist.js",import.meta.url),"utf8");
const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
const report=readFileSync(new URL("../app/attendance-support.js",import.meta.url),"utf8");
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
 assert.match(workspace,/加練／訓練點名/);
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

function attendanceReportHarness({role="admin",data=null,workspaceAvailable=true}={}){
 const calls=[],state={page:"attendance",me:{role},adminWorkspaceSection:"attendance",adminAttendanceWorkspaceTask:"followup",attendanceMonth:"2026-10",attendanceGroup:"A",attendanceSearch:"測試",attendanceView:"absent",attendancePageNum:2,attendancePageSize:15,attendanceData:data};
 const context={state,calls,esc:String,scopedAttendanceItems:()=>[],filteredItems:()=>[],aggregateStats:()=>({total:0,attended:0,rate:null,leave:0,absent:0,late:0}),rateBadge:()=>"",inScope:()=>state.page==="admin",organize:()=>calls.push(["organize",state.adminAttendanceWorkspaceTask]),requestAnimationFrame:fn=>fn(),document:{querySelector:selector=>({scrollIntoView:()=>calls.push(["scroll",selector])}),addEventListener:(type,handler)=>{if(type==="click")context.reportEntry=handler}}};
 context.window=context;
 context.openSchoolAdminWorkspace=async section=>{calls.push(["workspace",section]);state.page="admin";state.adminWorkspaceSection=section};
 if(workspaceAvailable){
  const start=workspace.indexOf(" window.openSchoolAdminAttendanceTask=async"),end=workspace.indexOf(" document.addEventListener('click',async e=>{",start);
  runInNewContext(workspace.slice(start,end),context);
 }
 const start=report.indexOf("  function attendancePage(){"),end=report.indexOf("  const baseNav=nav;",start);
 const html=runInNewContext(report.slice(start,end)+";attendancePage()",context);
 return {state,calls,context,html};
}
test("administrator report returns to the attendance task menu during loading or after a monthly query without losing filters",async()=>{
 for(const data of [null,{items:[]}]){
  const h=attendanceReportHarness({data});
  assert.equal((h.html.match(/← 返回出勤工作選單/g)||[]).length,1);
  const action=h.html.match(/class="secondary aw-attendance-back" onclick="([^"]+)"/)[1];
  const filters=[h.state.attendanceMonth,h.state.attendanceGroup,h.state.attendanceSearch,h.state.attendanceView,h.state.attendancePageNum];
  await runInNewContext(action,h.context);
  assert.equal(h.state.page,"admin");assert.equal(h.state.adminWorkspaceSection,"attendance");assert.equal(h.state.adminAttendanceWorkspaceTask,"home");
  assert.deepEqual(h.calls[0],["workspace","attendance"]);
  assert.ok(h.calls.some(([kind,task])=>kind==="organize"&&task==="home"));
  assert.ok(h.calls.some(([kind,selector])=>kind==="scroll"&&selector===".aw-attendance-task-picker"));
  assert.deepEqual([h.state.attendanceMonth,h.state.attendanceGroup,h.state.attendanceSearch,h.state.attendanceView,h.state.attendancePageNum],filters);
  // Re-enter through the actual four-card action after returning to its menu.
  h.context.groups={};h.context.desktopNavigate=async page=>{h.calls.push(["desktop",page]);h.state.page=page};
  h.context.toast=message=>assert.fail(message);
  const start=workspace.indexOf(" document.addEventListener('click',async e=>{\n  const button=e.target.closest?.('[data-workspace-group]"),end=workspace.indexOf(" window.closeInlineTeacherAdmin=",start);
  runInNewContext(workspace.slice(start,end),h.context);
  await h.context.reportEntry({preventDefault(){},target:{closest:()=>({dataset:{workspaceAction:"attendanceTable"},hasAttribute:()=>false})}});
  assert.equal(h.state.page,"attendance");assert.deepEqual(h.calls.at(-1),["desktop","attendance"]);
  assert.deepEqual([h.state.attendanceMonth,h.state.attendanceGroup,h.state.attendanceSearch,h.state.attendanceView,h.state.attendancePageNum],filters);
  assert.match(runInNewContext("attendancePage()",h.context),/返回出勤工作選單/);
 }
});
test("legacy teacher reports and reports without the administrator workspace keep their existing navigation",()=>{
 for(const options of [{role:"teacher"},{role:"admin",workspaceAvailable:false}]){
  const h=attendanceReportHarness(options);assert.doesNotMatch(h.html,/返回出勤工作選單/);
 }
});
