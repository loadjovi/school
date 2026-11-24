import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../app/admin-attendance-assist.js",import.meta.url),"utf8");
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const students=[
 {studentId:"a-unbound",name:"A團未綁定學生",groupName:"A",section:"小提一部",instrument:"小提琴",status:"active"},
 {studentId:"a-other",name:"A團第二分部學生",groupName:"A",section:"中提部",instrument:"中提琴",status:"active"},
 {studentId:"b-one",name:"B團學生",groupName:"B",section:"小提一部",instrument:"小提琴",status:"active"},
 {studentId:"reserve",name:"儲備團學生",groupName:"儲備",section:"小提一部",status:"active"},
 {studentId:"c-one",name:"C團學生",groupName:"C",section:"小提一部",status:"active"},
 {studentId:"inactive",name:"已離團學生",groupName:"A",section:"小提一部",status:"inactive"}
];

function harness({role="admin",master=[],groupName="A",type="ensemble"}={}){
 const nodes=[],calls=[],toasts=[],values=new Map(),session=new Map([["school_context_id","school-a"],["role_context","schoolAdmin"]]);let epoch=0;
 const target={prepend(node){node.parentElement=this;if(!nodes.includes(node))nodes.push(node)}};
 const state={token:"current-token",page:"admin",adminWorkspaceSection:"attendance",adminAttendanceWorkspaceTask:"regular",
  me:{role,email:"dual-role@example.test",schoolId:"school-a",capabilities:{teacherSettings:true,ensemble:true}},master,
  students:[{studentId:"mapped-only",name:"老師原有對應學生"}],
  adminAttendanceAssist:{date:"2026-11-24",type,groupName,section:"小提一部",data:null,loading:false,error:""}};
 let respond=(url,options)=>url==="/api/student-master"?{items:students}:options.method==="POST"?{ok:true}:{items:[],recordedBy:"Roy Lin",recordedByRole:"admin"};
 const scope={state,render(){},esc:String,toast:message=>toasts.push(message),confirm:()=>true,setTimeout:()=>1,
  sessionStorage:{getItem:key=>session.get(key)||null},
  apiReadScope:()=>JSON.stringify([epoch,state.token,state.me?.email,state.me?.role,state.me?.schoolId,session.get("school_context_id")]),
  api:async(url,options={})=>{calls.push({url,options});if(options.method&&options.method!=="GET")epoch++;return respond(url,options)},
  document:{querySelector:selector=>[".main","#schoolAdminWorkspace .aw-attendance-assist-slot"].includes(selector)?target:null,
   getElementById:id=>values.get(id)||nodes.find(node=>node.id===id)||null,createElement:()=>({id:"",innerHTML:"",parentElement:null})}
 };
 scope.window=scope;runInNewContext(source,scope);scope.mountAdminAttendanceAssist();
 return {scope,state,calls,toasts,values,session,get html(){return nodes.find(node=>node.id==="adminAttendanceAssistRoot")?.innerHTML||""},
  respond:fn=>{respond=fn},bumpEpoch:()=>epoch++,load:()=>scope.adminAssistLoad(),save:()=>scope.adminAssistSave(),change:(field,value)=>scope.adminAssistChange(field,value)};
}

test("admin with teaching capabilities and empty startup master loads the full current A/B roster, including unmapped students",async()=>{
 for(const groupName of ["A","B"]){
  const h=harness({groupName});assert.equal(h.state.master.length,0);
  await h.load();
  assert.equal(h.calls[0].url,"/api/student-master");assert.equal(h.calls[0].options.cache,"no-store");
  assert.match(h.calls[1].url,new RegExp("/api/ensemble-attendance\\?sessionDate=2026-11-24&groupName="+groupName));
  assert.match(h.html,/Roy Lin/);assert.match(h.html,/行政協助/);assert.doesNotMatch(h.html,/目前條件沒有學生資料|admAtt_inactive|admAtt_mapped-only/);
  for(const student of students.filter(s=>s.status!=="inactive"))assert.equal(h.html.includes('id="admAtt_'+student.studentId+'"'),student.groupName===groupName);
  assert.equal(h.state.master.length,0,"proxy loading must not overwrite shared master/parent-link state");
 }
});

test("comprehensive attendance uses canonical active A/B/reserve roster, not teacher mappings or saved marks alone",async()=>{
 const h=harness({type:"comprehensive"});await h.load();
 assert.equal(h.calls[1].url,"/api/comprehensive-attendance?sessionDate=2026-11-24");
 for(const id of ["a-unbound","a-other","b-one","reserve"])assert.match(h.html,new RegExp('id="admAtt_'+id+'"'));
 assert.doesNotMatch(h.html,/admAtt_c-one|admAtt_inactive|admAtt_mapped-only/);
});

