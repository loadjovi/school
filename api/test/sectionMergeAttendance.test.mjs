import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("receiving teacher takes both rosters while each student retains the original section",async()=>{
  const handlers={},saved=[];
  const master=[
    {rowKey:"source",studentName:"甲",groupName:"A",section:"小提一部",status:"active"},
    {rowKey:"target",studentName:"乙",groupName:"A",section:"小提二部",status:"active"}
  ];
  const merge={mergeId:"merge-1",sessionDate:"2026-09-29",groupName:"A",sourceSection:"小提一部",targetSection:"小提二部",receivingTeacherEmail:"receiver@example.org",receivingTeacherName:"接課老師",status:"active"};
  let access={role:"sectionTeacher",email:"receiver@example.org",displayName:"接課老師",capabilities:{section:true},sectionAssignments:[{groupName:"A",section:"小提二部"}]};
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getTenantContext:async()=>({access,schoolId:"school"}),ensureSectionAccess:(a,x)=>a.role==="admin"||a.sectionAssignments.some(v=>v.groupName===x.groupName&&v.section===x.section),ensureTemporaryCourseAccess:()=>true,json:(body,status=200)=>({status,jsonBody:body}),ensureTenantTables:async()=>{},table:()=>({listEntities:async function*(){},createEntity:async x=>{saved.push(x)}}),rowKey:()=>`row-${saved.length}`,getStudentMaster:async id=>master.find(x=>x.rowKey===id),listStudentMaster:async()=>master,tenantStudentPartition:(_,id)=>`school|student|${id}`,listActivityRange:async()=>saved,activityStudentId:x=>x.studentId,enforceScheduledCourse:async()=>({enforced:true,allowed:true}),listSectionMerges:async()=>[merge],receivingMerges:(items,date,group,section,email)=>items.filter(x=>x.sessionDate===date&&x.groupName===group&&x.targetSection===section&&x.receivingTeacherEmail===email),validMergeDate:date=>/^\d{4}-\d{2}-\d{2}$/.test(date)};
  const src=readFileSync(new URL("../src/functions/sectionAttendance.js",import.meta.url),"utf8");
  runInNewContext(src.slice(src.indexOf("const safe=")),context);
  const request=(method,section,items)=>({method,query:new URLSearchParams({sessionDate:"2026-09-29",groupName:"A",section}),json:async()=>({sessionDate:"2026-09-29",groupName:"A",section,items})});
  const first=await handlers.sectionAttendance(request("GET","小提二部"));
  assert.equal(first.status,200);assert.deepEqual(Array.from(first.jsonBody.roster,x=>x.studentId),["source","target"]);
  const post=await handlers.sectionAttendance(request("POST","小提二部",[{studentId:"source",status:"present"},{studentId:"target",status:"late"}]));
  assert.equal(post.status,200);assert.equal(saved.length,2);
  assert.equal(saved[0].section,"小提一部");assert.equal(saved[0].mergeTargetSection,"小提二部");assert.equal(saved[0].mergeTeacherEmail,"receiver@example.org");
  assert.equal(saved[1].section,"小提二部");assert.equal(saved[1].mergeTargetSection,undefined);
  assert.equal((await handlers.sectionAttendance(request("GET","小提二部"))).jsonBody.items.length,2);
  access={...access,email:"absent@example.org",sectionAssignments:[{groupName:"A",section:"小提一部"}]};
  assert.equal((await handlers.sectionAttendance(request("GET","小提一部"))).status,409);
  assert.equal((await handlers.sectionAttendance(request("POST","小提一部",[{studentId:"source",status:"present"}]))).status,409);
});

test("the final teacher attendance screen displays and saves the merged roster",async()=>{
  const posts=[],roster=[{studentId:"target",name:"乙",groupName:"A",section:"小提二部",grade:"五年級",instrument:"小提琴"},{studentId:"source",name:"甲",groupName:"A",section:"小提一部",grade:"五年級",instrument:"小提琴"}];
  let saved=[];
  const state={me:{assignments:[{groupName:"A",section:"小提二部"}],capabilities:{section:true,teacherSettings:true}},students:[roster[0]],sectionSelectedDate:"2026-09-29",page:"teacherHome"};
  const context={state,sectionPage:()=>"",ensemblePage:()=>"",go:async()=>{},api:async(url,options)=>{if(options?.method==="POST"){const body=JSON.parse(options.body);posts.push(body);saved=body.items;return {ok:true,count:saved.length}}return {items:saved.length?[...saved,{studentId:"former",status:"present"}]:[],roster,merges:[{sourceSection:"小提一部"}],lastSavedAt:"2026-09-29T02:00:00Z"}},esc:v=>String(v),toast:()=>{},render:()=>{},document:{getElementById:()=>null},setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1};
  context.window=context;
  const src=readFileSync(new URL("../../app/attendance-edit.js",import.meta.url),"utf8");
  runInNewContext(src,context);
  await context.go("section");
  const html=context.sectionPage();
  assert.match(html,/今日併班/);assert.match(html,/甲/);assert.match(html,/乙/);
  context.setSectionStatus("source","leave");
  await context.saveSection();
  assert.equal(posts.length,1);
  assert.deepEqual(Array.from(posts[0].items,x=>x.studentId).sort(),["source","target"]);
  assert.equal(posts[0].items.find(x=>x.studentId==="source").status,"leave");
  assert.equal(posts[0].items.find(x=>x.studentId==="source").minutes,0);
  assert.equal(state.sectionSaveFeedback.phase,"success");
  assert.equal(state.sectionSessionLoaded,2);
  assert.match(state.sectionSaveFeedback.message,/伺服器已確認儲存/);
});

