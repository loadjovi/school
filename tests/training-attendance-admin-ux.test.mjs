import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const attendance=readFileSync(new URL("../app/training-attendance.js",import.meta.url),"utf8");
const calendar=readFileSync(new URL("../app/special-calendar.js",import.meta.url),"utf8");
const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
const backend=readFileSync(new URL("../api/src/functions/trainingAttendance.js",import.meta.url),"utf8");

test("attendance workspace offers a direct, three-step rehearsal roll-call entry",()=>{
  assert.match(workspace,/data-workspace-action="trainingAttendance"/);
  assert.match(workspace,/週六加練點名/);
  assert.match(workspace,/選加練/);
  assert.match(workspace,/標記狀態/);
  assert.match(workspace,/儲存完成/);
});

test("admin rehearsal attendance returns to the attendance workspace",()=>{
  assert.match(attendance,/adminAttendanceWorkspace/);
  assert.match(attendance,/state\.adminWorkspaceSection="attendance"/);
  assert.match(attendance,/返回出勤與請假/);
});

test("roll call makes progress and final server-confirmed save explicit",()=>{
  assert.match(attendance,/選擇加練/);
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

test("UI still writes the existing tenant-isolated rehearsal attendance record",()=>{
  assert.match(attendance,/api\("\/api\/training-attendance",\{method:"POST"/);
  assert.match(backend,/tenantTrainingAttendance/);
  assert.match(backend,/if\(access\.role==="admin"\)return true/);
  assert.match(backend,/items\.length!==expected\.size/);
});
