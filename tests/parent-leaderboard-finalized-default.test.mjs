import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../app/parent-home-summary.js",import.meta.url),"utf8");
const index=readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
const guard=readFileSync(new URL("../app/webview-guard.js",import.meta.url),"utf8");
const begin=source.indexOf("  function leaderboardMonthlyDetail(data){");
const end=source.indexOf("  function parentMonthlyScoreCard(){",begin);
assert.ok(begin>=0&&end>begin,"Monthly TOP 5 UI section exists");
const code=source.slice(begin,end);
function setup({month="2026-11",includeRows=true,selectedMonth="",summaryDays=1,summaryMinutes=20,asOf="2026-11-01",mineScore=0.33}={}){
 const studentId="student1",activeMonth="2026-11";
 const state={student:{studentId},
   summary:{month:activeMonth,practiceQualifiedDays:summaryDays,practiceMinutes:summaryMinutes},
   parentPracticeLeaderboardMonth:selectedMonth,parentPracticeLeaderboardMode:"monthly",
   parentPracticeLeaderboardDataMode:"monthly|"+selectedMonth,
   parentPracticeLeaderboardLoadedAt:Date.now(),
   parentPracticeLeaderboardLoading:false,
   parentPracticeLeaderboardStudentId:studentId,parentPracticeLeaderboardError:"",
   parentPracticeLeaderboard:{
     mode:"monthly",asOf,selectedMonth:month,availableMonths:["2026-10","2026-11"],
     includedMonths:[month],targetDays:30,qualifiedMinutes:20,participantCount:includeRows?2:0,
     items:includeRows?[
       {rank:1,name:"林○○",score10:mineScore,qualifiedDays:1,minutes:20,isMine:true},
       {rank:2,name:"游○○",score10:0,qualifiedDays:0,minutes:15,isMine:false}
     ]:[],
     mine:includeRows?{rank:1,score10:mineScore,qualifiedDays:1,minutes:20,
       monthlyDetails:[{month,qualifiedDays:1,targetDays:30,score10:mineScore,provisional:month===activeMonth}]}:null
   }
 };
 const ctx={state,Date,localDate:()=>asOf,shortDate:x=>x,esc:x=>String(x??""),
   setTimeout:()=>{throw Error("No polling when same-day cached ranking is valid")}};
 vm.createContext(ctx);
 vm.runInContext(code+"\nthis.view=parentPracticeLeaderboardCard;this.audit=leaderboardMonthlyDetail",ctx);
 return {state,ctx,html:ctx.view()};
}
test("11/1 first view is November TOP 5, not previous October ranking",()=>{
 const {html}=setup();
 assert.match(html,/自主練習分數 TOP 5/);
 assert.match(html,/11 月｜本月進行中/);
 assert.match(html,/11 月有效練習 1 \/ 30 天/);
 assert.match(html,/累計 20 分鐘/);
 assert.match(html,/累計 15 分鐘/);
 assert.match(html,/天數相同時，再比較本月累計練習分鐘/);
 assert.match(html,/0\.33\/10/);
 assert.doesNotMatch(html,/10、11月平均|10 月練習成果｜已結束月份|8\.5\/10/);
});
test("October is only selected for past-month lookup and never averaged with November",()=>{
 const {html}=setup({month:"2026-10",selectedMonth:"2026-10",mineScore:0.33});
 assert.match(html,/10 月｜歷史月份/);
 assert.match(html,/10 月有效練習 1 \/ 30 天/);
 assert.match(html,/10 月（歷史紀錄）/);
 assert.match(html,/11 月（進行中）/);
 assert.match(html,/只比較選定的單一月份/);
});
test("monthly score formula is visible and uses a fixed target rather than day-one full scores",()=>{
 const {html}=setup();
 assert.match(html,/分數怎麼算？/);
 assert.match(html,/每天累計滿 20 分鐘算 1 天/);
 assert.match(html,/本月有效日 ÷ 30 天 × 10＝本月分數/);
 assert.match(html,/11\/1 首次達標 1 天＝0\.33\/10/);
 assert.match(html,/<details class="practice-leaderboard-audit"/);
 assert.match(html,/1 個有效練習日 ÷ 30 天 × 10/);
 assert.match(html,/本月累計練習：<b>20 分鐘<\/b>/);
 assert.doesNotMatch(html,/本月分數\s*10\/10/);
});
test("fresh November before any student has practiced shows a welcoming empty state, not October data",()=>{
 const {html}=setup({includeRows:false,summaryDays:0,summaryMinutes:0});
 assert.match(html,/新的月份開始了！目前尚無練習紀錄/);
 assert.match(html,/不與其他月份混算/);
 assert.doesNotMatch(html,/practice-leaderboard-item/);
});
test("classmate monthly details are never exposed, and failed loading does not fabricate zero scores",()=>{
 const {html}=setup();
 assert.match(html,/其他學生姓名僅顯示遮蔽資料/);
 assert.doesNotMatch(html,/studentId|teacherEmail|createdBy|partitionKey/);
 const x=setup({includeRows:false});x.state.parentPracticeLeaderboardError="讀取失敗";
 assert.match(x.ctx.view(),/排行榜暫時無法取得/);
});
test("monthly fetch uses only the selected historical month; earlier response is not reused",()=>{
 assert.match(source,/parentPracticeLeaderboardMonth=""/);
 assert.match(source,/&mode="\+mode\+\(month\?"&month="/);
 assert.match(source,/parentPracticeLeaderboardDataMode=key/);
 assert.match(source,/parentPracticeLeaderboardMonth===month/);
 assert.match(source,/window\.setParentPracticeLeaderboardMonth=function\(value\)/);
 assert.doesNotMatch(code,/setParentPracticeLeaderboardMode/);
});
test("leaderboard minute UI assets are cache-busted",()=>{
 assert.match(index,/styles\.css\?v=20261104-practice-filter-anchor/);
  assert.match(index,/webview-guard\.js\?v=20261107-line-settings-group/);
 assert.match(guard,/parent-home-summary\.js\?v=20261103-tshirt-size-reminder/);
});
