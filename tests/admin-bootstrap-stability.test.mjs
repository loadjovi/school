import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const appSource=read("app/app-v3.js"),guard=read("app/webview-guard.js");
const profileCode=appSource.slice(appSource.indexOf("async function loadProfile("),appSource.indexOf("async function refreshStudent("));
const renderCode=appSource.split("\n").find(line=>line.startsWith("function render(){"));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const admin={role:"admin",email:"admin@example.test",schoolId:"school-a",capabilities:{}};

function bootstrap(){
 const pending=[],scripts=[],preloads=[],requests=[],writes=[],logins=[],session=new Map(),timers=new Map();let sequence=0,markup="";
 const app={get innerHTML(){return markup},set innerHTML(value){markup=value;writes.push(value)}};
 const state={token:"session",me:null,page:"home",students:[],master:[],registrations:[]};
 const document={scripts,getElementById:id=>id==="app"?app:null,addEventListener(){},documentElement:{classList:{add(){},remove(){}}},
  querySelector:selector=>preloads.find(link=>selector===`link[data-role-preload="${link.href}"]`)||null,
  createElement:tag=>({tag,dataset:{},getAttribute(name){return this[name]},remove(){const i=scripts.indexOf(this);if(i>=0)scripts.splice(i,1)}}),
  head:{appendChild:link=>preloads.push(link)},body:{appendChild:script=>{scripts.push(script);pending.push(script)}}};
 const scope={state,document,URL,URLSearchParams,location:new URL("https://school-a.example.test/"),navigator:{userAgent:"Chrome"},history:{replaceState(){}},CSS:{escape:String},
  sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},
  setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),setInterval:()=>++sequence,clearInterval(){},
  paidActivityEntry:()=>null,openPaidActivity:()=>false,apiReadScope:()=>JSON.stringify([state.token,state.me?.email,state.me?.schoolId,state.me?.role]),
  api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),console:{warn(){}},esc:String,toast(){},
  shell:content=>`<main class="main">${content}</main>`,adminPage:()=>'<section id="workspace-ready">工作首頁</section>',renderLogin:message=>{logins.push(message);app.innerHTML='<section id="login-ready">'+message+'</section>'}
 };
 scope.window=scope;runInNewContext(profileCode+"\n"+renderCode,scope);runInNewContext(guard,scope);
 async function finishScript(failure=""){
  const script=pending.shift();assert.ok(script,"a role asset must be waiting");
  if(failure&&script.src.includes(failure))script.onerror?.();
  else{
   if(script.src.includes("private-lesson-confirmation.js"))scope.privateLessonParentPanels=()=>"";
   if(script.src.includes("parent-home-summary.js"))scope.parentHomeSummaryReady=true;
   script.onload?.();
  }
  await settle();return script.src;
 }
 async function assets(failure=""){for(let i=0;i<80;i++){await settle();if(pending.length)await finishScript(failure);else return}throw Error("asset queue did not settle")}
 function replyCore(suffix="a",start=0){
  for(const request of requests.slice(start))request.resolve({items:request.url.includes("student-master")?[{studentId:"student-"+suffix,name:suffix}]:[{id:"pending-"+suffix}]});
 }
 return {scope,state,app,writes,logins,requests,preloads,pending,finishScript,assets,replyCore,
  async start(){await finishScript()},login:profile=>scope.loadProfile({...admin,...profile})};
}

test("admin login preloads assets while one roster/pending read runs and keeps one stable loading DOM until modules finish",async()=>{
 const h=bootstrap();await h.start();const login=h.login();
 assert.equal(h.requests.length,2);assert.ok(h.preloads.some(link=>link.href.startsWith("/school-admin-workspace.js")));
 assert.ok(h.pending.some(script=>script.src.startsWith("/roster-support.js")));
 assert.match(h.app.innerHTML,/data-role-boot/);assert.doesNotMatch(h.app.innerHTML,/class="main"|Dashboard|workspace-ready/);
 for(let i=0;i<8;i++)h.scope.render();assert.equal(h.writes.length,1);
 h.replyCore();await login;assert.equal(h.state.master[0].studentId,"student-a");assert.equal(h.writes.length,1);
 await h.assets();assert.equal(h.scope.__roleModulesReady,true);assert.match(h.app.innerHTML,/workspace-ready/);assert.equal(h.writes.filter(html=>html.includes("workspace-ready")).length,1);assert.equal(h.requests.length,2);
});

