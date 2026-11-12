import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {sortTrainingRoster} from "../api/src/lib/trainingRosterOrder.mjs";

const attendance=readFileSync(new URL("../app/training-attendance.js",import.meta.url),"utf8");
const calendar=readFileSync(new URL("../app/special-calendar.js",import.meta.url),"utf8");
const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
const backend=readFileSync(new URL("../api/src/functions/trainingAttendance.js",import.meta.url),"utf8");

test("rehearsal roster follows section, grade, and student-name order",()=>{
  const rows=[
    {rowKey:"8",studentName:"大提甲",section:"大提",grade:"六年級"},
    {rowKey:"6",studentName:"小一六",section:"小提一部",grade:"六年級"},
    {rowKey:"4",studentName:"中提甲",section:"中提",grade:"四年級"},
    {rowKey:"5",studentName:"小二甲",section:"小提二部",grade:"五年級"},
    {rowKey:"2",studentName:"小一乙",section:"小提一部",grade:"四年級"},
    {rowKey:"1",studentName:"小一甲",section:"小提一部",grade:"四年級"},
    {rowKey:"9",studentName:"低音甲",section:"低音提",grade:"五年級"},
    {rowKey:"10",studentName:"待確認甲",section:"待確認",grade:"三年級"}
  ];

  assert.deepEqual(sortTrainingRoster(rows).map(x=>x.studentName),[
    "小一乙","小一甲","小一六","小二甲","中提甲","大提甲","低音甲","待確認甲"
  ]);
  assert.equal(rows[0].studentName,"大提甲","sorting must not mutate the student master list");
});

test("attendance workspace offers a direct rehearsal roll-call entry",()=>{
  assert.match(workspace,/data-workspace-action="trainingAttendance"/);
  assert.match(workspace,/加練／訓練點名/);
  assert.match(workspace,/比賽加練、寒訓、暑訓場次/);
});

test("admin rehearsal attendance returns to the attendance workspace",()=>{
  assert.match(attendance,/adminAttendanceWorkspace/);
  assert.match(attendance,/state\.adminWorkspaceSection="attendance"/);
  assert.match(attendance,/返回出勤與請假/);
});

test("roll call makes progress and final server-confirmed save explicit",()=>{
  assert.match(attendance,/選擇訓練/);
  assert.match(attendance,/先將全員設為出席/);
  assert.match(attendance,/已標記 \$\{count\}\/\$\{total\} 人/);
  assert.match(attendance,/儲存並完成點名/);
  assert.match(attendance,/只有出現伺服器確認訊息，才算點名完成/);
  assert.match(attendance,/posted\?\.ok!==true/);
  assert.match(attendance,/回讀的學生紀錄與送出內容不一致/);
});

test("teacher assignment and monthly hours are visually secondary to roll call",()=>{
  assert.match(calendar,/① 幹部點名/);
  assert.match(calendar,/管理員可直接代點名，不必先指定老師 Gmail/);
  assert.match(calendar,/指定點名老師（非必要）/);
  assert.match(calendar,/② 月底工時確認（非點名）/);
  assert.match(calendar,/這裡只計算老師工時，不會儲存學生出缺席/);
});

test("cancelled rehearsals never appear as pending attendance",()=>{
  assert.match(attendance,/d\.items\.filter\(x=>String\(x\.status\|\|"active"\)==="active"\)/);
  assert.match(backend,/String\(e\.status\|\|"active"\)!=="active"\|\|!mayTakeAttendance/);
  assert.match(calendar,/此場訓練已取消，不需點名/);
  const cancelledGuard=calendar.indexOf('if(x.status!=="active")');
  const startButton=calendar.indexOf('>開始點名<');
  assert.ok(cancelledGuard>0&&cancelledGuard<startButton,"cancelled guard must run before rendering the attendance button");
});

test("UI still writes the existing tenant-isolated rehearsal attendance record",()=>{
  assert.match(attendance,/api\("\/api\/training-attendance",\{method:"POST"/);
  assert.match(backend,/tenantTrainingAttendance/);
  assert.match(backend,/if\(access\.role==="admin"\)return true/);
  assert.match(backend,/items\.length!==expected\.size/);
});
