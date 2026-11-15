import test from "node:test";
import assert from "node:assert/strict";
import {formatLineActivityCalendar,isActivityCalendarCommand,uniqueActivityEvents} from "../api/src/lib/lineActivityCalendarFormat.mjs";

test("activity calendar command is exact",()=>{
  assert.equal(isActivityCalendarCommand("活動行事曆"),true);
  assert.equal(isActivityCalendarCommand("#活動行事曆"),true);
  assert.equal(isActivityCalendarCommand("查看活動行事曆"),false);
});

test("activity calendar filters duplicates, sorts, and formats upcoming events",()=>{
  const events=uniqueActivityEvents([
    {schoolId:"s",eventDate:"2026-11-22",title:"弦樂團演出",startTime:"14:00",location:"音樂廳"},
    {schoolId:"s",eventDate:"2026-11-18",title:"A團加練",startTime:"09:00",endTime:"11:00"},
    {schoolId:"s",eventDate:"2026-11-18",title:"A團加練",startTime:"09:00",endTime:"11:00"}
  ]);
  assert.equal(events.length,2);
  const text=formatLineActivityCalendar({fromDate:"2026-11-15",toDate:"2026-12-15",groups:["A","A"],events});
  assert.match(text,/活動行事曆｜A團/);
  assert.ok(text.indexOf("A團加練")<text.indexOf("弦樂團演出"));
  assert.match(text,/📍 音樂廳/);
});

test("activity calendar gives explicit empty result",()=>{
  const text=formatLineActivityCalendar({fromDate:"2026-11-15",toDate:"2026-12-15",groups:["B"],events:[]});
  assert.match(text,/未來 30 天沒有/);
  assert.match(text,/B團/);
});