test("when scripts arrive before slow core data, no legacy or false empty homepage is displayed",async()=>{
 const h=bootstrap();await h.start();const login=h.login();await h.assets();
 assert.notEqual(h.scope.__roleModulesReady,true);assert.match(h.app.innerHTML,/data-role-boot/);assert.equal(h.writes.length,1);
 h.replyCore();await login;await settle();assert.equal(h.scope.__roleModulesReady,true);assert.match(h.app.innerHTML,/workspace-ready/);assert.equal(h.state.master.length,1);
 assert.equal(h.writes.filter(html=>html.includes("workspace-ready")).length,1);
});

test("failed admin core data stays retryable and explicit retry reloads data instead of declaring empty data ready",async()=>{
 const h=bootstrap();await h.start();const login=h.login();h.requests[0].reject(Error("roster unavailable"));h.requests[1].resolve({items:[]});await login;await h.assets();
 assert.notEqual(h.scope.__roleModulesReady,true);assert.match(h.app.innerHTML,/重新載入功能/);assert.doesNotMatch(h.app.innerHTML,/workspace-ready/);
 const retry=h.scope.retryRoleModules();assert.equal(h.requests.length,4);h.replyCore("retry",2);await h.assets();await retry;
 assert.equal(h.scope.__roleModulesReady,true);assert.equal(h.state.master[0].studentId,"student-retry");assert.match(h.app.innerHTML,/workspace-ready/);
});

test("a failed admin module can retry without repeating a successful initial roster read",async()=>{
 const h=bootstrap();await h.start();const login=h.login();h.replyCore();await login;await h.assets("teacher-admin.js");
 assert.notEqual(h.scope.__roleModulesReady,true);assert.match(h.app.innerHTML,/重新載入功能/);
 const retry=h.scope.retryRoleModules();await h.assets();await retry;assert.equal(h.scope.__roleModulesReady,true);assert.equal(h.requests.length,2);
});

test("an expired session during explicit core retry returns to login once and a fresh verified login can bootstrap again",async()=>{
 const h=bootstrap();await h.start();const login=h.login();h.requests[0].reject(Error("unavailable"));h.requests[1].resolve({items:[]});await login;await h.assets();
 const retry=h.scope.retryRoleModules();h.state.me=null;h.state.token="";h.requests[2].reject(Error("登入已失效"));h.requests[3].resolve({items:[]});await retry;await settle();
 assert.equal(h.logins.length,1);assert.match(h.logins[0],/重新登入/);assert.match(h.app.innerHTML,/login-ready/);assert.notEqual(h.scope.__roleModulesReady,true);
 h.state.token="fresh-session";const fresh=h.login();h.replyCore("fresh",4);await fresh;await h.assets();await settle();assert.equal(h.scope.__roleModulesReady,true);assert.match(h.app.innerHTML,/workspace-ready/);
});

test("old core responses and old bootstrap completion cannot populate or prematurely finish another school's admin login",async()=>{
 const h=bootstrap();await h.start();const old=h.login();const next=h.login({schoolId:"school-b",email:"other@example.test"});
 assert.equal(h.requests.length,4);h.requests[0].resolve({items:[{id:"old-pending"}]});h.requests[1].resolve({items:[{studentId:"old-student"}]});await old;await h.assets();await settle();
 assert.equal(h.state.master.length,0);assert.notEqual(h.scope.__roleModulesReady,true);assert.doesNotMatch(h.app.innerHTML,/workspace-ready/);
 h.requests[2].resolve({items:[{id:"new-pending"}]});h.requests[3].resolve({items:[{studentId:"new-student"}]});await next;await h.assets();await settle();
 assert.equal(h.state.me.schoolId,"school-b");assert.equal(h.state.master[0].studentId,"new-student");assert.equal(h.scope.__roleModulesReady,true);
 assert.match(h.app.innerHTML,/workspace-ready/);assert.equal(h.state.student.studentId,"new-student");
});

function directory(){
 const state={token:"session",me:{...admin},page:"admin",teachers:[],teacherStudents:[]},requests=[],calls={base:0,render:0,refresh:0};let epoch=0;
 const scope={state,window:null,apiReadScope:()=>JSON.stringify([epoch,state.token,state.me?.role,state.me?.email,state.me?.schoolId]),api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),
  loadAdmin:async()=>{calls.base++},adminPage:()=>"",render:()=>{calls.render++},refreshSchoolAdminWorkspaceView:()=>{calls.refresh++},setTimeout:()=>1,esc:String,$:()=>null,console:{warn(){}},document:{querySelector:()=>null,getElementById:()=>null}};
 scope.window=scope;scope.__roleModuleBootstrap=true;runInNewContext(read("app/teacher-admin.js"),scope);
 return {scope,state,requests,calls,setEpoch:value=>{epoch=value}};
}

