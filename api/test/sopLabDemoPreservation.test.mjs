import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function fixtures(){
  const tables=new Map(),opened=[];let role="admin",ready=true;
  const get=name=>{if(!tables.has(name))tables.set(name,new Map());return tables.get(name)};
  const table=name=>({createTable:async()=>{},getEntity:async(pk,rk)=>{const e=get(name).get(pk+"/"+rk);if(!e)throw {statusCode:404};return e},createEntity:async e=>{const key=e.partitionKey+"/"+e.rowKey;if(get(name).has(key))throw {statusCode:409};get(name).set(key,e)},updateEntity:async e=>get(name).set(e.partitionKey+"/"+e.rowKey,e),listEntities:async function*({queryOptions}){const pk=queryOptions.filter.match(/PartitionKey eq '([^']+)'/)[1];for(const row of get(name).values())if(row.partitionKey===pk)yield row}});
  const handlers={},context={app:{http:(name,config)=>handlers[name]=config.handler},TableClient:{fromConnectionString:(connection,name)=>{opened.push(name);return table(name)}},getTenantContext:async()=>({access:{role,email:"admin@example.org"},schoolId:"sacred-heart"}),json:(jsonBody,status=200)=>({jsonBody,status}),getLabReadiness:()=>({ready,environment:"functional-uat",storageAccount:"school-test"}),assertLabIsolation:()=>{},process:{env:{LAB_EXPECTED_STORAGE_ACCOUNT:"school-test",STORAGE_CONNECTION_STRING:"test-only"}},console};
  const python=readFileSync(new URL("../../scripts/sop_lab_seed.py",import.meta.url),"utf8");
  const js=python.match(/API_JS\s*=\s*r'''([\s\S]*?)'''/)[1].replace(/^import .*;\n/gm,"");runInNewContext(js,context);
  return {get,opened,setRole:r=>role=r,setReady:r=>ready=r,run:()=>handlers.sopLabFixtures({method:"POST",json:async()=>({confirmation:"CREATE_SOP_FIXTURES"})})};
}

test("new reserve example and three draft course examples are added without resetting a completed receipt",async()=>{
  const b=fixtures();const oldStudent={partitionKey:"sacred-heart",rowKey:"990105",studentName:"測試戊同學",updatedBy:"MANUAL",note:"保留這筆原紀錄"};
  const oldShirt={partitionKey:"sacred-heart",rowKey:"990105",payload:JSON.stringify({historicalIssued:true,size:"M",source:"PARENT_CONFIRMED_FIRST_PUBLIC",parentConfirmedAt:"2026-10-24T10:00:00Z"})};
  b.get("TenantStudentMaster").set("sacred-heart/990105",oldStudent);b.get("TenantTshirtHistoricalIssue").set("sacred-heart/990105",oldShirt);
  const result=await b.run();assert.equal(result.status,200);assert.equal(result.jsonBody.students,6);assert.equal(result.jsonBody.scheduleDemo,"created_three_draft_courses");
  assert.equal(b.get("TenantStudentMaster").get("sacred-heart/990105"),oldStudent);assert.equal(b.get("TenantTshirtHistoricalIssue").get("sacred-heart/990105"),oldShirt);
  const newShirt=JSON.parse(b.get("TenantTshirtHistoricalIssue").get("sacred-heart/990106").payload);assert.equal(newShirt.historicalIssued,false);assert.equal(newShirt.size,null);assert.equal(newShirt.issuedQuantity,0);
  assert.equal(b.get("TenantSchedule").size,3);assert.equal(b.get("TenantScheduleState").get("sacred-heart/current").status,"draft");
  const before=JSON.stringify([...b.get("TenantSchedule").values()]);const repeated=await b.run();assert.equal(repeated.jsonBody.created,0);assert.equal(repeated.jsonBody.scheduleDemo,"kept_existing");assert.equal(JSON.stringify([...b.get("TenantSchedule").values()]),before);
});

test("an existing course or active empty schedule is left untouched and exceptions are never opened",async()=>{
  for(const mode of ["course","active"]){
    const b=fixtures();
    if(mode==="course")b.get("TenantSchedule").set("sacred-heart/original",{partitionKey:"sacred-heart",rowKey:"original",courseName:"使用者既有課程"});
    else b.get("TenantScheduleState").set("sacred-heart/current",{partitionKey:"sacred-heart",rowKey:"current",status:"active"});
    await b.run();assert.equal(b.get("TenantSchedule").size,mode==="course"?1:0);assert.ok(!b.opened.includes("TenantScheduleException"));
    if(mode==="active")assert.equal(b.get("TenantScheduleState").get("sacred-heart/current").status,"active");
  }
});

test("the fixture remains unavailable without isolated LAB readiness and school-admin authorization",async()=>{
  const b=fixtures();b.setReady(false);assert.equal((await b.run()).status,503);assert.equal(b.opened.length,0);
  b.setReady(true);b.setRole("parent");assert.equal((await b.run()).status,403);assert.equal(b.opened.length,0);
});
