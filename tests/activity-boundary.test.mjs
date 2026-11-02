import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const workspace=read("../app/school-admin-workspace.js");
const calendar=read("../app/special-calendar.js");
const activityHtml=read("../app/uniform-event-admin.html");
const activityJs=read("../app/uniform-event-admin.js");
const calendarApi=read("../api/src/functions/calendarEvents.js");
const attendanceApi=read("../api/src/functions/trainingAttendance.js");
const tenantManagement=read("../api/src/functions/tenantManagement.js");
const uniformConfigApi=read("../api/src/functions/uniformEventConfig.js");
const trainingTypes=read("../api/src/lib/trainingEventTypes.js");

test("course workspace explains the training and event boundary",()=>{
  assert.match(workspace,/這裡只管理課程與訓練/);
  assert.match(workspace,/演出日期、比賽當天、快閃、校際交流與聯演/);
  assert.match(workspace,/團服與活動 → 活動設定/);
});

test("calendar creation only offers multi-day training course types",()=>{
  const form=calendar.slice(calendar.indexOf("const addCard"),calendar.indexOf("const trainingRow"));
  for(const type of ["competition_training","winter_training","summer_training","intensive_training"]){
    assert.match(form,new RegExp(`value="${type}"`));
  }
  for(const type of ["performance","competition","exchange","general"]){
    assert.doesNotMatch(form,new RegExp(`<option value="${type}"`));
  }
  assert.match(form,/上課日期（可一次輸入多天）/);
});

test("activity settings owns performances, competition days, flash events and exchanges",()=>{
  for(const label of ["演出日期","市賽／全國賽當天","快閃","他校交流","多校聯演"]){
    assert.match(activityHtml,new RegExp(label));
  }
  assert.match(activityHtml,/value="exchange">他校交流/);
  assert.match(activityHtml,/比賽加練、寒訓、暑訓等需要上課的安排/);
  assert.match(activityJs,/訓練課程請回到「課表與行事曆」/);
});

test("backend rejects direct event creation outside training course types",()=>{
  for(const type of ["competition_training","winter_training","summer_training","intensive_training"]){
    assert.match(trainingTypes,new RegExp(`"${type}"`));
  }
  assert.match(calendarApi,/if\(!isTrainingEventType\(x\.eventType\)\)return json/);
  assert.match(calendarApi,/演出、比賽當天、快閃與交流請至「團服與活動 → 活動設定」/);
});

test("all training types support attendance and confirmed teacher hours",()=>{
  assert.match(attendanceApi,/isTrainingEventType\(e\.eventType\)/);
  assert.match(tenantManagement,/isTrainingEventType\(e\.eventType\)/);
  assert.match(calendarApi,/只有訓練課程可認列老師工時/);
});

test("activity configuration accepts school exchanges",()=>{
  assert.match(uniformConfigApi,/"exchange"/);
});
