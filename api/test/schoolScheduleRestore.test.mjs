import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function backend(){
  const rows={tenantSchedule:new Map(),tenantScheduleException:new Map(),tenantScheduleState:new Map()};
  const key=e=>e.partitionKey+"/"+e.rowKey;
  const course={partitionKey:"school-a",rowKey:"course-1",courseType:"section",courseName:"儲備分部課",groupName:"儲備",recurrence:"weekly",weekday:5,startDate:"2026-10-02",endDate:"2026-12-31",startTime:"17:10",endTime:"18:30",status:"active"};
  const exception={partitionKey:"school-a",rowKey:"course-1|2026-10-30",scheduleId:"course-1",sessionDate:"2026-10-30",status:"cancelled",reason:"學校活動",updatedAt:"2026-10-24T01:00:00Z",etag:"v1"};
  rows.tenantSchedule.set(key(course),course);rows.tenantScheduleException.set(key(exception),exception);
  rows.tenantScheduleState.set("school-a/current",{partitionKey:"school-a",rowKey:"current",status:"active"});
  const audits=[],handlers={};let access={role:"admin",email:"admin@example.org"},schoolId="school-a",conflict=false;
  const context={app:{http:(name,config)=>handlers[name]=config.handler},getTenantContext:async()=>({access,schoolId}),json:(jsonBody,status=200)=>({jsonBody,status}),ensureTenantTables:async()=>{},tenantSchoolPartition:x=>x,Buffer,auditSaved:async(...args)=>audits.push(args),console,
    table:name=>({getEntity:async(pk,rk)=>{const e=rows[name].get(pk+"/"+rk);if(!e)throw {statusCode:404};return {...e}},listEntities:async function*({queryOptions}){const pk=queryOptions.filter.match(/PartitionKey eq '([^']+)'/)[1];const date=queryOptions.filter.match(/sessionDate eq '([^']+)'/)?.[1];for(const e of rows[name].values())if(e.partitionKey===pk&&(!date||e.sessionDate===date))yield e},updateEntity:async(e,mode,options)=>{if(conflict||options.etag!==rows[name].get(key(e))?.etag)throw {statusCode:412};rows[name].set(key(e),{...e,etag:"v2"})},upsertEntity:async e=>rows[name].set(key(e),e)})};
  const source=readFileSync(new URL("../src/functions/schoolSchedule.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"").replace(/^export \{.*\};?$/gm,"").replace(/^export /gm,"");
  runInNewContext(source,context);
  const request=body=>handlers.schoolSchedule({method:"PATCH",json:async()=>({action:"restore",scheduleId:"course-1",sessionDate:"2026-10-30",reason:"恢復原課程",expectedUpdatedAt:exception.updatedAt,...body})});
  return {rows,course,exception,audits,context,request,setAccess:a=>access=a,setSchool:s=>schoolId=s,setConflict:()=>conflict=true};
}

test("restoring one cancelled lesson re-enables attendance and keeps cancellation evidence",async()=>{
  const b=backend();
  assert.equal((await b.context.enforceScheduledCourse("school-a","2026-10-30","section","儲備")).allowed,false);
  const other={...b.exception,rowKey:"course-1|2026-11-06",sessionDate:"2026-11-06",reason:"另一堂停課"};b.rows.tenantScheduleException.set("school-a/"+other.rowKey,other);
  const result=await b.request();assert.equal(result.status,200);
  const saved=b.rows.tenantScheduleException.get("school-a/"+b.exception.rowKey);
  assert.equal(saved.status,"active");assert.equal(saved.reason,"恢復原課程");assert.equal(saved.cancelledReason,"學校活動");assert.equal(saved.cancelledAt,b.exception.updatedAt);assert.equal(saved.restoredBy,"admin@example.org");
  assert.equal((await b.context.enforceScheduledCourse("school-a","2026-10-30","section","儲備")).allowed,true);
  assert.equal((await b.context.enforceScheduledCourse("school-a","2026-11-06","section","儲備")).allowed,false);
  assert.equal(b.rows.tenantSchedule.size,1);assert.equal(b.audits.length,1);assert.equal(b.audits[0][3].before.status,"cancelled");assert.equal(b.audits[0][3].after.status,"active");
  assert.equal((await b.request()).status,409);assert.equal(b.audits.length,1);
});

test("restore requires school admin, the same tenant, and a real scheduled day",async()=>{
  const b=backend();b.setAccess({role:"teacher"});assert.equal((await b.request()).status,403);
  b.setAccess({role:"admin"});b.setSchool("school-b");assert.equal((await b.request()).status,404);
  b.setSchool("school-a");assert.equal((await b.request({sessionDate:"2026-10-31"})).status,400);
  assert.equal(b.audits.length,0);
});

test("restore rejects stale, non-cancelled, inactive, or unexplained changes",async()=>{
  for(const scenario of ["stale","missing","rescheduled","inactive","blank","etag"]){
    const b=backend();let body={};
    if(scenario==="stale")body.expectedUpdatedAt="old version";
    if(scenario==="missing")b.rows.tenantScheduleException.clear();
    if(scenario==="rescheduled")b.exception.status="rescheduled";
    if(scenario==="inactive")b.course.status="inactive";
    if(scenario==="blank")body.reason=" ";
    if(scenario==="etag")b.setConflict();
    assert.equal((await b.request(body)).status,scenario==="blank"?400:409,scenario);
    assert.equal(b.audits.length,0,scenario);
  }
});

test("legacy active exception requests cannot bypass restore checks",async()=>{
  const b=backend();b.rows.tenantScheduleException.clear();
  assert.equal((await b.request({action:"exception",status:"active"})).status,409);
});

test("UI presents a review form and submits only the selected lesson after confirmation",async()=>{
  const sent=[],app={innerHTML:""},course={scheduleId:"one",courseName:"儲備課",groupName:"儲備",status:"active",startTime:"17:10",endTime:"18:30"};
  const state={me:{role:"admin"},page:"schoolSchedule",schoolSchedule:{items:[course],exceptions:[{scheduleId:"one",sessionDate:"2026-10-30",status:"cancelled",updatedAt:"v1"}],scheduleState:{status:"active"}}};
  const context={state,window:null,adminPage:()=>"",render:()=>{},shell:x=>x,esc:x=>String(x??""),$:id=>({value:id==="scheduleChangeReason"?"校方確認復課":"2026-10-30"}),document:{getElementById:id=>id==="app"?app:{scrollIntoView:()=>{}}},requestAnimationFrame:fn=>fn(),toast:()=>{},api:async(url,options)=>{if(options)sent.push(JSON.parse(options.body));return url==="/api/school-schedule"?state.schoolSchedule:{}}};context.window=context;
  runInNewContext(readFileSync(new URL("../../app/schedule-admin.js",import.meta.url),"utf8"),context);
  context.restoreSchedulePrompt("one","2026-10-30");assert.equal(sent.length,0);assert.match(app.innerHTML,/確認恢復這堂課/);assert.match(app.innerHTML,/取消停課並復課/);
  await context.submitScheduleChange();assert.equal(sent.length,1);assert.equal(sent[0].action,"restore");assert.equal(sent[0].sessionDate,"2026-10-30");assert.equal(sent[0].expectedUpdatedAt,"v1");assert.equal(sent[0].reason,"校方確認復課");
});
