import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const appSource=read("app/app-v3.js"),loaderSource=read("app/webview-guard.js");
const profileSource=appSource.slice(appSource.indexOf("async function loadProfile("),appSource.indexOf("async function loadAdmin("));
const renderSource=appSource.split("\n").find(line=>line.startsWith("function render(){"));
const profile={role:"parent",schoolId:"school-a",email:"parent@example.invalid",capabilities:{}};
const completeHome='<section id="parentTodayCourses">今日課程</section><section id="parentUpcomingActivities">未來活動</section><section id="parentLatestNews">最新消息</section><section id="parentPracticeAction">自主練習</section>';
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness(){
 let clock=0,timerId=0;const timers=new Map(),scripts=[],pending=[],loaded=[],classes=new Set(),session=new Map(),warnings=[];
 const app={innerHTML:""},state={me:null,students:[],student:null,summary:null,page:"home"};
 const schedule=(fn,delay,interval=0)=>{const id=++timerId;timers.set(id,{fn,at:clock+Number(delay||0),interval});return id};
 function advance(ms){const end=clock+ms;for(let i=0;i<3000;i++){
  const pair=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;
  const [id,t]=pair;clock=t.at;if(t.interval)t.at+=t.interval;else timers.delete(id);t.fn();
 }clock=end}
 const document={scripts,documentElement:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}},
  getElementById:id=>id==="app"?app:null,querySelector:()=>null,addEventListener(){},
  createElement:tag=>({tag,dataset:{},getAttribute(name){return this[name]},remove(){const i=scripts.indexOf(this);if(i>=0)scripts.splice(i,1)}}),
  head:{appendChild(){}},body:{appendChild(element){if(element.tag==="script"){scripts.push(element);pending.push(element)}}}};
 const context={state,document,URL,URLSearchParams,location:new URL("https://school-a.example.invalid/"),navigator:{userAgent:"Chrome"},history:{replaceState(){}},
  sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},
  CSS:{escape:x=>x},console:{warn:(...args)=>warnings.push(args)},
  setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>schedule(fn,delay,delay),clearInterval:id=>timers.delete(id),
  esc:value=>String(value??""),shell:html=>'<main class="shell">'+html+'</main>',home:()=>"legacy-parent-home",toast(){},
  paidActivityEntry:()=>null,openPaidActivity:()=>false,
  api:async path=>{assert.equal(path,"/api/students");return [{studentId:"student1",name:"測試學生"}]},
  refreshStudent:async()=>{state.summary={practiceMinutes:0}},loadAdmin:async()=>{},renderLogin(){}};
 context.window=context;vm.createContext(context);
 vm.runInContext(profileSource+"\n"+renderSource,context);
 vm.runInContext(loaderSource,context);
 async function finishScript({fail="",skipHomeReady=false}={}){
  const script=pending.shift();assert.ok(script,"expected an outstanding module request");
  if(fail&&script.src.includes(fail)){script.onerror();await settle();return script.src}
  if(script.src.includes("private-lesson-confirmation.js"))context.privateLessonParentPanels=()=>"";
  if(script.src.includes("parent-home-summary.js")&&!skipHomeReady){context.parentHomeSummaryReady=true;context.home=()=>completeHome}
  loaded.push(script.src);script.onload?.();await settle();return script.src;
 }
 async function finishModules(options={}){
  for(let i=0;i<50;i++){
   await settle();
   if(context.__roleModulesReady||context.__roleModuleError)return;
   if(pending.length)await finishScript(options);else advance(60);
  }
  throw Error("module task did not settle");
 }
 return {context,state,app,loaded,pending,warnings,advance,finishScript,finishModules,
  async start(){await finishScript();advance(60);await settle()},
  async login(){await context.loadProfile({...profile});await settle()}};
}

test("a fresh Gmail or LINE login after a long wait loads the full parent home without a page refresh",async()=>{
 const h=harness();await h.start();h.advance(60_000);await settle();
 assert.equal(h.state.me,null);assert.equal(h.pending.length,0);
 await h.login();assert.match(h.app.innerHTML,/正在準備家長功能/);assert.doesNotMatch(h.app.innerHTML,/legacy-parent-home/);
 await h.finishModules();
 assert.equal(h.context.__roleModulesReady,true);assert.equal(h.context.__roleLoaderActive,false);
 for(const id of ["parentTodayCourses","parentUpcomingActivities","parentLatestNews","parentPracticeAction"])assert.ok(h.app.innerHTML.includes(id));
 assert.equal(h.loaded.filter(src=>src.includes("parent-home-summary.js")).length,1);
 assert.equal(h.loaded.filter(src=>src.includes("special-calendar.js")).length,1);
 assert.ok(h.loaded.findIndex(src=>src.includes("special-calendar.js"))>h.loaded.findIndex(src=>src.includes("parent-home-summary.js")));
});

test("restored sessions and repeated renders share one pending bootstrap rather than completing early",async()=>{
 const h=harness();await h.login();
 for(let i=0;i<5;i++)h.context.render();
 assert.equal(h.pending.filter(s=>s.src.includes("parent-activity-notice.js")).length,1);
 assert.match(h.app.innerHTML,/正在準備家長功能/);
 await h.finishScript();h.advance(60);await h.finishModules();
 assert.equal(h.loaded.filter(src=>src.includes("parent-home-summary.js")).length,1);
 assert.equal(h.context.__roleModulesReady,true);assert.match(h.app.innerHTML,/未來活動/);
});

test("a failed parent module shows retry, and retry reuses successful scripts instead of leaving a partial home",async()=>{
 const h=harness();await h.start();await h.login();await h.finishModules({fail:"parent-home-summary.js"});
 assert.notEqual(h.context.__roleModulesReady,true);assert.match(h.app.innerHTML,/重新載入功能/);
 assert.doesNotMatch(h.app.innerHTML,/legacy-parent-home|parentUpcomingActivities/);
 const task=h.context.retryRoleModules();await h.finishModules();await task;
 assert.equal(h.context.__roleModulesReady,true);assert.match(h.app.innerHTML,/parentUpcomingActivities/);
 assert.equal(h.loaded.filter(src=>src.includes("private-lesson-confirmation.js")).length,1);
});

test("an unresponsive script leaves a retryable error and never reports parent modules ready",async()=>{
 const h=harness();await h.start();await h.login();h.advance(15_001);await settle();
 assert.notEqual(h.context.__roleModulesReady,true);assert.match(h.app.innerHTML,/重新載入功能/);
});

test("a downloaded script that did not initialize the parent home cannot silently expose the base template",async()=>{
 const h=harness();await h.start();await h.login();await h.finishModules({skipHomeReady:true});
 assert.notEqual(h.context.__roleModulesReady,true);assert.match(h.app.innerHTML,/重新載入功能/);
 assert.doesNotMatch(h.app.innerHTML,/legacy-parent-home/);
 const task=h.context.retryRoleModules();await h.finishModules();await task;
 assert.equal(h.context.__roleModulesReady,true);assert.match(h.app.innerHTML,/parentUpcomingActivities/);
});