test("section API's merged roster remains authoritative and saved statuses are posted to the same existing endpoint",async()=>{
 const h=harness({type:"section"});
 h.respond((url,options)=>{
  if(url==="/api/student-master")return {items:students};
  if(options.method==="POST")return {ok:true};
  return {sessionDate:"2026-11-24",groupName:"A",section:"小提一部",roster:[students[0],students[1]],merges:[{sourceSection:"中提部"}],items:[{studentId:"a-other",status:"leave"}]};
 });
 await h.load();assert.match(h.html,/admAtt_a-other/);assert.match(h.html,/今日併班/);assert.match(h.html,/<option value="leave" selected>/);
 h.values.set("admAtt_a-unbound",{value:"late"});h.values.set("admAtt_a-other",{value:"leave"});await h.save();
 const writes=h.calls.filter(call=>call.options.method==="POST");assert.equal(writes.length,1);assert.equal(writes[0].url,"/api/section-attendance");
 assert.deepEqual(JSON.parse(writes[0].options.body),{sessionDate:"2026-11-24",groupName:"A",section:"小提一部",items:[{studentId:"a-unbound",status:"late",minutes:45},{studentId:"a-other",status:"leave",minutes:0}]});
 assert.equal(h.state.adminAttendanceAssist.saving,false);assert.equal(h.state.adminAttendanceAssist.loading,false);
 assert.equal(h.calls.filter(call=>call.url==="/api/student-master").length,2,"save reload captures the new post-write read epoch");
});

test("a missing or failed master read is a retryable load failure, never false empty attendance",async()=>{
 for(const invalid of [null,{wrong:[]}]){
  const h=harness();h.respond(()=>invalid);await h.load();
  assert.match(h.html,/載入失敗.*請重新載入/);assert.doesNotMatch(h.html,/目前條件沒有學生資料/);assert.equal(h.calls.length,1);assert.equal(h.state.adminAttendanceAssist.loading,false);
  await h.save();assert.equal(h.calls.length,1);assert.match(h.toasts.at(-1),/請先載入/);
 }
 const h=harness();h.respond(()=>{throw Error("HTTP 503")});await h.load();
 assert.match(h.html,/HTTP 503/);assert.equal(h.state.adminAttendanceAssist.loading,false);
 h.respond(url=>url==="/api/student-master"?{items:students}:{items:[]});await h.load();assert.match(h.html,/admAtt_a-unbound/);assert.equal(h.state.adminAttendanceAssist.error,"");
});

test("changing group rejects late roster reads and requires a fresh load before any save",async()=>{
 const h=harness(),old=deferred();h.respond(()=>old.promise);const pending=h.load();
 h.change("groupName","B");await h.save();assert.equal(h.calls.length,1);assert.match(h.toasts.at(-1),/請先載入/);
 old.resolve({items:students});await pending;assert.equal(h.calls.length,1,"stale A load must not issue attendance read for B");assert.equal(h.state.adminAttendanceAssist.data,null);
 h.respond(url=>url==="/api/student-master"?{items:students}:{items:[]});await h.load();assert.match(h.html,/admAtt_b-one/);assert.doesNotMatch(h.html,/admAtt_a-unbound/);
});

test("late attendance reads and errors cannot replace a newer group request, even after A/B/A changes",async()=>{
 for(const fail of [false,true]){
  const h=harness(),old=deferred();h.respond(url=>url==="/api/student-master"?{items:students}:old.promise);
  const first=h.load();await settle();h.change("groupName","B");h.change("groupName","A");
  h.respond(url=>url==="/api/student-master"?{items:[{...students[0],name:"最新名單"}]}:{items:[],recordedBy:"最新紀錄"});await h.load();
  if(fail)old.reject(Error("舊請求失敗"));else old.resolve({items:[],recordedBy:"舊紀錄"});await first;
  assert.match(h.html,/最新名單/);assert.match(h.html,/最新紀錄/);assert.doesNotMatch(h.html,/舊紀錄|舊請求失敗/);assert.equal(h.state.adminAttendanceAssist.loading,false);
 }
});

