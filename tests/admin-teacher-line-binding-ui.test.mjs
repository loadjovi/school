import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const tick=()=>new Promise(setImmediate);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const teacher=(email="teacher@example.test",binding)=>({email,teacherName:"正式老師",status:"active",sectionAssignments:[],ensembleGroups:[],privateStudentIds:["112001"],...(binding?{lineBinding:binding}:{})});
function fixture(){
  const state={token:"admin-token",me:{role:"admin",email:"admin@example.test",schoolId:"school-a"},page:"admin",teachers:[]};
  const nodes=new Map(),requests=[],calls={render:0,base:0},control={epoch:0};
  const context={state,window:null,URLSearchParams,Intl,Date,console:{warn(){}},esc,$:id=>nodes.get(id)||null,
    apiReadScope:()=>JSON.stringify([control.epoch,state.token,state.me?.role,state.me?.email,state.me?.schoolId]),
    api:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),
    loadAdmin:async()=>{calls.base++},adminPage:()=>"",render:()=>{calls.render++},setTimeout:()=>1,
    document:{getElementById:id=>nodes.get(id)||null,querySelector:()=>null}};
  context.window=context;context.__roleModuleBootstrap=true;
  runInNewContext(read("app/teacher-admin.js"),context);
  async function initial(items){requests[0].resolve({items,students:[]});await tick();await tick();}
  function mountBindingNodes(){
    nodes.set("teacherLineBindingSummary",{textContent:""});
    nodes.set("teacherLineBindingRefresh",{disabled:false,textContent:"更新 LINE 綁定狀態"});
    nodes.set("teacherLineBindingError",{textContent:"",hidden:true});
    for(const t of state.teachers)nodes.set("teacherLineBinding_"+encodeURIComponent(t.email),{innerHTML:"previous binding"});
  }
  return {context,state,nodes,requests,calls,control,initial,mountBindingNodes,
    html:()=>context.teacherAdminManagementHtml(),refresh:()=>context.refreshTeacherLineBindingStatus()};
}

test("the teacher list shows current Gmail and LINE pairing, escaped LINE name and separate stored friend evidence",async()=>{
  const h=fixture();await h.initial([teacher(undefined,{status:"paired",displayName:'LINE <img src=x onerror="bad">',
    linkedAt:"2026-11-27T00:30:00Z",friendStatus:"friend",friendCheckedAt:"2026-11-26T23:00:00Z",checkedAt:"2026-11-27T01:00:00Z"})]);
  const html=h.html();
  assert.match(html,/Gmail＋LINE 已配對/);assert.match(html,/LINE 名稱：LINE &lt;img/);
  assert.doesNotMatch(html,/<img src=x|LINE user|googleSub|token/);
  assert.match(html,/配對時間：2026\/11\/27\s+08:30/);assert.match(html,/官方帳號好友紀錄：已確認為好友/);
  assert.match(html,/好友最後確認：2026\/11\/27\s+07:00/);assert.match(html,/綁定查核時間：2026\/11\/27\s+09:00/);
  assert.match(html,/已配對 1／1 位老師/);assert.match(html,/不代表通知已送達/);
  assert.match(html,/min-height:44px[^>]*onclick="refreshTeacherLineBindingStatus\(\)"/);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,"/api/teacher-directory");
});

test("incomplete, unavailable and missing API statuses cannot be mislabeled as paired",async t=>{
  for(const [status,label] of [["unpaired","未完成 Gmail＋LINE 配對"],["needs_confirmation","Gmail＋LINE 配對需確認"],
    ["not_configured","學校 LINE 尚未設定"],["unavailable","暫時無法確認 Gmail＋LINE 配對"],["future_status","尚未取得 Gmail＋LINE 配對狀態"],[undefined,"尚未取得 Gmail＋LINE 配對狀態"]]){
    await t.test(String(status),async()=>{
      const h=fixture();await h.initial([teacher(undefined,status?{status,displayName:"unverified-name"}:undefined)]);
      const html=h.html();assert.ok(html.includes(label));assert.doesNotMatch(html,/LINE 名稱：|unverified-name/);
      assert.match(html,/已配對 0／1 位老師/);
      if(!status)assert.doesNotMatch(html,/未完成 Gmail＋LINE 配對/);
    });
  }
});

test("LINE pairing remains verified when friendship is unconfirmed or unavailable, without pretending delivery",async t=>{
  for(const [status,label] of [["not_friend","尚未確認為好友"],["unknown","尚無確認紀錄"],["unavailable","暫時無法讀取"]])await t.test(status,async()=>{
    const h=fixture();await h.initial([teacher(undefined,{status:"paired",displayName:"老師自己的LINE",friendStatus:status})]);
    const html=h.html();assert.match(html,/Gmail＋LINE 已配對/);assert.ok(html.includes("官方帳號好友紀錄："+label));
    assert.doesNotMatch(html,/未完成 Gmail＋LINE 配對|LINE 已送達|已讀/);
  });
});

