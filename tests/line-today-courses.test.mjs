import test from "node:test";
import assert from "node:assert/strict";
import {formatLineTodayCourses,isTodayCoursesCommand} from "../api/src/lib/lineTodayCoursesFormat.mjs";

test("rich-menu command accepts only the private today-course query",()=>{
  assert.equal(isTodayCoursesCommand("今日課程"),true);
  assert.equal(isTodayCoursesCommand("#今日課程"),true);
  assert.equal(isTodayCoursesCommand("查看今日課程"),false);
});

test("today-course reply combines fixed, training and private lessons",()=>{
  const text=formatLineTodayCourses({date:"2026-11-15",students:[{
    student:{name:"測試同學",groupName:"A"},
    schedules:[{courseType:"section",courseName:"A團分部課",startTime:"17:40",endTime:"18:30",location:"音樂教室"}],
    training:[{title:"A團比賽加練",startTime:"09:00",endTime:"11:00",location:"團練教室"}],
    privateLessons:[{startTime:"19:00",endTime:"20:00",teacherName:"王老師",status:"scheduled"}]
  }]});
  assert.match(text,/今日課程/);
  assert.match(text,/測試同學｜A團/);
  assert.match(text,/A團分部課/);
  assert.match(text,/A團比賽加練/);
  assert.match(text,/個別課｜王老師/);
});

test("student with no scheduled lesson receives an explicit no-course reply",()=>{
  const text=formatLineTodayCourses({date:"2026-11-15",students:[{student:{name:"測試同學",groupName:"B"}}]});
  assert.match(text,/今天沒有已安排的課程/);
});
