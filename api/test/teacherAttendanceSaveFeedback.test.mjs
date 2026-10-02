import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source=name=>readFileSync(new URL(`../../app/${name}.js`,import.meta.url),"utf8");
const base={esc:value=>String(value),toast:()=>{},render:()=>{},document:{getElementById:()=>null},setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1};

test("ensemble attendance stays unconfirmed until server readback matches each student's status",async()=>{
  const students=[{studentId:"s1",name:"甲",groupName:"A"},{studentId:"s2",name:"乙",groupName:"A"}];
  const state={me:{ensembleGroups:["A"],capabilities:{ensemble:true,teacherSettings:true}},students,page:"teacherHome",ensembleSessionDate:"2026-10-02",teacherTodayStatusDate:"2026-10-02"};
  let saved=[],readback="partial",posts=0;
  const context={...base,state,sectionPage:()=>"",ensemblePage:()=>"",go:async()=>{},api:async(url,options)=>{
    if(options?.method==="POST"){posts++;saved=JSON.parse(options.body).items;return {ok:true,count:saved.length}}
    return {sessionDate:"2026-10-02",groupName:"A",items:readback==="partial"?saved.slice(0,1):[...saved,{studentId:"former",status:"present"}],lastSavedAt:"2026-10-02T02:00:00Z"};
  }};
  context.window=context;
  runInNewContext(source("attendance-edit"),context);
  await context.go("ensemble");
  context.setEnsembleStatus("s2","absent");
  await context.saveEnsemble();
  assert.equal(posts,1);
  assert.equal(state.ensembleSaveFeedback.phase,"warning");
  assert.match(context.ensemblePage(),/尚未確認全部點名已儲存/);
  assert.equal(state.teacherTodayStatusDate,"2026-10-02");
  readback="complete";
  await context.saveEnsemble();
  assert.equal(state.ensembleSaveFeedback.phase,"success");
  assert.equal(state.ensembleSessionLoaded,2);
  assert.match(context.ensemblePage(),/伺服器已確認儲存/);
  assert.equal(state.teacherTodayStatusDate,"");
});

test("comprehensive attendance keeps the draft and shows a persistent warning after a mismatched readback",async()=>{
  const students=[{studentId:"s1",name:"甲",groupName:"A"},{studentId:"s2",name:"乙",groupName:"B"}];
  const root={innerHTML:""},state={me:{role:"teacher",capabilities:{comprehensive:true,teacherSettings:true}},teacherSetup:{profile:{comprehensiveEnabled:true},students},students,page:"comprehensive",comprehensiveDate:"2026-10-02",comprehensiveExisting:{sessionDate:"2026-10-02",items:[]},teacherTodayStatusDate:"2026-10-02"};
  let saved=[],readback="partial";
  const context={...base,state,document:{getElementById:id=>id==="app"?root:null},$:id=>({value:id==="cmp_s2"?"late":"present"}),shell:html=>html,go:async()=>{},api:async(url,options)=>{
    if(options?.method==="POST"){saved=JSON.parse(options.body).items;return {ok:true,count:saved.length}}
    return {sessionDate:"2026-10-02",items:readback==="partial"?saved.slice(0,1):saved,lastSavedAt:"2026-10-02T02:00:00Z"};
  }};
  context.window=context;
  runInNewContext(source("comprehensive-support"),context);
  await context.saveComprehensive();
  assert.equal(state.comprehensiveSaveFeedback.phase,"warning");
  assert.equal(state.comprehensiveDraft.statuses.s2,"late");
  assert.match(root.innerHTML,/尚未確認全部點名已儲存/);
  readback="complete";
  await context.saveComprehensive();
  assert.equal(state.comprehensiveSaveFeedback.phase,"success");
  assert.equal(state.comprehensiveDraft,null);
  assert.equal(state.teacherTodayStatusDate,"");
  assert.match(root.innerHTML,/伺服器已確認儲存/);
});

test("training attendance requires all roster entries in the server readback before showing completion",async()=>{
  const event={eventId:"event-1",eventDate:"2026-09-29",title:"週六加練",status:"active"};
  const items=[{studentId:"s1",name:"甲",status:""},{studentId:"s2",name:"乙",status:""}];
  const root={innerHTML:""},state={me:{role:"teacher",capabilities:{teacherSettings:true}},page:"trainingAttendance",trainingAttendanceData:{event,items,recorded:0,expected:2},trainingAttendanceStatuses:{s1:"present",s2:"late"},teacherTodayStatusDate:"2026-10-02"};
  let readback="wrong";
  const context={...base,state,document:{getElementById:id=>id==="app"?root:null},shell:html=>html,api:async(url,options)=>{
    if(options?.method==="POST")return {ok:true,recorded:2,expected:2};
    const rows=items.map((x,i)=>({...x,status:i===1&&readback==="wrong"?"present":state.trainingAttendanceStatuses[x.studentId]}));
    return {event,items:rows,recorded:2,expected:2,lastSavedAt:"2026-09-29T02:00:00Z"};
  }};
  context.window=context;
  runInNewContext(source("training-attendance"),context);
  state.trainingAttendanceData={event,items,recorded:0,expected:2};
  state.trainingAttendanceStatuses={s1:"present",s2:"late"};
  await context.saveTrainingAttendance();
  assert.equal(state.trainingSaveFeedback.phase,"warning");
  assert.match(root.innerHTML,/尚未確認全部點名已儲存/);
  readback="correct";
  await context.saveTrainingAttendance();
  assert.equal(state.trainingSaveFeedback.phase,"success");
  assert.equal(state.teacherTodayStatusDate,"");
  assert.match(root.innerHTML,/伺服器已確認儲存/);
});