test("teacher module fetches only its directory once, not the whole admin roster, and updates workspace locally after bootstrap",async()=>{
 const h=directory();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,"/api/teacher-directory");assert.equal(h.calls.base,0);assert.equal(h.calls.render,0);
 const first=h.scope.loadTeacherAdminDirectory(),second=h.scope.loadAdmin();assert.equal(h.requests.length,1);assert.equal(h.calls.base,1);
 h.requests[0].resolve({items:[{email:"teacher@example.test"}],students:[{studentId:"student-a"}]});await Promise.all([first,second]);
 assert.equal(h.state.teacherDirectoryLoaded,true);assert.equal(h.calls.render,0);assert.equal(h.calls.refresh,0);
 h.scope.__roleModuleBootstrap=false;const fresh=h.scope.loadTeacherAdminDirectory();assert.equal(h.requests.length,2);h.requests[1].resolve({items:[],students:[]});await fresh;assert.equal(h.state.teacherDirectoryLoading,false);
});

test("teacher directory reads are isolated by school and post-write scope; obsolete results and failures never replace another context",async()=>{
 const h=directory(),old=h.scope.loadTeacherAdminDirectory();h.state.me={...admin,schoolId:"school-b"};const next=h.scope.loadTeacherAdminDirectory();assert.equal(h.requests.length,2);
 h.requests[0].resolve({items:[{email:"old-private@example.test"}],students:[]});await old;assert.equal(h.state.teachers.length,0);assert.equal(h.state.teacherDirectoryLoading,true);
 h.requests[1].resolve({items:[{email:"school-b@example.test"}],students:[]});await next;assert.equal(h.state.teachers[0].email,"school-b@example.test");
 h.setEpoch(1);const written=h.scope.loadTeacherAdminDirectory();h.requests[2].reject(Error("unavailable"));await written;assert.equal(h.state.teacherDirectoryLoaded,false);assert.equal(h.state.teacherDirectoryLoading,false);assert.match(h.state.teacherDirectoryError,/unavailable/);assert.equal(h.state.teachers[0].email,"school-b@example.test");
});

function parentLinks(){
 const state={token:"session",me:{...admin},page:"admin",master:[],registrations:[]},requests=[],calls={base:0,render:0,refresh:0},panel={innerHTML:"typed draft",contains:()=>true};let epoch=0;
 const scope={state,window:null,apiReadScope:()=>JSON.stringify([epoch,state.token,state.me?.role,state.me?.email,state.me?.schoolId]),api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),
  loadAdmin:async()=>{calls.base++},studentEdit:()=>"",render:()=>{calls.render++},refreshSchoolAdminWorkspaceView:()=>{calls.refresh++},setTimeout:()=>1,esc:String,$:()=>null,console:{warn(){}},document:{activeElement:{id:"typed"},querySelector:()=>null,getElementById:id=>id==="parentBindingStats"?panel:null}};
 scope.window=scope;scope.__roleModuleBootstrap=true;runInNewContext(read("app/parent-link-admin.js"),scope);
 return {scope,state,requests,calls,panel,setEpoch:value=>{epoch=value}};
}

test("parent bindings share in-flight loading, survive links-before-roster order, and never trigger a startup whole-page redraw",async()=>{
 const h=parentLinks(),load=h.scope.loadAdmin();await settle();assert.equal(h.requests.length,1);assert.equal(h.calls.base,1);
 h.requests[0].resolve({items:[{studentId:"student-a",parentEmail:"parent@example.test",lineBound:true}]});await load;
 assert.equal(h.state.studentLineLoaded,true);assert.equal(h.calls.render,0);
 h.state.master=[{studentId:"student-a",status:"active"}];h.scope.applyAdminParentLinks();assert.equal(h.state.master[0].parents[0].parentEmail,"parent@example.test");assert.equal(h.scope.studentLineCoverageCounts(h.state.master).bound,1);
});

test("late parent-link startup completion updates workspace locally and preserves a focused parent-binding form",async()=>{
 const h=parentLinks();h.scope.__roleModuleBootstrap=false;h.requests[0].resolve({items:[]});await settle();
 assert.equal(h.calls.render,0);assert.equal(h.calls.refresh,1);assert.equal(h.panel.innerHTML,"typed draft");
});

