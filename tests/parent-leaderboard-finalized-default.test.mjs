import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../app/parent-home-summary.js",import.meta.url),"utf8");
const begin=source.indexOf("  function leaderboardMonthlyDetail(data){");
const end=source.indexOf("  function parentMonthlyScoreCard(){",begin);
assert.ok(begin>=0&&end>begin,"Parent encouragement board section should exist");
const code=source.slice(begin,end);
function setup({month="2026-10",mineScore=7,days=21,minutes=705,hasCompletedMonth=true,progressDays=1,progressMinutes=25}={}){
 const studentId="student1",months=hasCompletedMonth?[month]:[];
 const state={student:{studentId},summary:{month:"2026-11",practiceQualifiedDays:progressDays,practiceMinutes:progressMinutes},
   parentPracticeLeaderboardDataMode:"final",parentPracticeLeaderboardLoadedAt:Date.now(),
   parentPracticeLeaderboardLoading:false,parentPracticeLeaderboardStudentId:studentId,parentPracticeLeaderboardError:"",
   parentPracticeLeaderboard:{
      mode:"final",asOf:"2026-11-01",includedMonths:months,targetDays:30,qualifiedMinutes:20,
      participantCount:2,
      items:hasCompletedMonth?[
         {rank:1,name:"林○○",score10:8.67,qualifiedDays:26,minutes:951,isMine:false},
         {rank:2,name:"游○○",score10:mineScore,qualifiedDays:days,minutes,isMine:true}
      ]:[],
      mine:hasCompletedMonth?{rank:2,score10:mineScore,qualifiedDays:days,minutes,
        monthlyDetails:[{month,qualifiedDays:days,targetDays:30,score10:mineScore,provisional:false}]}:null
   }};
 const ctx={state,Date,localDate:()=>"2026-11-01",shortDate:x=>x,
   setTimeout:()=>{throw Error("Should not fetch if cached result still valid")},esc:x=>String(x??"")};
 vm.createContext(ctx);
 vm.runInContext(code+"\nthis.view=parentPracticeLeaderboardCard;this.audit=leaderboardMonthlyDetail;",ctx);
 return {html:ctx.view(),state};
}
test("single October encouragement board displays stable October counts, not November's volatile cross-month mean",()=>{
 const {html}=setup();
 assert.match(html,/自主練習鼓勵榜/);
 assert.match(html,/10 月練習成果｜已結束月份/);
 assert.match(html,/10 月有效練習 26 天/);
 assert.match(html,/10 月有效練習 21 天/);
 assert.match(html,/8\.67\/10/);
 assert.match(html,/7\/10/);
 assert.doesNotMatch(html,/4\.34\/10|8\.5\/10|10、11月平均/);
 assert.doesNotMatch(html,/setParentPracticeLeaderboardMode|當月暫估/);
});
test("homepage clearly separates the child's current month progress without ranking the new month",()=>{
 const {html}=setup({progressDays:1,progressMinutes:25});
 assert.match(html,/11 月｜我的練習進度/);
 assert.match(html,/1 天/);
 assert.match(html,/25 分鐘/);
 assert.match(html,/本月尚未結束，不參與上月鼓勵排名/);
 assert.match(html,/本榜單用於鼓勵，非學期正式成績/);
});
test("month score calculation is collapsed by default and includes only signed-in child's details",()=>{
 const {html}=setup();
 assert.match(html,/<details class="practice-leaderboard-audit"/);
 assert.match(html,/計算方式與我的孩子明細/);
 assert.match(html,/21 個有效練習日 ÷ 30 天 × 10/);
 assert.match(html,/主要鼓勵榜<strong>只比較最近已結束的單一月份/);
 assert.match(html,/其他學生僅顯示遮蔽姓名/);
 assert.doesNotMatch(html,/teacherEmail|createdBy|partitionKey/);
});
test("an unfinished month cannot appear as a fake finalized leaderboard",()=>{
 const {html}=setup({hasCompletedMonth:false,progressDays:4,progressMinutes:130});
 assert.match(html,/目前還沒有已結束的正式練習月份/);
 assert.doesNotMatch(html,/practice-leaderboard-item/);
 assert.match(html,/4 天/);
});
test("current month is not mistaken for zero progress when summary has not loaded",()=>{
 const {html,state}=setup();
 state.summary=null;
 const ctx={state,Date,localDate:()=>"2026-11-01",shortDate:x=>x,setTimeout:()=>{},esc:x=>String(x??"")};
 vm.createContext(ctx);vm.runInContext(code+"\nthis.view=parentPracticeLeaderboardCard;",ctx);
 assert.match(ctx.view(),/讀取中/);
 assert.doesNotMatch(ctx.view(),/<b>0 天<\/b>/);
});
test("API request remains explicitly finalized by default",()=>{
 assert.match(source,/parentPracticeLeaderboardMode="final"/);
 assert.match(source,/&mode="\+mode/);
 assert.match(source,/parentPracticeLeaderboardDataMode===mode/);
});
