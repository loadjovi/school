import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { isPrivateOnlyTeacher, teacherCourseAccess } from "../src/lib/teacherAccountType.js";

const profile={sectionAssignments:[],ensembleGroups:[],comprehensiveEnabled:false,privateStudentIds:["student-1"]};

test("private students and missing section selections do not make a general teacher private-only",()=>{
  const general=teacherCourseAccess({teacherName:"Roy"},profile);
  assert.equal(isPrivateOnlyTeacher({teacherName:"Roy"}),false);
  assert.equal(general.role,"teacher");
  assert.equal(general.privateOnly,false);
  assert.deepEqual(general.privateStudentIds,["student-1"]);
  const limited=teacherCourseAccess({privateOnly:true},{...profile,sectionAssignments:[{groupName:"B",section:"小提一部"}],ensembleGroups:["B"],comprehensiveEnabled:true});
  assert.equal(limited.role,"privateTeacher");
  assert.deepEqual(limited.sectionAssignments,[]);
  assert.deepEqual(limited.ensembleGroups,[]);
  assert.equal(limited.comprehensiveEnabled,false);
});

test("school admin sees explicit account type and can restrict an existing general teacher",async()=>{
  const handlers={},directory=[{rowKey:"roy@example.org",teacherName:"Roy",status:"active"}],saved=[];
  const student={rowKey:"student-1",studentName:"學生甲",status:"active"};
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getTenantContext:async()=>({access:{role:"admin",email:"admin@example.org"},schoolId:"school-a"}),json:(body,status=200)=>({status,jsonBody:body}),isPrivateOnlyTeacher,listActivityRange:async()=>[],listTeacherDirectory:async()=>directory,getTeacherProfile:async()=>({sectionAssignments:"[]",ensembleGroups:"[]",privateStudentIds:'["student-1"]',comprehensiveEnabled:false}),listStudentMaster:async()=>[student],saveTeacherDirectory:async(email,data)=>{saved.push({email,...data});return {rowKey:email,...data}},saveTeacherProfile:async(email,data)=>{saved.push({email,profile:data})},getTenantDirectory:async()=>null,sendTeacherAccessEnabledEmail:async()=>({status:"sent"}),process:{env:{}},URL};
  const source=readFileSync(new URL("../src/functions/teacherDirectory.js",import.meta.url),"utf8");
  runInNewContext(source.slice(source.indexOf("function clean(")),context);
  const get=await handlers.teacherDirectory({method:"GET"});
  assert.equal(get.jsonBody.items[0].privateOnly,false);
  assert.equal(get.jsonBody.items[0].accountTypeUnspecified,true);
  const request=(privateOnly,privateStudentIds)=>({method:"PATCH",json:async()=>({email:"roy@example.org",teacherName:"Roy",privateOnly,privateStudentIds})});
  const invalid=await handlers.teacherDirectory(request(true,[]));
  assert.equal(invalid.status,400);
  assert.equal(saved.length,0);
  const limited=await handlers.teacherDirectory(request(true,["student-1"]));
  assert.equal(limited.status,200);
  assert.equal(saved[0].privateOnly,true);
  assert.equal(saved[1].profile.sectionAssignments.length,0);
  assert.equal(saved[1].profile.comprehensiveEnabled,false);
  await handlers.teacherDirectory(request(false,[]));
  assert.equal(saved[2].privateOnly,false);
});

