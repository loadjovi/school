import test from "node:test";
import assert from "node:assert/strict";
import { groupPracticeRows, practiceDayTotals, practiceSessionId, qualifiedPracticeDates, uniquePracticeRows, PRACTICE_QUALIFIED_MINUTES } from "../src/lib/practiceRecords.js";

const first={partitionKey:"school|student|s1",rowKey:"p_old",eventDate:"2026-09-29",startTime:"22:24",endTime:"22:57",minutes:33,createdAt:"2026-09-29T14:57:01Z"};
const repeated={...first,rowKey:"p_again",createdAt:"2026-09-29T14:57:03Z"};

test("same student and time keeps the earliest record and exposes the extra record for cleanup",()=>{
  const grouped=groupPracticeRows([repeated,first]);
  assert.equal(grouped.length,1);
  assert.equal(grouped[0].record.rowKey,"p_old");
  assert.deepEqual(grouped[0].duplicates.map(x=>x.rowKey),["p_again"]);
  assert.equal(uniquePracticeRows([first,repeated]).reduce((minutes,x)=>minutes+x.minutes,0),33);
});

test("separate practice sessions, including another session on the same day, remain separate",()=>{
  const later={...first,rowKey:"p_later",startTime:"23:10",endTime:"23:30"};
  const nextDay={...first,rowKey:"p_next",eventDate:"2026-09-30"};
  assert.equal(uniquePracticeRows([first,later,nextDay]).length,3);
});

test("a migrated copy under an old student ID is also recognized as the same session",()=>{
  const copy={...first,partitionKey:"school|student|old-id",rowKey:first.rowKey};
  const grouped=groupPracticeRows([first,copy]);
  assert.equal(grouped.length,1);
  assert.equal(grouped[0].duplicates.length,1);
  assert.notEqual(grouped[0].duplicates[0].partitionKey,grouped[0].record.partitionKey);
});

test("concurrent submissions for the same session use one storage key",()=>{
  assert.equal(practiceSessionId("sacred-heart","s1",first),practiceSessionId("sacred-heart","s1",repeated));
  assert.notEqual(practiceSessionId("sacred-heart","s1",first),practiceSessionId("sacred-heart","s2",first));
});

test("daily 20-minute threshold combines distinct sessions but ignores old 15-minute flags and duplicate copies",()=>{
  const first={...firstRow("2026-10-01","18:00",12),qualified:true};
  const second=firstRow("2026-10-01","19:00",8);
  const duplicate={...first,rowKey:"duplicate",createdAt:"2026-10-01T12:01:00Z"};
  const legacy={...firstRow("2026-10-02","18:00",15),qualified:true};
  const almost=firstRow("2026-10-02","19:00",4);
  assert.equal(PRACTICE_QUALIFIED_MINUTES,20);
  assert.equal(practiceDayTotals([first,second,duplicate,legacy,almost]).get("2026-10-01"),20);
  assert.equal(practiceDayTotals([legacy,almost]).get("2026-10-02"),19);
  assert.deepEqual([...qualifiedPracticeDates([first,second,duplicate,legacy,almost])],["2026-10-01"]);
  assert.equal(qualifiedPracticeDates([first,duplicate,legacy,almost]).size,0);
});

function firstRow(date,startTime,minutes){return {partitionKey:"school|student|s1",rowKey:`${date}-${startTime}`,eventDate:date,startTime,endTime:"19:30",minutes,createdAt:`${date}T12:00:00Z`}}
