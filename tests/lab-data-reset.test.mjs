import test from "node:test";
import assert from "node:assert/strict";
import {assertLabDataAccess,ownsLabRow,cleanLabRow,labDataFingerprint,clearLabData,restoreLabData} from "../scripts/functional-lab/lab-data-engine.mjs";

const schoolId="sacred-heart",actor="admin@example.invalid";
function fixture(){
  let rows={TenantStudentMaster:[{partitionKey:schoolId,rowKey:"990101",studentName:"測試甲",etag:"v1"}],TenantPrivateLesson:[{partitionKey:schoolId+"|student|990101",rowKey:"lesson1",schoolId,status:"scheduled",etag:"v1"}]};
  let backup=null,deletes=0,audits=[];
  const repository={
    capture:async()=>structuredClone(Object.fromEntries(Object.entries(rows).filter(([,r])=>r.length))),
    saveBackup:async tables=>{backup={id:"backup1",schoolId,tables:structuredClone(tables),fingerprint:labDataFingerprint(tables)};return {id:"backup1"}},
    readBackup:async()=>structuredClone(backup),audit:async(event)=>{audits.push(event)},
    remove:async(name,row)=>{assert.ok(backup);const actual=rows[name].find(x=>x.rowKey===row.rowKey&&x.partitionKey===row.partitionKey);if(actual.etag!==row.etag)throw Error("concurrent edit");rows[name]=rows[name].filter(x=>x!==actual);deletes++},
    insert:async(name,row)=>{rows[name]||=[];if(rows[name].some(x=>x.rowKey===row.rowKey&&x.partitionKey===row.partitionKey))throw Error("conflict");rows[name].push({...row,etag:"restored"})}
  };
  return {repository,get rows(){return rows},get backup(){return backup},set backup(v){backup=v},get deletes(){return deletes},audits,plan:()=>labDataFingerprint(rows)};
}
test("destructive capability rejects production, wrong LAB storage, non-admins and missing school before accessing data",()=>{
  const ready={ready:true,environment:"functional-uat",storageAccount:"shorchestrauat01"},context={schoolId,access:{role:"admin",email:actor}};
  assert.doesNotThrow(()=>assertLabDataAccess(ready,context));
  for(const change of [{ready:false},{environment:"production"},{storageAccount:"prodstore"},{storageAccount:"differentlab"}])assert.throws(()=>assertLabDataAccess({...ready,...change},context));
  for(const role of ["parent","teacher","globalAdmin",""])assert.throws(()=>assertLabDataAccess(ready,{...context,access:{...context.access,role}}));
  assert.throws(()=>assertLabDataAccess(ready,{...context,schoolId:""}));
});
test("scope matches school and nested student/parent/term partitions without prefix collisions",()=>{
  for(const partitionKey of [schoolId,schoolId+"|student|x",schoolId+"|parent|p",schoolId+"|term|115-1"])assert.equal(ownsLabRow({partitionKey,schoolId},schoolId),true);
  for(const partitionKey of ["other",schoolId+"-other",schoolId+"x"])assert.equal(ownsLabRow({partitionKey},schoolId),false);
  assert.equal(ownsLabRow({partitionKey:schoolId,schoolId:"other"},schoolId),false);
});
test("stale preview and backup failure perform no deletion",async()=>{
  const f=fixture(),token=f.plan();f.rows.TenantPrivateLesson[0].status="present";
  await assert.rejects(clearLabData({repository:f.repository,schoolId,planToken:token,actor}),/資料已異動/);assert.equal(f.deletes,0);
  f.repository.saveBackup=async()=>{throw Error("backup unavailable")};
  await assert.rejects(clearLabData({repository:f.repository,schoolId,planToken:f.plan(),actor}),/backup unavailable/);assert.equal(f.deletes,0);
});
test("foreign school or unversioned rows cannot be partially deleted",async()=>{
  for(const bad of [{partitionKey:"other",rowKey:"x",etag:"1"},{partitionKey:schoolId,rowKey:"x"}]){
    const f=fixture();f.rows.TenantPrivateLesson.push(bad);
    await assert.rejects(clearLabData({repository:f.repository,schoolId,planToken:f.plan(),actor}),/範圍|版本/);assert.equal(f.deletes,0);
  }
});
test("reset backs up all datasets and normal restore reproduces every field",async()=>{
  const f=fixture(),before=await f.repository.capture(),token=f.plan();
  const cleared=await clearLabData({repository:f.repository,schoolId,planToken:token,actor});assert.equal(cleared.ok,true);assert.equal(cleared.deleted,2);
  assert.deepEqual(await f.repository.capture(),{});assert.equal(f.backup.fingerprint,token);
  const restored=await restoreLabData({repository:f.repository,schoolId,backupId:"backup1",actor});assert.equal(restored.restored,2);
  assert.equal(labDataFingerprint(await f.repository.capture()),labDataFingerprint(before));
  const repeat=await restoreLabData({repository:f.repository,schoolId,backupId:"backup1",actor});assert.equal(repeat.restored,0);
});
test("concurrent mutation stops clearing, preserves that row and leaves a usable recovery snapshot",async()=>{
  const f=fixture(),originalRemove=f.repository.remove;
  f.repository.remove=async(name,row)=>{if(name==="TenantPrivateLesson")f.rows[name][0].etag="v2";return originalRemove(name,row)};
  const r=await clearLabData({repository:f.repository,schoolId,planToken:f.plan(),actor});assert.equal(r.ok,false);assert.equal(r.partial,true);assert.equal(r.deleted,1);assert.ok(r.backup);assert.equal(f.rows.TenantPrivateLesson.length,1);
  // An etag-only change does not change business data; recovery can fill the missing master.
  assert.equal((await restoreLabData({repository:f.repository,schoolId,backupId:r.backup.id,actor})).restored,1);
});
test("restore rejects wrong tenant, corrupt snapshot and new or modified practice work without inserting anything",async()=>{
  for(const mode of ["tenant","corrupt","new","modified"]){
    const f=fixture();await clearLabData({repository:f.repository,schoolId,planToken:f.plan(),actor});
    if(mode==="tenant")f.backup.schoolId="other";
    if(mode==="corrupt")f.backup.tables.TenantStudentMaster[0].studentName="tampered";
    if(mode==="new")f.rows.TenantStudentMaster.push({partitionKey:schoolId,rowKey:"new",etag:"x"});
    if(mode==="modified")f.rows.TenantStudentMaster.push({...f.backup.tables.TenantStudentMaster[0],studentName:"new name"});
    const before=await f.repository.capture();await assert.rejects(restoreLabData({repository:f.repository,schoolId,backupId:"backup1",actor}));assert.deepEqual(await f.repository.capture(),before);
  }
});
test("failed pre-clear audit prevents deletion and empty reset keeps the previous backup",async()=>{
  const f=fixture();f.repository.audit=async()=>{throw Error("audit unavailable")};
  await assert.rejects(clearLabData({repository:f.repository,schoolId,planToken:f.plan(),actor}),/audit unavailable/);assert.equal(f.deletes,0);
  f.rows.TenantStudentMaster.length=0;f.rows.TenantPrivateLesson.length=0;
  const r=await clearLabData({repository:f.repository,schoolId,planToken:labDataFingerprint({}),actor});assert.equal(r.deleted,0);assert.ok(f.backup);
});
