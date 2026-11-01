import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../app/parent-home-summary.js",import.meta.url),"utf8");
const start=source.indexOf("  function parentPracticeLeaderboardAudit(d){");
const end=source.indexOf("  function parentPracticeLeaderboardCard(){",start);
assert.ok(start>=0&&end>start,"monthly leaderboard audit must be present");
const segment=source.slice(start,end);
const ctx={esc:x=>String(x??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]))};
vm.createContext(ctx);vm.runInContext(segment+"\nthis.audit=parentPracticeLeaderboardAudit",ctx);
test("11/1 rank context explains the same 8.5 and 4.34 that users see",()=>{
 const d={asOf:"2026-11-01",includedMonths:["2026-10","2026-11"],qualifiedMinutes:20,targetDays:30,
  mine:{score10:8.5,monthlyDetails:[{month:"2026-10",qualifiedDays:21,targetDays:30,score10:7,provisional:false},
    {month:"2026-11",qualifiedDays:1,targetDays:1,score10:10,provisional:true}]}};
 const html=ctx.audit(d);
 assert.match(html,/8\.5\/10/);
 assert.match(html,/4\.34\/10/);
 assert.match(html,/21 \/ 30 天/);
 assert.match(html,/1 \/ 1 天/);
 assert.match(html,/不是學期結算成績/);
 assert.match(html,/進行中・暫估/);
 assert.match(html,/月份已結算/);
});
test("provisional leaderboard explanation remains generic without exposing other students' monthly data",()=>{
 const d={asOf:"2026-11-11",includedMonths:["2026-10","2026-11"],qualifiedMinutes:20,targetDays:30,mine:null};
 const html=ctx.audit(d);
 assert.match(html,/沒有可列入排名/);
 assert.match(html,/當月計分分母/);
 assert.doesNotMatch(html,/11\/1 範例/);
 assert.doesNotMatch(html,/studentId|partitionKey|createdBy/);
});
test("leaderboard shows provisional label and hides full breakdown from masked classmates",()=>{
 assert.match(source,/⚠️ 暫估排名（非學期結算）/);
 assert.match(source,/parentPracticeLeaderboardAudit\(d\)/);
 assert.match(source,/累計有效天數與總分鐘數不能直接推算跨月平均/);
});
