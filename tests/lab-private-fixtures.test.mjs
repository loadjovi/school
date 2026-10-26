import test from "node:test";
import assert from "node:assert/strict";
import {seedPrivateExamples,privateFixtureCases} from "../scripts/functional-lab/lab-private-fixtures.mjs";
import {buildPrivateLessonFollowup} from "../api/src/lib/privateLessonFollowup.js";

function fixture(){
  const data=new Map();
  const db=name=>{if(!data.has(name))data.set(name,new Map());return data.get(name)};
  const table=async name=>({getEntity:async(pk,rk)=>{const value=db(name).get(pk+"/"+rk);if(!value)throw {statusCode:404};return value},createEntity:async row=>{const key=row.partitionKey+"/"+row.rowKey;if(db(name).has(key))throw {statusCode:409};db(name).set(key,row)}});
  const addIfMissing=async(client,row)=>{try{await client.createEntity(row);return "created"}catch(e){if(e.statusCode===409)return "exists";throw e}};
  for(const s of privateFixtureCases)db("TenantStudentMaster").set("sacred-heart/"+s.studentId,{partitionKey:"sacred-heart",rowKey:s.studentId,studentName:s.name,updatedBy:"SOP_LAB_FIXTURE"});
  return {db,run:async()=>{const result={created:0,existing:0};await seedPrivateExamples({table,addIfMissing,schoolId:"sacred-heart",result});return result}};
}
test("private examples exercise the real follow-up model for all six states",async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.created,8);assert.equal(result.privateCases.length,6);
  const profiles=f.db("TenantTeacherProfile"),directory=[...f.db("TenantTeacherDirectory").values()];
  const items=buildPrivateLessonFollowup({students:privateFixtureCases.map(x=>({studentId:x.studentId})),teachers:directory.map(x=>({email:x.rowKey,teacherName:x.teacherName,status:x.status,privateStudentIds:profiles.get("sacred-heart/"+x.rowKey).privateStudentIds})),lessons:[...f.db("TenantPrivateLesson").values()],start:"2000-01-01",end:"2100-12-31",today:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date()),nowTime:"23:59"});
  const get=id=>items.find(x=>x.studentId===id);
  assert.equal(get("990101").completed,1);assert.equal(get("990101").assignedTeachers.length,1);
  assert.equal(get("990102").assignedTeachers.length,1);assert.equal(get("990102").recordCount,0);
  assert.equal(get("990103").assignedTeachers.length,0);assert.equal(get("990103").recordCount,0);
  assert.equal(get("990104").upcoming,1);assert.equal(get("990105").awaitingParent,1);assert.equal(get("990106").teacherPending,1);
  const completed=f.db("TenantPrivateLesson").get("sacred-heart|student|990101/sop_private_990101");
  assert.equal(completed.teacherRatedBy,"lab.parent@example.invalid");assert.equal(completed.studentPerformanceRating,4);
  const modified=f.db("TenantPrivateLesson").get("sacred-heart|student|990104/sop_private_990104");assert.equal(modified.rescheduleCount,1);
});
test("repeating examples preserves manual lesson changes and teacher bindings",async()=>{
  const f=fixture();await f.run();
  const key="sacred-heart/lab.private.one@example.invalid",profile=f.db("TenantTeacherProfile").get(key);profile.privateStudentIds='["990102"]';
  const completed=f.db("TenantPrivateLesson").get("sacred-heart|student|990101/sop_private_990101");completed.studentPerformanceRating=2;completed.teacherReview="幹部修改的評論";
  const before=JSON.stringify([...f.db("TenantPrivateLesson").values()]),result=await f.run();assert.equal(result.created,0);
  assert.equal(f.db("TenantTeacherProfile").get(key).privateStudentIds,'["990102"]');assert.equal(JSON.stringify([...f.db("TenantPrivateLesson").values()]),before);
});
test("no student records means no fake teachers are created, and non-fixture students are skipped",async()=>{
  const f=fixture();f.db("TenantStudentMaster").clear();await assert.rejects(f.run(),/先建立/);assert.equal(f.db("TenantTeacherDirectory").size,0);
  f.db("TenantStudentMaster").set("sacred-heart/990101",{studentName:"其他學生",updatedBy:"MANUAL"});await assert.rejects(f.run(),/先建立/);assert.equal(f.db("TenantPrivateLesson").size,0);
});
