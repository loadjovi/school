import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../app/parent-home-summary.js",import.meta.url),"utf8");
const begin=source.indexOf("  function leaderboardMonthlyDetail(data){");
const end=source.indexOf("  function parentMonthlyScoreCard(){",begin);
assert.ok(begin>=0&&end>begin,"Parent leaderboard monthly breakdown and UI must exist");
const code=source.slice(begin,end);
function setup(mode,months,score10,details){
 const studentId="test-student";
 const state={student:{studentId},page:"home",me:{role:"parent"},parentPracticeLeaderboardMode:mode,parentPracticeLeaderboardDataMode:mode,parentPracticeLeaderboardLoadedAt:Date.now(),parentPracticeLeaderboardLoading:false,parentPracticeLeaderboardStudentId:studentId,parentPracticeLeaderboardError:"",parentPracticeLeaderboard:{
  asOf:"2026-11-01",includedMonths:months,targetDays:30,qualifiedMinutes:20,
  participantCount:2,items:[{rank:1,name:"示例同學",score10,qualifiedDays:21,minutes:700,isMine:true}],
  mine:{rank:1,name:"示例同學",score10,monthlyDetails:details}
 }};
 const ctx={state,window:{},feedbackLevels:[null,{icon:"🌱",label:"起步中"}],esc:x=>String(x??""),
    shortDate:x=>x,Date,setTimeout:()=>{throw Error("No polling when data valid")}};
 vm.createContext(ctx);
 vm.runInContext(code+"\nthis.view=parentPracticeLeaderboardCard;this.audit=leaderboardMonthlyDetail",ctx);
 return {state,ctx,html:ctx.view()};
}
test("main finalized screen emphasizes October and does not display November provisional in the principal score",()=>{
 const month=[{month:"2026-10",qualifiedDays:21,targetDays:30,score10:7,provisional:false}];
 const {html}=setup("final",["2026-10"],7,month);
 assert.match(html,/已結算鼓勵榜/);
 assert.match(html,/✅ 已結算排行/);
 assert.match(html,/📊 當月暫估/);
 assert.match(html,/11\/1 起以 10 月已結束月份排名/);
 assert.match(html,/7\/10/);
 assert.doesNotMatch(html,/8\.5\/10/);
 assert.match(html,/21 \/ 30 天/);
 assert.match(html,/不是永久鎖定|補正舊紀錄/);
});
test("optional provisional view warns about daily denominator changes and shows parent's own numerator",()=>{
 const details=[{month:"2026-10",qualifiedDays:21,targetDays:30,score10:7,provisional:false},
   {month:"2026-11",qualifiedDays:1,targetDays:1,score10:10,provisional:true}];
 const {html}=setup("provisional",["2026-10","2026-11"],8.5,details);
 assert.match(html,/⚠️ 進行中暫估/);
 assert.match(html,/非主要鼓勵榜單/);
 assert.match(html,/8\.5\/10/);
 assert.match(html,/1 \/ 1 天/);
 assert.match(html,/進行中・暫估/);
 assert.match(html,/7 ＋ 10/);
});
test("no completed month shows a clear explanation rather than fabricating a zero-score ranking",()=>{
 const {html}=setup("final",[],0,[]);
 assert.match(html,/目前尚無已結束的正式計分月份/);
 assert.doesNotMatch(html,/practice-leaderboard-item/);
});
test("mode switch handler marks old response stale and requests newly selected mode",()=>{
 const header=source.slice(source.indexOf("  async function loadParentPracticeLeaderboard("),
   source.indexOf("  function leaderboardMonthlyDetail("));
 assert.match(source,/parentPracticeLeaderboardMode="final"/); // initialized before first request
 assert.match(header,/&mode="\+mode/);
 assert.match(header,/state\.parentPracticeLeaderboardMode===mode/);
 assert.match(header,/state\.parentPracticeLeaderboardDataMode=mode/);
 assert.match(header,/window\.setParentPracticeLeaderboardMode/);
});