test("private-only teacher can see assigned students but cannot edit their scope",async()=>{
  const handlers={},saved=[],students=[{rowKey:"student-1",studentName:"學生甲"},{rowKey:"student-2",studentName:"學生乙"}];
  let access={role:"privateTeacher",email:"private@example.org",capabilities:{teacherSettings:true,privateOnly:true},students:[{studentId:"student-1"}]};
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getTenantContext:async()=>({access,schoolId:"school-a"}),json:(body,status=200)=>({status,jsonBody:body}),getTeacherProfile:async()=>({sectionAssignments:'[{"groupName":"B","section":"中提"}]',ensembleGroups:'["B"]',comprehensiveEnabled:true,privateStudentIds:'["student-1"]'}),listStudentMaster:async()=>students,saveTeacherProfile:async(...args)=>saved.push(args),Set};
  const source=readFileSync(new URL("../src/functions/teacherProfile.js",import.meta.url),"utf8");
  runInNewContext(source.slice(source.indexOf("const allowedGroups=")),context);
  const get=await handlers.teacherProfile({method:"GET"});
  assert.deepEqual(Array.from(get.jsonBody.students,x=>x.studentId),["student-1"]);
  assert.equal(get.jsonBody.profile.privateOnly,true);
  assert.equal(get.jsonBody.profile.sectionAssignments.length,0);
  assert.equal(get.jsonBody.profile.ensembleGroups.length,0);
  assert.equal(get.jsonBody.profile.comprehensiveEnabled,false);
  assert.equal(get.jsonBody.schedule,undefined);
  const patch=await handlers.teacherProfile({method:"PATCH",json:async()=>({sectionAssignments:[{groupName:"B",section:"中提"}],privateStudentIds:["student-1","student-2"]})});
  assert.equal(patch.status,403);
  assert.equal(saved.length,0);
  access={...access,role:"teacher",capabilities:{teacherSettings:true,privateOnly:false}};
  const general=await handlers.teacherProfile({method:"GET"});
  assert.equal(general.jsonBody.students.length,2);
  assert.equal(general.jsonBody.profile.sectionAssignments.length,1);
  const generalUpdate=await handlers.teacherProfile({method:"PATCH",json:async()=>({sectionAssignments:[{groupName:"B",section:"中提"}],ensembleGroups:[],comprehensiveEnabled:false,privateStudentIds:["student-1"]})});
  assert.equal(generalUpdate.status,200);
  assert.equal(saved.length,1);
});

test("school admin card labels a general teacher with only private students correctly",()=>{
  const state={me:{role:"admin"},teachers:[{email:"roy@example.org",teacherName:"Roy",status:"active",sectionAssignments:[],ensembleGroups:[],privateStudentIds:["student-1"],privateOnly:false}],teacherStudents:[{studentId:"student-1",name:"學生甲",groupName:"B",instrument:"小提琴"}]};
  const context={state,window:null,loadAdmin:async()=>{},adminPage:()=>"",render:()=>{},api:async()=>({items:[],students:[]}),esc:value=>String(value),$:()=>null};context.window=context;
  const source=readFileSync(new URL("../../app/teacher-admin.js",import.meta.url),"utf8");
  runInNewContext(source,context);
  state.teacherAdminOpen=true;
  const html=context.adminPage();
  assert.match(html,/一般老師/);
  assert.match(html,/個別課 1 人/);
  assert.doesNotMatch(html,/Roy<\/b> <span class="badge warn">個課限定/);
});

test("private-only attendance report does not load or expose group lessons",async()=>{
  const handlers={},calls=[];
  const access={role:"privateTeacher",email:"private@example.org",capabilities:{teacherSettings:true,privateOnly:true},students:[{studentId:"student-1",name:"學生甲",groupName:"B",section:"中提"}]};
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getTenantContext:async()=>({access,schoolId:"school-a"}),json:(body,status=200)=>({status,jsonBody:body}),ensureTenantTables:async()=>{},getTeacherProfile:async()=>({comprehensiveEnabled:true}),getStudentAliasInfo:async id=>({canonicalStudentId:id}),activityStudentId:row=>row.studentId,listActivityRange:async key=>{calls.push(key);return [{studentId:"student-1",eventDate:"2026-10-01",groupName:"B",section:"中提",classType:key,status:"present",teacher:"private@example.org",sessionId:"lesson-1",createdAt:"2026-10-01T08:00:00Z",rowKey:"row-1"}]},Map,Set,Date};
  const source=readFileSync(new URL("../src/functions/attendanceReport.js",import.meta.url),"utf8");
  runInNewContext(source.slice(source.indexOf("function clean(")),context);
  const result=await handlers.attendanceReport({query:new URLSearchParams({month:"2026-10"})});
  assert.equal(result.status,200);
  assert.deepEqual(calls,["privateLesson"]);
  assert.deepEqual(Array.from(result.jsonBody.records,x=>x.classType),["privateLesson"]);
  assert.equal(result.jsonBody.items[0].sectionStats.total,0);
});

