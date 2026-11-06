import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),"utf8");
const payloadSource=read("api/src/lib/lineAbsenceNotification.mjs").replace(/^import .*;$/gm,"").replaceAll("export ","");
const {lineAbsenceCandidates,lineAbsenceMessage}=runInNewContext(payloadSource+";({lineAbsenceCandidates,lineAbsenceMessage})",{});
const absent=(extra={})=>({status:"absent",date:"2026-11-07",classType:"section",studentId:"1001",name:"測試學生",groupName:"A",section:"小提一部",...extra});

test("absence LINE payload accepts only supported, newly supplied absence rows and removes duplicates",()=>{
  const rows=lineAbsenceCandidates([
    absent(),absent(),absent({studentId:"1002",status:"leave"}),absent({studentId:"1003",status:"late"}),absent({studentId:"1004",classType:"private"}),
    absent({studentId:"1005",classType:"training",eventId:"event-1",eventTitle:"A 團賽前加練"})
  ]);
  assert.equal(rows.map(x=>x.studentId).join(","),"1001,1005");
});

test("absence LINE message states its narrow notification rule and course context",()=>{
  const text=lineAbsenceMessage({date:"2026-11-07",actorName:"幹部老師",items:[absent(),absent({studentId:"1005",name:"加練學生",classType:"training",eventId:"event-1",eventTitle:"A 團賽前加練"})]});
  assert.match(text,/學生缺席即時通知/);
  assert.match(text,/新登記缺席：2 位/);
  assert.match(text,/測試學生｜A團｜小提一部｜分部課/);
  assert.match(text,/加練學生.*訓練／加練（A 團賽前加練）/);
  assert.match(text,/請假、遲到與重複儲存不通知/);
  assert.match(text,/點名人員：幹部老師/);
});

test("all group attendance writes notify only after a new absent transition and isolate LINE failures",()=>{
  for(const name of ["sectionAttendance","ensembleAttendance","comprehensiveAttendance"]){
    const source=read(`api/src/functions/${name}.js`);
    assert.match(source,/!oldRows\.some\(x=>x\.status==="absent"\)/);
    const write=Math.max(source.lastIndexOf("createEntity("),source.lastIndexOf("upsertEntity("));
    const dispatch=source.lastIndexOf("dispatchLineAbsenceNotifications({");
    assert.ok(write>=0&&dispatch>write,`${name} must send only after attendance is saved`);
    assert.match(source,/newAbsences\.map\(x=>\(\{\.\.\.x,status:"absent"\}\)\)/);
    assert.match(source,/catch\(error\)\{console\.error\("LINE absence notification failed"/);
  }
});

test("training attendance compares the previous saved status before sending",()=>{
  const source=read("api/src/functions/trainingAttendance.js");
  assert.match(source,/previousById=new Map\(\(await savedRecords/);
  assert.match(source,/statuses\.get\(studentId\)==="absent"&&String\(previousById\.get\(studentId\)\?\.status\|\|""\)!=="absent"/);
  assert.match(source,/classType:"training"/);
  assert.match(source,/dispatchLineAbsenceNotifications/);
  assert.match(source,/catch\(error\)\{console\.error\("LINE training absence notification failed"/);
});

test("webhook and settings keep the absence group independent from the general to-do group",()=>{
  const settings=read("api/src/lib/settings.js"),webhook=read("api/src/functions/lineWebhook.js"),ui=read("app/admin-operations.js");
  assert.match(settings,/lineAbsenceTargetId/);
  assert.match(settings,/lineAbsenceBindingCodeHash/);
  assert.match(settings,/purpose==="absence"/);
  assert.match(webhook,/create_absence_binding_code/);
  assert.match(webhook,/test_absence/);
  assert.match(webhook,/unbind_absence/);
  assert.match(webhook,/requestRow\.purpose/);
  assert.match(ui,/學生缺席即時通知群組/);
  assert.match(ui,/產生缺席群組綁定碼/);
  assert.match(ui,/包含分部課、合奏課、綜合課與訓練／加練/);
});