test("switching school or identity rejects pending results, clears reused editor and prevents stale saves",async()=>{
 for(const changeIdentity of [false,true]){
  const h=harness(),pendingRead=deferred();await h.load();assert.match(h.html,/admAtt_a-unbound/);
  h.respond(url=>url==="/api/student-master"?{items:students}:pendingRead.promise);const old=h.load();await settle();
  h.state.me={...h.state.me,schoolId:changeIdentity?"school-a":"school-b",email:changeIdentity?"other@example.test":h.state.me.email};
  if(!changeIdentity)h.session.set("school_context_id","school-b");
  h.scope.mountAdminAttendanceAssist();assert.doesNotMatch(h.html,/admAtt_a-unbound|Roy Lin/);
  pendingRead.resolve({items:[],recordedBy:"舊學校紀錄"});await old;await h.save();
  assert.equal(h.state.adminAttendanceAssist.data,null);assert.doesNotMatch(h.html,/舊學校紀錄/);assert.equal(h.calls.filter(call=>call.options.method==="POST").length,0);
 }
});

test("an unrelated write invalidates an in-flight read but leaves Load retryable instead of stuck disabled",async()=>{
 for(const stage of ["master","attendance"]){
  const h=harness(),old=deferred();h.respond(url=>stage==="master"||url!=="/api/student-master"?old.promise:{items:students});
  const loading=h.load();await settle();h.bumpEpoch();old.resolve(stage==="master"?{items:students}:{items:[],recordedBy:"過時資料"});await loading;
  assert.equal(h.state.adminAttendanceAssist.loading,false);assert.equal(h.state.adminAttendanceAssist.data,null);assert.match(h.html,/資料已更新.*重新載入/);assert.doesNotMatch(h.html,/過時資料/);
  h.respond(url=>url==="/api/student-master"?{items:students}:{items:[]});await h.load();assert.match(h.html,/admAtt_a-unbound/);
 }
});

test("saving locks course selection and reloads only the same scoped editor after the POST finishes",async()=>{
 const h=harness(),write=deferred();await h.load();h.respond((url,options)=>options.method==="POST"?write.promise:url==="/api/student-master"?{items:students}:{items:[]});
 const saving=h.save();assert.equal(h.state.adminAttendanceAssist.saving,true);h.change("groupName","B");assert.equal(h.state.adminAttendanceAssist.groupName,"A");
 assert.match(h.html,/onchange="adminAssistChange\('groupName',this.value\)" disabled/);
 write.resolve({ok:true});await saving;assert.equal(h.state.adminAttendanceAssist.saving,false);assert.match(h.html,/admAtt_a-unbound/);
 h.change("groupName","B");assert.equal(h.state.adminAttendanceAssist.groupName,"B");
});

test("failed saves preserve edited marks for retry without presenting them as already saved",async()=>{
 const h=harness();await h.load();
 h.values.set("admAtt_a-unbound",{value:"absent"});h.values.set("admAtt_a-other",{value:"late"});
 h.respond((url,options)=>{if(options.method==="POST")throw Error("HTTP 503");return url==="/api/student-master"?{items:students}:{items:[]}});
 await h.save();assert.equal(h.state.adminAttendanceAssist.saving,false);assert.match(h.toasts.at(-1),/HTTP 503/);
 assert.match(h.html,/id="admAtt_a-unbound"[\s\S]*?<option value="absent" selected>/);
 assert.match(h.html,/id="admAtt_a-other"[\s\S]*?<option value="late" selected>/);
 assert.match(h.html,/0\/2 人/);assert.doesNotMatch(h.html,/此分部已完成點名/);
 h.respond((url,options)=>options.method==="POST"?{ok:true}:url==="/api/student-master"?{items:students}:{items:[]});await h.save();
 const writes=h.calls.filter(call=>call.options.method==="POST");assert.equal(writes.length,2);assert.equal(writes[1].options.body,writes[0].options.body);
});

test("switching school during a save never refreshes or mutates the new school's editor",async()=>{
 const h=harness(),write=deferred();await h.load();h.respond((url,options)=>options.method==="POST"?write.promise:url==="/api/student-master"?{items:students}:{items:[]});
 const saving=h.save(),before=h.calls.length;
 h.state.me={...h.state.me,schoolId:"school-b"};h.session.set("school_context_id","school-b");h.scope.mountAdminAttendanceAssist();
 write.resolve({ok:true});await saving;assert.equal(h.calls.length,before);assert.equal(h.state.adminAttendanceAssist.data,null);assert.equal(h.state.adminAttendanceAssist.saving,false);assert.doesNotMatch(h.html,/admAtt_a-unbound|Roy Lin/);
});

test("ordinary teacher role cannot invoke administrator master loading or proxy writes",async()=>{
 const h=harness({role:"teacher",master:students});await h.load();await h.save();h.change("groupName","B");
 assert.equal(h.calls.length,0);assert.equal(h.html,"");assert.equal(h.state.adminAttendanceAssist.groupName,"A");
});
