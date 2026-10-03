import test from "node:test";
import assert from "node:assert/strict";
import { buildPracticeLeaderboard, latestLeaderboardFeedback, practiceScoreMonths } from "../src/lib/practiceLeaderboard.js";

const student=(studentId,name,aliases=[studentId])=>({studentId,name,aliases,safeParentEmails:[]});
const row=(id,date,minutes,start="18:00",rowKey=`${id}-${date}-${start}`)=>({
  studentId:id,rowKey,eventDate:date,startTime:start,endTime:"18:30",minutes,qualified:minutes>=15,createdAt:`${date}T12:00:00Z`
});

test("official fall leaderboard excludes September, deduplicates an old ID and uses elapsed days",()=>{
  const months=practiceScoreMonths("2026-10-03");
  const first=row("old-1","2026-10-01",16),copy={...first,studentId:"s1",rowKey:"migrated-copy"};
  const result=buildPracticeLeaderboard({
    students:[student("s1","王小明",["s1","old-1"]),student("s2","陳小華")],
    rows:[row("s1","2026-09-30",90),first,copy,row("s1","2026-10-01",4,"19:00"),row("s1","2026-10-02",20),row("s2","2026-10-01",15)],
    months,today:"2026-10-03",studentId:"s2"
  });
  assert.deepEqual(months,["2026-10","2026-11","2026-12"]);
  assert.deepEqual(result.includedMonths,["2026-10"]);
  assert.equal(result.items[0].score10,6.67);
  assert.equal(result.items[0].minutes,40);
  assert.equal(result.items[0].name,"王○○");
  assert.equal(result.items[1].name,"陳小華");
  assert.equal(result.items[1].score10,0);
  assert.equal(result.items[1].isMine,true);
});

test("ranking averages elapsed formal months and keeps a child's rank outside the top five",()=>{
  const students=Array.from({length:6},(_,i)=>student(`s${i+1}`,`學生${i+1}`));
  const rows=students.flatMap((s,i)=>Array.from({length:6-i},(_,j)=>row(s.studentId,`2026-10-${String(j+1).padStart(2,"0")}`,20)));
  const result=buildPracticeLeaderboard({students,rows,months:practiceScoreMonths("2026-11-03"),today:"2026-11-03",studentId:"s6"});
  assert.deepEqual(result.includedMonths,["2026-10","2026-11"]);
  assert.equal(result.items.length,5);
  assert.equal(result.items[0].score10,1);
  assert.equal(result.mine.rank,6);
  assert.equal(result.mine.score10,0.17);
  assert.equal(result.items.every(x=>!x.isMine),true);
  assert.equal(result.items.every(x=>!Object.hasOwn(x,"studentId")),true);
});

test("September trial has no official ranking; January shows completed October–December",()=>{
  const months=practiceScoreMonths("2026-09-30");
  const trial=buildPracticeLeaderboard({students:[student("s1","林同學")],rows:[row("s1","2026-09-29",30)],months,today:"2026-09-30",studentId:"s1"});
  assert.equal(trial.participantCount,0);
  assert.deepEqual(trial.items,[]);
  assert.deepEqual(practiceScoreMonths("2027-01-01"),["2026-10","2026-11","2026-12"]);
});

test("latest monthly teacher encouragement is shown without affecting score or exposing the comment",()=>{
  const students=[student("s1","王小明",["s1","old-1"]),student("s2","陳小華")];
  const feedbackRows=[
    {studentId:"old-1",level:2,feedbackDate:"2026-10-01",updatedAt:"2026-10-01T09:00:00Z",comment:"私下鼓勵",teacherEmail:"teacher@example.com"},
    {studentId:"s1",level:4,feedbackDate:"2026-10-02",updatedAt:"2026-10-02T09:00:00Z",comment:"最新私訊",teacherEmail:"teacher@example.com"},
    {studentId:"unknown",level:5,feedbackDate:"2026-10-03",updatedAt:"2026-10-03T09:00:00Z"}
  ];
  const feedbackByStudentId=latestLeaderboardFeedback(students,feedbackRows);
  const result=buildPracticeLeaderboard({students,rows:[row("s1","2026-10-01",20),row("s2","2026-10-01",20)],months:practiceScoreMonths("2026-10-03"),today:"2026-10-03",studentId:"s2",feedbackByStudentId});
  assert.deepEqual(result.items[0].feedback,{level:4,date:"2026-10-02"});
  assert.equal(result.items[1].feedback,null);
  assert.equal(result.items[0].score10,result.items[1].score10);
  assert.doesNotMatch(JSON.stringify(result),/私訊|私下鼓勵|teacher@example.com/);
});