test("status refresh performs only a deduplicated directory read and preserves unsaved name, type and student selection DOM",async()=>{
  const h=fixture();await h.initial([teacher(undefined,{status:"unpaired"})]);h.mountBindingNodes();
  const name={value:"尚未儲存的新名字"},type={value:"privateOnly"},students={selectedOptions:[{value:"112001"},{value:"112002"}]};
  h.nodes.set("tn_teacher_example_test",name);h.nodes.set("tt_teacher_example_test",type);h.nodes.set("tp_teacher_example_test",students);
  const first=h.refresh();await h.refresh();assert.equal(h.requests.length,2);
  assert.equal(h.nodes.get("teacherLineBindingRefresh").disabled,true);
  h.requests[1].resolve({items:[{...teacher(undefined,{status:"paired",displayName:"老師的LINE",friendStatus:"friend"}),teacherName:"伺服器舊名字"}],students:[]});await first;
  assert.match(h.nodes.get("teacherLineBinding_"+encodeURIComponent("teacher@example.test")).innerHTML,/Gmail＋LINE 已配對.*LINE 名稱：老師的LINE/);
  assert.equal(h.nodes.get("teacherLineBindingRefresh").disabled,false);
  assert.equal(h.nodes.get("teacherLineBindingSummary").textContent,"Gmail＋LINE 已配對 1／1 位老師。");
  assert.equal(h.nodes.get("tn_teacher_example_test"),name);assert.equal(name.value,"尚未儲存的新名字");
  assert.equal(type.value,"privateOnly");assert.deepEqual(students.selectedOptions.map(x=>x.value),["112001","112002"]);
  assert.equal(h.calls.render,0);assert.equal(h.calls.base,0);
  assert.equal(h.requests.every(x=>x.url==="/api/teacher-directory"&&!x.options),true);
});

test("a failed refresh retains existing binding details with an explicit previous-record warning and remains retryable",async()=>{
  const h=fixture();await h.initial([teacher(undefined,{status:"paired",displayName:"原綁定LINE"})]);h.mountBindingNodes();
  const first=h.refresh();h.requests[1].reject(Error("名單暫時無法讀取"));await first;
  assert.match(h.nodes.get("teacherLineBindingError").textContent,/更新未完成.*目前顯示上次讀取/);
  assert.equal(h.nodes.get("teacherLineBindingError").hidden,false);assert.equal(h.nodes.get("teacherLineBindingRefresh").disabled,false);
  assert.match(h.nodes.get("teacherLineBinding_"+encodeURIComponent("teacher@example.test")).innerHTML,/原綁定LINE/);
  const retry=h.refresh();h.requests[2].resolve({items:[teacher(undefined,{status:"unpaired"})],students:[]});await retry;
  assert.equal(h.nodes.get("teacherLineBindingError").hidden,true);
  assert.match(h.nodes.get("teacherLineBinding_"+encodeURIComponent("teacher@example.test")).innerHTML,/未完成 Gmail＋LINE 配對/);
});

test("an old school or login response cannot patch a newer administrator screen",async()=>{
  const h=fixture();await h.initial([teacher(undefined,{status:"unpaired"})]);h.mountBindingNodes();
  const old=h.refresh();h.state.me={...h.state.me,schoolId:"school-b"};h.state.token="new-admin-token";
  h.state.teachers=[teacher("new@example.test",{status:"paired",displayName:"新學校LINE"})];h.mountBindingNodes();
  const next=h.refresh();assert.equal(h.requests.length,3);
  h.requests[1].resolve({items:[teacher(undefined,{status:"paired",displayName:"舊學校私人LINE"})],students:[]});await old;
  assert.equal(h.state.teachers[0].email,"new@example.test");
  assert.doesNotMatch(h.nodes.get("teacherLineBinding_"+encodeURIComponent("new@example.test")).innerHTML,/舊學校/);
  h.requests[2].resolve({items:[teacher("new@example.test",{status:"paired",displayName:"新學校確認LINE"})],students:[]});await next;
  assert.match(h.nodes.get("teacherLineBinding_"+encodeURIComponent("new@example.test")).innerHTML,/新學校確認LINE/);
  h.state.me.role="parent";await h.refresh();assert.equal(h.requests.length,3);
});

test("the teacher status UI is requested through updated cache versions",()=>{
  assert.match(read("app/webview-guard.js"),/\/teacher-admin\.js\?v=20261127-admin-teacher-line-binding/);
  assert.match(read("app/index.html"),/webview-guard\.js\?v=[^"]*20261127-admin-teacher-line-binding/);
});