test("directory updates preserve an explicit private-only type unless the admin changes it",async()=>{
  let stored={createdAt:"2026-09-01T00:00:00Z",lastLoginAt:"2026-10-01T00:00:00Z",privateOnly:true};
  const client={getEntity:async()=>stored,upsertEntity:async entity=>{stored=entity}};
  const context={ensureTenantTables:async()=>{},teacherEmail:email=>email.toLowerCase(),tenantSchoolPartition:id=>id,table:()=>client,defaultTenantId:()=>"school-a",Date};
  const source=readFileSync(new URL("../src/lib/storage.js",import.meta.url),"utf8");
  const start=source.indexOf("export async function saveTeacherDirectory("),end=source.indexOf("export async function touchTeacherLastLogin(");
  runInNewContext(source.slice(start,end).replace("export ",""),context);
  await context.saveTeacherDirectory("teacher@example.org",{teacherName:"王老師",status:"active"},"school-a");
  assert.equal(stored.privateOnly,true);
  assert.equal(stored.lastLoginAt,"2026-10-01T00:00:00Z");
  await context.saveTeacherDirectory("teacher@example.org",{teacherName:"王老師",status:"active",privateOnly:false},"school-a");
  assert.equal(stored.privateOnly,false);
});

test("private-only teacher receives no group class schedule",async()=>{
  const handlers={};
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getTenantContext:async()=>({access:{role:"privateTeacher",capabilities:{privateOnly:true}},schoolId:"school-a"}),ensureTenantTables:async()=>{},getScheduleState:async()=>({status:"active"}),resolveSchoolCourses:async()=>{throw Error("group schedule must not be loaded")},listSchedules:async()=>{throw Error("group schedule must not be loaded")},json:(body,status=200)=>({status,jsonBody:body})};
  const source=readFileSync(new URL("../src/functions/schoolSchedule.js",import.meta.url),"utf8");
  runInNewContext(source.slice(source.indexOf('app.http("schoolSchedule"'),source.lastIndexOf("export {")),context);
  const dated=await handlers.schoolSchedule({method:"GET",query:new URLSearchParams({date:"2026-10-02"})});
  assert.equal(dated.status,200);
  assert.deepEqual(Array.from(dated.jsonBody.items),[]);
  const all=await handlers.schoolSchedule({method:"GET",query:new URLSearchParams()});
  assert.deepEqual(Array.from(all.jsonBody.items),[]);
});

test("teacher settings show group options to a general teacher and only assigned students to private-only",()=>{
  const app={innerHTML:""},state={me:{role:"teacher",capabilities:{teacherSettings:true,privateOnly:false}},page:"teacherSettings",teacherSetup:{profile,students:[{studentId:"student-1",name:"學生甲"}],choices:{groups:["B"],sections:["中提"]},schedule:{B:["週二"]}}};
  const context={state,window:null,roleText:()=>"老師",nav:()=>"",render:()=>{},go:async()=>{},shell:x=>x,esc:v=>String(v),document:{getElementById:()=>app,querySelectorAll:()=>[]},$:()=>null,toast:()=>{}};context.window=context;context.__roleModuleBootstrap=true;
  const source=readFileSync(new URL("../../app/teacher-settings.js",import.meta.url),"utf8");
  runInNewContext(source,context);
  context.render();
  assert.match(app.innerHTML,/B團分部課/);
  assert.match(app.innerHTML,/儲存分部／合奏／綜合課設定/);
  state.me={role:"privateTeacher",capabilities:{teacherSettings:true,privateOnly:true}};
  context.render();
  assert.match(app.innerHTML,/個課限定老師/);
  assert.match(app.innerHTML,/學生甲/);
  assert.doesNotMatch(app.innerHTML,/B團分部課/);
});