test("parent links from the previous school cannot replace current links, mark them loaded, or overwrite student mappings",async()=>{
 const h=parentLinks();h.state.me={...admin,schoolId:"school-b"};h.state.master=[{studentId:"student-b"}];const load=h.scope.loadAdmin();await settle();assert.equal(h.requests.length,2);
 h.requests[0].resolve({items:[{studentId:"student-b",parentEmail:"old-parent@example.test"}]});await settle();assert.equal(h.state.studentLineLoaded,false);assert.equal(h.state.parentLinks.length,0);assert.equal(h.state.master[0].parents,undefined);
 h.requests[1].resolve({items:[{studentId:"student-b",parentEmail:"correct-parent@example.test"}]});await load;assert.equal(h.state.studentLineLoaded,true);assert.equal(h.state.master[0].parents[0].parentEmail,"correct-parent@example.test");
 h.setEpoch(1);h.scope.applyAdminParentLinks();assert.match(h.state.parentLinksScope,/school-b/);
});

test("administrator records separate approved parent identity, LINE linking and saved friendship without changing any mapping or status",async()=>{
 const h=parentLinks(),records=[{studentId:'student-a',parentEmail:'parent@example.test',parentName:'家長甲',lineBound:true,lineFriendStatus:'not_friend',lineFriendCheckedAt:'2026-11-25T01:20:00Z'},{studentId:'student-a',parentEmail:'second@example.test',lineBound:false}];
 const original=JSON.stringify(records);h.state.master=[{studentId:'student-a',name:'學生甲',status:'active'}];h.requests[0].resolve({items:records});await settle();
 const student=h.state.master[0],details=h.scope.studentEdit(student),coverage=h.scope.studentLineCoverage(h.state.master,1);
 assert.match(details,/家長身分已核准/);assert.match(details,/LINE 已綁定/);assert.match(details,/LINE 未綁定/);assert.match(details,/官方好友最後結果：需確認好友狀態/);assert.match(details,/最後確認時間/);
 assert.match(details,/我的 LINE 綁定 → 重新確認好友/);assert.match(details,/不需重新註冊、審核或綁定學生/);
 assert.match(coverage,/審核通過不代表已確認好友/);assert.match(coverage,/重新讀取已存紀錄/);assert.match(coverage,/只更新本頁顯示/);
 assert.equal(h.scope.studentLineStatus(student),'not_friend');assert.equal(JSON.stringify(records),original);
 const renderStudents=appSource.slice(appSource.indexOf('function studentsPage(){'),appSource.indexOf('window.selectStudentMasterGroup='));
 runInNewContext(renderStudents,h.scope);const page=h.scope.studentsPage();assert.match(page,/已核准 2 位家長/);assert.doesNotMatch(page,/已綁定 2 位/);assert.match(page,/data-line-status="not_friend"/);
 h.scope.setStudentLineFilter('not_friend');assert.equal(h.state.studentLineFilter,'not_friend');assert.equal(JSON.stringify(records),original);
 const reload=h.scope.reloadStudentLineCoverage();assert.equal(h.requests.length,2);assert.equal(h.requests[1].url,'/api/student-parent-links?includeLineStatus=1');
 h.requests[1].resolve({items:records});await reload;assert.equal(JSON.stringify(records),original);assert.equal(h.scope.studentLineStatus(student),'not_friend');
});

test("an approved parent with no friendship record remains pending and is directed to their own check instead of another application",async()=>{
 const h=parentLinks();h.state.master=[{studentId:'student-a',name:'學生甲',status:'active'}];h.requests[0].resolve({items:[{studentId:'student-a',parentEmail:'parent@example.test',lineBound:true,lineFriendStatus:'unknown'}]});await settle();
 const student=h.state.master[0];assert.equal(h.scope.studentLineStatus(student),'pending');h.scope.setStudentLineFilter('pending');
 const details=h.scope.studentEdit(student),coverage=h.scope.studentLineCoverage(h.state.master,1);assert.match(details,/家長身分已核准/);assert.match(details,/官方好友最後結果：尚未確認好友/);assert.match(details,/重新確認好友/);assert.match(coverage,/不能據此判定是否已加好友或封鎖/);
 assert.equal(h.state.registrations.length,0);assert.equal(student.parents[0].lineFriendStatus,'unknown');
});
