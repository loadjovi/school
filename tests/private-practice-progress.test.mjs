import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createHash} from "node:crypto";
import * as practiceRules from "../api/src/lib/practiceRecords.js";
import * as goalRules from "../api/src/lib/musicLearningGoals.mjs";
import {privatePracticeProgress} from "../api/src/lib/privatePracticeProgress.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8"),strip=s=>s.replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
const teacher="teacher@example.test",goal="第 12～34 小節換把練習",day="2026-11-22";
function harness(){
 const stores=new Map(),handlers={},pushes=[],mails=[],lookups=[];let school="school-a",role="parent",privateAccess=true,activeTeacher=true,assigned=true,bound=true,lineFail=false,mailFail=false,race=false,revision=0,onDeliveryClaim=null;
 const error=code=>Object.assign(Error(String(code)),{statusCode:code}),key=(p,r)=>p+"|"+r;
 const rows=name=>{if(!stores.has(name))stores.set(name,new Map());return stores.get(name)};
 const put=(name,row)=>{const saved={...row,etag:"v"+(++revision)};rows(name).set(key(row.partitionKey,row.rowKey),saved);return saved};
 const db=name=>({createTable:async()=>{},getEntity:async(p,r)=>{const row=rows(name).get(key(p,r));if(!row)throw error(404);return structuredClone(row)},
  createEntity:async row=>{if(rows(name).has(key(row.partitionKey,row.rowKey)))throw error(409);put(name,row);if(name==="TenantNotificationDelivery"&&onDeliveryClaim)onDeliveryClaim();if(name==="tenantPractice"&&race){race=false;throw error(409)}},
  updateEntity:async(row,mode,options)=>{const old=rows(name).get(key(row.partitionKey,row.rowKey));if(!old)throw error(404);if(options?.etag&&options.etag!==old.etag)throw error(412);put(name,mode==="Merge"?{...old,...row}:row)},deleteEntity:async(p,r)=>rows(name).delete(key(p,r))});
 const partition=(s,id)=>s+"|student|"+id,aliases=id=>["student1","old-id"].includes(id)?["student1","old-id"]:[id];
 const access=()=>({role,email:role==="parent"?"parent@example.test":teacher,capabilities:{private:role!=="parent"&&privateAccess,privateOnly:true},privateStudentIds:["student1"]});
 const scope={...practiceRules,...goalRules,privatePracticeProgress,createHash,URL,process:{env:{LAB_ENVIRONMENT:"functional-uat",STORAGE_CONNECTION_STRING:"test"}},console:{error(){}},
  app:{http:(name,config)=>{handlers[name]=config.handler}},getTenantContext:async()=>({schoolId:school,access:access()}),json:(jsonBody,status=200)=>({status,jsonBody}),ensureStudentAccess:(a,id)=>["student1","old-id"].includes(id),ensurePrivateAccess:(a,id)=>a.role==="admin"||a.capabilities.private&&a.privateStudentIds.includes(id),getStudentIdAliases:async id=>aliases(id),tenantStudentPartition:partition,ensureTenantTables:async()=>{},table:db,activityStudentId:row=>row.studentId,
  listByStudent:async(_name,id,start,end,s)=>[...rows("tenantPractice").values()].filter(row=>row.partitionKey===partition(s,id)&&(!start||row.eventDate>=start)&&(!end||row.eventDate<=end)),
  getTeacherDirectory:async()=>({status:activeTeacher?"active":"inactive"}),getTeacherProfile:async()=>({privateStudentIds:JSON.stringify(assigned?["old-id"]:[])}),getStudentMaster:async()=>({studentName:"甲同學",status:"active"}),
  TableClient:{fromConnectionString:(_connection,name)=>db(name)},tenantEmailAddress:email=>String(email).includes("@")?email:"",tenantEmailConfig:()=>({connectionString:"test",senderAddress:"test@example.test"}),getTenantLineParentContact:async()=>null,
  resolveTenantLineChannel:async s=>({loginConfigured:true,botUserId:"bot-"+s,accessToken:"token-"+s}),getTenantLineRecipient:async(s,email,bot)=>{lookups.push({s,email,bot});return bound?{lineUserId:"user-"+s}:null},pushLineMessage:async(user,text,options)=>{if(lineFail)throw error(400);pushes.push({user,text,options})},
  EmailClient:class{async beginSend(input){if(mailFail)throw error(400);mails.push(input);return {}}}
 };
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/labNoticeDelivery.mjs")).replace('const buildEnablesLineFirstLab = false;','const buildEnablesLineFirstLab = true;')+';({lineFirstLabEnabled,deliverLabNotice,labNoticeLineResult,labNoticeUrl})',{...scope}));
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/privatePracticeNotification.js"))+';({notifyPrivatePractice})',{...scope}));
 for(const file of ["practice","privateLessonPractice"])runInNewContext(strip(read('api/src/functions/'+file+'.js')),{...scope});
 const lesson=(extra={},s=school)=>put("tenantPrivateLesson",{partitionKey:partition(s,"student1"),rowKey:"lesson1",studentId:"student1",teacher,eventDate:"2026-11-19",status:"teacher_completed",weeklyPracticeGoalsJson:JSON.stringify(["音階",goal]),...extra});lesson();
 const input=(extra={})=>({studentId:"student1",practiceDate:day,startTime:"18:00",endTime:"18:20",practiceContent:"有練習："+goal,focus:"個課老師建議",parentConfirmed:true,weeklyGoal:{lessonId:"lesson1",index:1,text:goal},...extra});
 const post=(body=input())=>handlers.practice({method:"POST",json:async()=>body});
 const progress=(studentId="student1",lessonId="lesson1")=>handlers.privateLessonPractice({query:new URLSearchParams({studentId,lessonId})});
 return {...scope,rows,put,partition,lesson,input,post,progress,pushes,mails,lookups,setSchool:v=>{school=v},setRole:v=>{role=v},setPrivate:v=>{privateAccess=v},setActive:v=>{activeTeacher=v},setAssigned:v=>{assigned=v},setBound:v=>{bound=v},setLineFail:v=>{lineFail=v},setMailFail:v=>{mailFail=v},setRace:()=>{race=true},onDeliveryClaim:fn=>{onDeliveryClaim=fn}};
}
test("a saved linked practice notifies only its assigned private teacher via the school's LINE and repeated submissions do not notify twice",async()=>{
 const h=harness(),body=h.input();body.weeklyGoal.teacher="attacker@example.test";
 const result=await h.post(body);assert.equal(result.status,201);assert.equal(result.jsonBody.practiceNotification.status,"accepted");assert.equal(h.pushes.length,1);assert.equal(h.mails.length,0);assert.equal(h.lookups[0].email,teacher);assert.equal(h.lookups[0].bot,"bot-school-a");assert.equal(h.pushes[0].options.accessToken,"token-school-a");assert.match(h.pushes[0].text,/甲同學[\s\S]*2026-11-22｜練習 20 分鐘[\s\S]*有練習：第 12～34 小節換把練習/);assert.match(h.pushes[0].text,/practiceLesson=lesson1/);assert.match(h.pushes[0].text,/practiceStudent=student1/);
 const record=[...h.rows("tenantPractice").values()][0];assert.equal(record.weeklyGoalTeacher,teacher);assert.equal(record.weeklyGoalIndex,1);assert.equal(record.weeklyGoalText,goal);
 assert.equal((await h.post(body)).jsonBody.duplicate,true);assert.equal(h.pushes.length,1);assert.equal(h.rows("tenantPractice").size,1);
 h.setRole("privateTeacher");const progress=await h.progress();assert.equal(progress.status,200);assert.equal(progress.jsonBody.goals[1].practiceCount,1);assert.equal(progress.jsonBody.goals[1].minutes,20);assert.equal(progress.jsonBody.lastPracticeDate,day);
});
test("LINE-unbound teachers receive fallback email, while delivery failures cannot roll back a practice record",async()=>{
 const h=harness();h.setBound(false);const result=await h.post();assert.equal(result.status,201);assert.equal(result.jsonBody.practiceNotification.status,"email_sent");assert.equal(h.pushes.length,0);assert.equal(h.mails.length,1);assert.equal(h.mails[0].recipients.to[0].address,teacher);
 const f=harness();f.setLineFail(true);f.setMailFail(true);assert.equal((await f.post()).status,201);assert.equal(f.rows("tenantPractice").size,1);f.setLineFail(false);f.setMailFail(false);assert.equal((await f.post()).jsonBody.duplicate,true);assert.equal(f.pushes.length,1);assert.equal(f.rows("tenantPractice").size,1);
});
test("no goal, inactive teachers, removed assignments and deleted sessions never notify an unrelated person",async()=>{
 const plain=harness();await plain.post(plain.input({weeklyGoal:null}));assert.equal(plain.pushes.length,0);assert.equal(plain.mails.length,0);
 for(const mode of ["setActive","setAssigned"]){const h=harness();h[mode](false);assert.equal((await h.post()).status,201);assert.equal(h.pushes.length,0);assert.equal(h.mails.length,0)}
 const h=harness();await h.post();const record=[...h.rows("tenantPractice").values()][0];h.rows("tenantPractice").clear();assert.equal((await h.notifyPrivatePractice("school-a",record)).status,"ineligible");assert.equal(h.pushes.length,1);
});
test("stale advice, future practice, unpublished and foreign lesson references are rejected before recording or notifying",async()=>{
 const scenarios=[{body:{weeklyGoal:{lessonId:"other",index:1,text:goal}}},{body:{weeklyGoal:{lessonId:"lesson1",index:1,text:"老師已改過的舊內容"}}},{body:{practiceDate:"2026-12-05"}},{body:{practiceDate:"2026-11-18"}},{lesson:{status:"scheduled"}}];
 for(const scenario of scenarios){const h=harness();if(scenario.lesson)h.lesson(scenario.lesson);const result=await h.post(h.input(scenario.body));assert.ok([400,409].includes(result.status));assert.equal(h.rows("tenantPractice").size,0);assert.equal(h.pushes.length,0)}
});
test("private-only teachers can read their own assigned lesson progress but not another teacher, child or school",async()=>{
 const h=harness();await h.post();h.setRole("privateTeacher");assert.equal((await h.progress()).status,200);assert.equal((await h.progress("old-id")).status,200);assert.equal((await h.progress("unassigned")).status,403);
 h.lesson({teacher:"other@example.test"});assert.equal((await h.progress()).status,404);h.lesson();h.setSchool("school-b");assert.equal((await h.progress()).status,404);h.setSchool("school-a");h.setRole("parent");assert.equal((await h.progress()).status,403);h.setRole("privateTeacher");h.setPrivate(false);assert.equal((await h.progress()).status,403);
});
test("identical IDs from different schools use separate records, notifications, teacher bindings and progress",async()=>{
 const h=harness();await h.post();h.setSchool("school-b");h.lesson();await h.post();assert.equal(h.pushes.length,2);assert.notEqual(h.pushes[0].options.retryKey,h.pushes[1].options.retryKey);assert.equal(h.pushes[1].user,"user-school-b");assert.match(h.pushes[1].text,/schoolId=school-b/);assert.equal(h.lookups[1].bot,"bot-school-b");h.setRole("privateTeacher");assert.equal((await h.progress()).jsonBody.totalSessions,1);
});
test("an alias or storage race keeps one practice and one notification, while the original twenty-minute scoring rule stays unchanged",async()=>{
 const h=harness();h.setRace();const first=await h.post(h.input({studentId:"old-id",endTime:"18:08"}));assert.equal(first.jsonBody.duplicate,true);assert.equal(h.rows("tenantPractice").size,1);assert.equal(h.pushes.length,1);
 const later=await h.post(h.input({startTime:"19:00",endTime:"19:12"}));assert.equal(later.jsonBody.dailyMinutes,20);assert.equal(later.jsonBody.qualified,true);assert.equal(h.rows("tenantPractice").size,2);h.setRole("privateTeacher");assert.equal((await h.progress()).jsonBody.totalMinutes,20);
});
test("edited goals retain old practice snapshots without crediting a newly rewritten assignment",async()=>{
 const h=harness();await h.post();h.lesson({weeklyPracticeGoalsJson:JSON.stringify(["音階","新練習內容"])});h.setRole("privateTeacher");let result=await h.progress();assert.equal(result.jsonBody.goals[1].practiceCount,0);assert.equal(result.jsonBody.records[0].goalText,goal);assert.equal(result.jsonBody.totalSessions,1);
 h.rows("tenantPractice").clear();result=await h.progress();assert.equal(result.jsonBody.totalSessions,0);
});
const front=read("app/private-lesson-confirmation.js");
test("choosing a goal fills the check-in text and category, preserves parent's notes, and does not mark practice until submission",()=>{
 const content={value:"今天用慢速練習",dataset:{}},focus={value:"節奏／視奏",dataset:{},options:[{value:"節奏／視奏"}],append(option){this.options.push(option)}},hint={hidden:true,textContent:""},scope={window:{},document:{getElementById:id=>({pContent:content,pFocus:focus,practiceGoalSelection:hint})[id],createElement:()=>({})}};
 const start=front.indexOf("  window.selectWeeklyPracticeGoal="),end=front.indexOf("  function learningJourneyParentPanel",start);runInNewContext(front.slice(start,end),scope);
 const choose=text=>scope.window.selectWeeklyPracticeGoal({dataset:text?{goalText:text}:{}});
 choose(goal);assert.equal(content.value,"有練習："+goal+"\n今天用慢速練習");assert.equal(focus.value,"個課老師建議");assert.equal(hint.hidden,false);assert.match(hint.textContent,/送出打卡後才記錄/);
 choose("音階");assert.equal(content.value,"有練習：音階\n今天用慢速練習");choose("");assert.equal(content.value,"今天用慢速練習");assert.equal(focus.value,"節奏／視奏");assert.equal(hint.hidden,true);
});
test("teacher progress refresh updates only its panel, escapes parent text and never redraws unsaved lesson edits",async()=>{
 const body={textContent:"",innerHTML:""},detail={open:true,dataset:{},isConnected:true,querySelector:()=>body},calls=[],scope={window:{},state:{me:{schoolId:"school-a",email:teacher}},api:async url=>{calls.push(url);return {totalSessions:1,totalMinutes:8,goals:[{text:"<img>換把",practiceCount:1,minutes:8,lastPracticeDate:day}],records:[{practiceDate:day,minutes:8,goalText:goal,practiceContent:"<script>家長備註"}]}},esc:value=>String(value??"").replaceAll("<","&lt;").replaceAll(">","&gt;")};
 const start=front.indexOf("  window.loadPrivateGoalPractice="),end=front.indexOf("  function teacherLessonHeader",start);runInNewContext(front.slice(start,end),scope);await scope.window.loadPrivateGoalPractice(detail,"student1","lesson1");assert.equal(calls.length,1);assert.match(body.innerHTML,/8 分鐘/);assert.match(body.innerHTML,/&lt;img&gt;/);assert.doesNotMatch(body.innerHTML,/<img>|<script>/);assert.match(calls[0],/studentId=student1&lessonId=lesson1/);await scope.window.loadPrivateGoalPractice(detail,"student1","lesson1");assert.equal(calls.length,1);await scope.window.loadPrivateGoalPractice(detail,"student1","lesson1",true);assert.equal(calls.length,2);
});

