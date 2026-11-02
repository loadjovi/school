import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const calendar=readFileSync(new URL("../app/special-calendar.js",import.meta.url),"utf8");

test("training type and group provide a friendly suggested course name",()=>{
  assert.match(calendar,/winter_training:"寒訓"/);
  assert.match(calendar,/summer_training:"暑訓"/);
  assert.match(calendar,/trainingGroupName/);
  assert.match(calendar,/syncTrainingCourseDefaults/);
  assert.match(calendar,/data-auto-title="true"/);
  assert.match(calendar,/已保留自訂名稱/);
});

test("training location uses classroom choices and supports a custom location",()=>{
  for(const room of ["聖家樓四樓團練教室","聖家樓四樓 A 團練教室","聖家樓四樓 B 團練教室","音樂教室 1","音樂教室 2"]){
    assert.match(calendar,new RegExp(room));
  }
  assert.match(calendar,/id="calLocation"/);
  assert.match(calendar,/其他地點（自行輸入）/);
  assert.match(calendar,/locationChoice==="__other__"/);
  assert.match(calendar,/請輸入其他上課地點/);
});
