import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const appDir=resolve(dirname(fileURLToPath(import.meta.url)),"../../app");
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
function fixedDate(iso){
  return class extends Date{
    constructor(...args){super(...(args.length?args:[iso]))}
  };
}
function makeParent(iso,fetchPractice){
  const scheduled=[];
  const context={
    Date:fixedDate(iso),Intl,encodeURIComponent,
    state:{me:{role:"parent"},student:{studentId:"child-a",name:"甲同學"},page:"practice"},
    window:{},practicePage:()=>"<div class=\"card\"><h2>最近練習</h2><div>本月練習</div></div>",recordPage:()=>"<div>出勤紀錄</div>",savePractice:async()=>true,
    setTimeout:callback=>scheduled.push(callback),api:fetchPractice,esc:escapeHtml,
    render(){context.latest=context.practicePage()}
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(appDir,"parent-practice-history.js"),"utf8"),context);
  return {context,scheduled};
}

test("parent sees all previous-month practice sessions on practice and record pages",async()=>{
  const calls=[];
  const {context,scheduled}=makeParent("2026-10-03T02:00:00Z",async url=>{
    calls.push(url);
    return {qualifiedMinutes:20,items:[
      {practiceDate:"2026-09-29",startTime:"18:00",endTime:"18:12",minutes:12,dailyMinutes:20,qualified:true,practiceContent:"音階",focus:"基本功"},
      {practiceDate:"2026-09-29",startTime:"19:00",endTime:"19:08",minutes:8,dailyMinutes:20,qualified:true,practiceContent:"練習曲",focus:"節奏"}
    ]};
  });
  assert.match(context.practicePage(),/正在讀取上個月/);
  await scheduled.shift()();
  assert.deepEqual(calls,["/api/practice?studentId=child-a&month=2026-09"]);
  assert.match(context.latest,/上月自主練習｜2026 年 9 月/);
  assert.match(context.latest,/2 筆｜20 分鐘｜達標 1 天/);
  assert.match(context.latest,/<details (?!open)/);
  assert.match(context.latest,/<h2>最近練習<\/h2><button[^>]*>更新<\/button>/);
  assert.doesNotMatch(context.latest,/parent-previous-practice[^]*onclick="refreshParentPracticeHistory\(\)"/);
  assert.match(context.latest,/音階/);
  assert.match(context.latest,/練習曲/);
  assert.match(context.latest,/9 月為測試期/);
  assert.match(context.recordPage(),/練習重點：基本功/);
  context.window.setParentPracticeHistoryOpen(true);
  assert.match(context.practicePage(),/<details open/);
  assert.equal(scheduled.length,0);
});

test("refresh in recent practice reloads both current and previous months",async()=>{
  const calls=[];
  const {context,scheduled}=makeParent("2026-10-03T02:00:00Z",async url=>{
    calls.push(url);
    return {items:[{practiceDate:"2026-09-29",minutes:20,qualified:true,practiceContent:"昨日練習"}]};
  });
  context.refreshStudent=async()=>{calls.push("refresh-current")};
  context.toast=()=>{};
  context.practicePage();
  await scheduled.shift()();
  await context.window.refreshParentPracticeHistory();
  assert.deepEqual(calls,["/api/practice?studentId=child-a&month=2026-09","refresh-current","/api/practice?studentId=child-a&month=2026-09"]);
  assert.match(context.latest,/昨日練習/);
  assert.match(context.latest,/<h2>最近練習<\/h2><button[^>]*>更新<\/button>/);
});

test("parent history crosses year boundary and does not show another child's response",async()=>{
  const responses=new Map();
  const {context,scheduled}=makeParent("2027-01-01T00:00:00Z",url=>new Promise(resolve=>responses.set(url,resolve)));
  context.practicePage();
  const first=scheduled.shift()();
  const aUrl="/api/practice?studentId=child-a&month=2026-12";
  assert.ok(responses.has(aUrl));
  context.state.student={studentId:"child-b",name:"乙同學"};
  assert.match(context.practicePage(),/乙同學/);
  const second=scheduled.shift()();
  const bUrl="/api/practice?studentId=child-b&month=2026-12";
  responses.get(bUrl)({items:[{practiceDate:"2026-12-30",minutes:20,dailyMinutes:20,qualified:true,practiceContent:"乙同學曲目"}]});
  await second;
  responses.get(aUrl)({items:[{practiceDate:"2026-12-20",minutes:20,dailyMinutes:20,qualified:true,practiceContent:"甲同學曲目"}]});
  await first;
  assert.match(context.practicePage(),/乙同學曲目/);
  assert.doesNotMatch(context.practicePage(),/甲同學曲目/);
});

test("teacher has a one-click previous month and sees every record for the selected student",async()=>{
  const requests=[];
  const app={innerHTML:""};
  const records=Array.from({length:10},(_,i)=>({practiceDate:`2026-09-${String(i+1).padStart(2,"0")}`,minutes:20,dayMinutes:20,qualified:true,practiceContent:`曲目${i+1}`}));
  const item={studentId:"s1",name:"學生甲",groupName:"A",section:"小提琴",instrument:"小提琴",grade:"三年級",activeDays:10,qualifiedDays:10,practiceRatePercent:100,records,recent:records.slice(0,8)};
  const context={
    Date:fixedDate("2026-10-03T02:00:00Z"),Intl,encodeURIComponent,esc:escapeHtml,
    state:{me:{role:"teacher",capabilities:{teacherSettings:true}},page:"practiceProgress"},
    window:{},document:{getElementById:()=>app},api:async url=>{
      requests.push(url);
      return url.startsWith("/api/practice-feedback")?{items:[]}:{month:"2026-09",taipeiToday:"2026-10-03",effectiveTargetDays:30,qualifiedMinutes:20,items:[item]};
    },shell:x=>x,render:()=>{},go:()=>{},toast:()=>{}
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(appDir,"practice-progress.js"),"utf8"),context);
  context.state.practiceProgressData={month:"2026-10",taipeiToday:"2026-10-03",effectiveTargetDays:3,qualifiedMinutes:20,items:[item]};
  context.render();
  assert.match(app.innerHTML,/上月｜2026 年 9 月/);
  await context.window.changePracticeProgressMonth("2026-09");
  assert.ok(requests.includes("/api/practice-progress?month=2026-09"));
  context.window.togglePracticeProgressDetail("s1");
  assert.match(app.innerHTML,/2026-09 完整紀錄｜10 筆/);
  assert.match(app.innerHTML,/曲目10/);
  assert.match(app.innerHTML,/日常鼓勵｜不計分/);
});