test("practice POST remains parent-only and rejects another child before saving or notifying",async()=>{
 const h=harness();h.setRole("privateTeacher");assert.equal((await h.post()).status,403);h.setRole("parent");assert.equal((await h.post(h.input({studentId:"another-child"}))).status,403);assert.equal(h.rows("tenantPractice").size,0);assert.equal(h.pushes.length,0);
});
test("cross-school notice calls and assignments revoked during delivery never send student details",async()=>{
 const h=harness();await h.post();const record=[...h.rows("tenantPractice").values()][0];h.setSchool("school-b");h.lesson();assert.equal((await h.notifyPrivatePractice("school-b",record)).status,"ineligible");assert.equal(h.pushes.length,1);
 const revoked=harness();revoked.onDeliveryClaim(()=>revoked.setAssigned(false));assert.equal((await revoked.post()).status,201);assert.equal(revoked.pushes.length,0);assert.equal(revoked.mails.length,0);
 const changed=harness();changed.onDeliveryClaim(()=>changed.lesson({teacher:"different@example.test"}));await changed.post();assert.equal(changed.pushes.length,0);assert.equal(changed.mails.length,0);
});
test("teacher practice responses cannot populate a different account or school's open screen",async()=>{
 const body={textContent:"",innerHTML:""},details={open:true,dataset:{},isConnected:true,querySelector:()=>body},state={me:{schoolId:"school-a",email:teacher}};let resolve;
 const scope={window:{},state,api:()=>new Promise(r=>{resolve=r}),esc:String};const start=front.indexOf("  window.loadPrivateGoalPractice="),end=front.indexOf("  function teacherLessonHeader",start);runInNewContext(front.slice(start,end),scope);
 const pending=scope.window.loadPrivateGoalPractice(details,"student1","lesson1");state.me.schoolId="school-b";resolve({totalSessions:1,totalMinutes:20,goals:[{text:"private detail"}]});await pending;assert.equal(body.innerHTML,"");assert.equal(details.dataset.loaded,undefined);
});
test("notification links wait for role modules and open only the server-authorized student's exact lesson",async()=>{
 const start=front.indexOf('  if(teacherAccount()&&typeof location!=="undefined"){'),code=front.slice(start,front.lastIndexOf("})();"));
 async function open({rows=[{lessonId:"lesson1",studentId:"student1"}],switchSchool=false,teacherAccount=true}={}){
  let ready;const state={me:{schoolId:"school-a",email:teacher},privateLessons:rows},calls=[],details={open:false,scrollIntoView:()=>calls.push("scroll")},scope={state,URLSearchParams,location:{search:"?practiceLesson=lesson1&practiceStudent=student1"},teacherAccount:()=>teacherAccount,window:{ensureRoleModules:()=>new Promise(resolve=>{ready=resolve}),loadPrivateGoalPractice:(_d,student,lesson)=>calls.push([student,lesson])},go:async page=>calls.push(page),render:()=>calls.push("render"),lessonDomKey:String,document:{getElementById:()=>details},setTimeout:fn=>fn(),toast:message=>{throw Error(message)}};
  runInNewContext(code,scope);assert.deepEqual(calls,[]);if(switchSchool)state.me.schoolId="school-b";ready?.();await new Promise(resolve=>setImmediate(resolve));return {state,calls,details};
 }
 const valid=await open();assert.equal(valid.state.expandedPrivateLessonId,"lesson1");assert.equal(valid.details.open,true);assert.deepEqual(valid.calls,["private","render",["student1","lesson1"],"scroll"]);
 const other=await open({rows:[{lessonId:"lesson1",studentId:"other-child"}]});assert.deepEqual(other.calls,["private"]);assert.equal(other.details.open,false);
 assert.deepEqual((await open({switchSchool:true})).calls,[]);assert.deepEqual((await open({teacherAccount:false})).calls,[]);
});