test("school admin alone can create and cancel a one-day section merge",async()=>{
  const handlers={},rows=new Map(),profile=section=>({sectionAssignments:JSON.stringify([{groupName:"A",section}])});
  let access={role:"sectionTeacher",email:"receiver@example.org"};
  const context={app:{http:(name,config)=>{handlers[name]=config.handler}},getTenantContext:async()=>({access,schoolId:"school"}),json:(body,status=200)=>({status,jsonBody:body}),ensureTenantTables:async()=>{},tenantSchoolPartition:id=>id,table:()=>({createEntity:async row=>rows.set(row.rowKey,row),getEntity:async(_pk,id)=>{if(!rows.has(id))throw {statusCode:404};return rows.get(id)},updateEntity:async row=>rows.set(row.rowKey,{...rows.get(row.rowKey),...row})}),getTeacherDirectory:async mail=>({teacherName:mail.startsWith("absent")?"請假老師":"接課老師",status:"active"}),getTeacherProfile:async mail=>profile(mail.startsWith("absent")?"小提一部":"小提二部"),listStudentMaster:async()=>[{groupName:"A",section:"小提一部"},{groupName:"A",section:"小提二部"}],listActivityRange:async()=>[],enforceScheduledCourse:async()=>({enforced:true,allowed:true}),listSectionMerges:async()=>[...rows.values()].map(x=>({...x,mergeId:x.rowKey})),sectionMergeKey:()=>"merge-1",sectionMergeView:x=>({...x,mergeId:x.rowKey}),validMergeDate:x=>/^\d{4}-\d{2}-\d{2}$/.test(x)};
  const src=readFileSync(new URL("../src/functions/sectionMerge.js",import.meta.url),"utf8");runInNewContext(src.slice(src.indexOf("const email=")),context);
  const body={sessionDate:"2026-09-29",groupName:"A",sourceSection:"小提一部",targetSection:"小提二部",absentTeacherEmail:"absent@example.org",receivingTeacherEmail:"receiver@example.org",reason:"請假併班"};
  const request=(method,payload=body)=>({method,query:new URLSearchParams(),json:async()=>payload});
  assert.equal((await handlers.sectionMerge(request("POST"))).status,403);
  access={role:"admin",email:"admin@example.org"};
  const created=await handlers.sectionMerge(request("POST"));assert.equal(created.status,201);
  assert.equal(rows.get("merge-1").createdBy,"admin@example.org");
  assert.equal((await handlers.sectionMerge(request("POST"))).status,409);
  const cancelled=await handlers.sectionMerge(request("PATCH",{action:"cancel",mergeId:"merge-1"}));
  assert.equal(cancelled.status,200);assert.equal(rows.get("merge-1").status,"cancelled");
  assert.equal(rows.get("merge-1").cancelledBy,"admin@example.org");
});

test("school course management offers same-group classes and submits a dated assignment",async()=>{
  let posted=null;
  const teachers=[
    {email:"absent@example.org",teacherName:"請假老師",status:"active",sectionAssignments:[{groupName:"A",section:"小提一部"}]},
    {email:"receiver@example.org",teacherName:"接課老師",status:"active",sectionAssignments:[{groupName:"A",section:"小提二部"}]}
  ];
  const appElement={innerHTML:""},inputs={mergeSource:{value:"0"},mergeDate:{value:"2026-09-29"},mergeTarget:{value:"小提二部"},mergeAbsent:{value:"absent@example.org"},mergeReceiver:{value:"receiver@example.org"},mergeReason:{value:"老師請假"}};
  const context={state:{me:{role:"admin"},page:"admin",schoolName:"測試學校"},api:async(url,options)=>{if(options?.method==="POST"){posted=JSON.parse(options.body);return {ok:true}}if(url==="/api/teacher-directory")return {items:teachers};if(url==="/api/section-merge")return {items:[]};return {items:[],exceptions:[],scheduleState:{status:"draft"}}},adminPage:()=>"<div></div>",render:()=>{},esc:v=>String(v),shell:v=>v,toast:()=>{},confirm:()=>true,prompt:()=>"",document:{getElementById:id=>id==="app"?appElement:inputs[id]||null},$:id=>inputs[id]||null};
  context.window=context;
  const src=readFileSync(new URL("../../app/schedule-admin.js",import.meta.url),"utf8");runInNewContext(src,context);
  await context.openScheduleAdmin();
  assert.match(appElement.innerHTML,/單日分部併班/);
  assert.match(appElement.innerHTML,/接課老師/);
  await context.createSectionMerge();
  assert.equal(posted.sessionDate,"2026-09-29");assert.equal(posted.groupName,"A");
  assert.equal(posted.sourceSection,"小提一部");assert.equal(posted.targetSection,"小提二部");
});
