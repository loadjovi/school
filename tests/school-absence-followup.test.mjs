import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {attendanceFollowupIdentity,schoolAcknowledgement,readAttendanceFollowups,acknowledgeSchoolAbsence} from '../api/src/lib/attendanceFollowup.mjs';
import {canConfirmSchoolAbsence,designatedSchoolAbsenceApprover} from '../api/src/lib/schoolAbsenceApprover.mjs';
const source=readFileSync(new URL('../api/src/functions/schoolAccess.js',import.meta.url),'utf8');
function harness(){
 const data=new Map(),writes=[],raw=Array.from({length:5},(_,i)=>({rawStudentId:String(i+1),eventDate:'2026-10-27',classType:'ensemble',groupName:'A',section:'',status:'absent',rowKey:'r'+i,createdAt:'2026-10-27T04:30:00Z',teacher:'teacher@example.com'}));
 const db={createTable:async()=>{},getEntity:async(p,k)=>{const row=data.get(p+'|'+k);if(!row)throw {statusCode:404};return row},createEntity:async r=>{const key=r.partitionKey+'|'+r.rowKey;if(data.has(key))throw {statusCode:409};data.set(key,{...r,etag:'1'});writes.push(r)},updateEntity:async(r,mode,{etag})=>{const key=r.partitionKey+'|'+r.rowKey;if(data.get(key)?.etag!==etag)throw {statusCode:412};data.set(key,{...r,etag:String(Number(etag)+1)});writes.push(r)},async*listEntities({queryOptions}){const p=queryOptions.filter.match(/PartitionKey eq '([^']+)'/)[1];for(const r of data.values())if(r.partitionKey===p)yield r}};
 let handler;const json=(body,status=200)=>({status,body});
 const context=vm.createContext({app:{http:(name,options)=>handler=options.handler},getTenantContext:async r=>r.role==='admin'?{access:{role:'admin'},schoolId:r.schoolId}:{error:json({error:'Forbidden'},403)},viewerContext:async r=>r.role==='school'?{schoolId:r.schoolId,access:{email:r.email||'school@example.com'}}:{error:json({error:'Forbidden'},403)},clean:(v,max=120)=>String(v||'').trim().slice(0,max),taipeiDate:()=> '2026-10-27',ensureTenantTables:async()=>{},listStudentMaster:async()=>raw.map(r=>({rowKey:r.rawStudentId,studentName:'學生'+r.rawStudentId})),studentView:r=>({studentId:r.rowKey,name:r.studentName}),collectDaily:async(key,date)=>key==='ensemble'?raw.filter(r=>r.eventDate===date):[],canonicalId:async id=>id,teacherName:async()=> '點名老師',TableClient:{fromConnectionString:()=>db},conn:()=> 'fake',process:{env:{}},attendanceFollowupIdentity,schoolAcknowledgement,readAttendanceFollowups,acknowledgeSchoolAbsence,canConfirmSchoolAbsence,designatedSchoolAbsenceApprover,json});
 vm.runInContext(source.slice(source.indexOf('app.http("schoolFollowup"')),context);
 const call=(role='school',method='GET',body={},schoolId='schoolA',date='2026-10-27',email='school@example.com')=>handler({role,method,schoolId,email,query:new Map([['date',date],...(method==='PATCH'?[['mode','acknowledge']]:[])]),json:async()=>body});
 return {call,raw,data,writes,db};
}
test('school teacher acknowledges one of five absences; raw five absences remain while pending becomes four',async()=>{const h=harness();const before=await h.call();assert.equal(before.body.counts.absent,5);assert.equal(before.body.counts.followup,5);const row=before.body.items[0];const result=await h.call('school','PATCH',{followupId:row.followupId,recordVersion:row.recordVersion,note:'已確認學生去向'});assert.equal(result.status,200);const after=await h.call();assert.equal(after.body.counts.absent,5);assert.equal(after.body.counts.followup,4);assert.equal(after.body.counts.acknowledgedAbsence,1);assert.equal(after.body.items.find(r=>r.studentId===row.studentId).followup.acknowledgedBy,'school@example.com');assert.ok(h.raw.every(r=>r.status==='absent'));assert.ok(h.writes.every(r=>r.kind==='state'||r.kind==='audit'));assert.equal(h.writes.length,2);const states=await readAttendanceFollowups(h.db,'schoolA','2026-10-27');assert.equal(schoolAcknowledgement(states.get(row.followupId),row.recordVersion).state,'acknowledged')});
test('parents and administrators cannot impersonate a school-teacher acknowledgement',async()=>{const h=harness();for(const role of ['parent','teacher','admin'])assert.equal((await h.call(role,'PATCH',{})).status,403);assert.equal(h.writes.length,0);assert.equal((await h.call('admin')).body.canAcknowledge,false)});
test('acknowledgement cannot cross a tenant, date or revised attendance record; leave is never acknowledgeable',async()=>{const h=harness(),row=(await h.call()).body.items[0],body={followupId:row.followupId,recordVersion:row.recordVersion};assert.equal((await h.call('school','PATCH',body,'schoolA','2026-10-26')).status,409);h.raw[0].status='leave';assert.equal((await h.call('school','PATCH',body)).status,409);h.raw[0].status='absent';h.raw[0].createdAt='2026-10-27T05:00:00Z';assert.equal((await h.call('school','PATCH',body)).status,409);assert.equal(h.writes.length,0);const states=await readAttendanceFollowups(h.db,'otherSchool','2026-10-27');assert.equal(states.size,0)});
test('duplicate acknowledgement is idempotent and later attendance revisions reopen the alert',async()=>{const h=harness(),row=(await h.call()).body.items[0],body={followupId:row.followupId,recordVersion:row.recordVersion};await h.call('school','PATCH',body);assert.equal((await h.call('school','PATCH',body)).body.alreadyAcknowledged,true);assert.equal(h.writes.length,2);h.raw[0].createdAt='2026-10-27T06:00:00Z';assert.equal((await h.call()).body.counts.followup,5)});
test('old administrator knowledge never masquerades as school-teacher followup',()=>{const old={state:'acknowledged',recordVersion:'v',acknowledgedBy:'admin@example.com'};assert.equal(schoolAcknowledgement(old,'v').state,'pending');assert.equal(schoolAcknowledgement({...old,acknowledgedRole:'admin'},'v').state,'pending');assert.equal(schoolAcknowledgement({...old,acknowledgedRole:'school'},'v').state,'acknowledged')});
test('school cards show acknowledge only on pending absences and keep a separate total-absence filter',()=>{const ui=readFileSync(new URL('../app/school-access.js',import.meta.url),'utf8');const state={me:{role:'school'},schoolViewer:{date:'2026-10-27',filter:'all',data:{canAcknowledge:true,counts:{absent:2,followup:1},items:[{name:'學生1',status:'absent',classType:'ensemble',followupId:'pending-id',recordVersion:'v',followup:{state:'pending'}},{name:'學生2',status:'absent',classType:'ensemble',followupId:'done-id',recordVersion:'v',followup:{state:'acknowledged',acknowledgedBy:'school@example.com',acknowledgedAt:'2026-10-27T05:00:00Z'}},{name:'學生3',status:'leave',classType:'ensemble'}]}}};const ctx=vm.createContext({state,esc:v=>String(v??''),classText:{ensemble:'合奏課'},statusText:{absent:'缺席',leave:'請假'},badgeClass:()=>'',acknowledgingSchoolAbsences:new Set(),localDate:()=> '2026-10-27'});vm.runInContext(ui.slice(ui.indexOf('  function filterButtons'),ui.indexOf('  function mountAdminSchoolCorrection')),ctx);const html=ctx.schoolPage();assert.match(html,/data-school-followup-ack="pending-id"/);assert.doesNotMatch(html,/data-school-followup-ack="done-id"/);assert.match(html,/指定校方老師已確認知悉/);state.schoolViewer.filter='followup';assert.equal(ctx.filteredItems(state.schoolViewer.data.items).length,1);state.schoolViewer.filter='absent';assert.equal(ctx.filteredItems(state.schoolViewer.data.items).length,2)});

test('the direct school login loader also requests the updated school module',()=>{const app=readFileSync(new URL('../app/app-v3.js',import.meta.url),'utf8'),loader=readFileSync(new URL('../app/webview-guard.js',import.meta.url),'utf8');assert.match(app,/school-access.js\?v=20261027-school-followup/);assert.match(loader,/app-v3.js\?v=20261027-school-followup/)});


test('Sacred Heart only designated Tseng account can resolve absences; Roy stays read-only',async()=>{
 const h=harness(),schoolId='sacred-heart',date='2026-10-27',tseng='andy081005@gmail.com',roy='roy.lin@hwacom.com';
 const before=await h.call('school','GET',{},schoolId,date,roy);
 assert.equal(before.body.canAcknowledge,false);
 assert.equal(before.body.responsibleEmail,tseng);
 assert.equal(before.body.counts.followup,5);
 const row=before.body.items[0],body={followupId:row.followupId,recordVersion:row.recordVersion,note:'已知悉'};
 const denied=await h.call('school','PATCH',body,schoolId,date,roy);
 assert.equal(denied.status,403);
 assert.equal(h.writes.length,0);
 const approved=await h.call('school','GET',{},schoolId,date,tseng);
 assert.equal(approved.body.canAcknowledge,true);
 const done=await h.call('school','PATCH',body,schoolId,date,tseng);
 assert.equal(done.status,200);
 const after=await h.call('school','GET',{},schoolId,date,roy);
 assert.equal(after.body.counts.followup,4);
 assert.equal(after.body.items[0].followup.acknowledgedBy,tseng);
});
test('previous Roy acknowledgement remains in audit but reopens pending until Tseng confirms',async()=>{
 const h=harness(),schoolId='sacred-heart',date='2026-10-27',roy='roy.lin@hwacom.com',tseng='andy081005@gmail.com';
 const baseline=await h.call('school','GET',{},schoolId,date,tseng),row=baseline.body.items[0];
 const partitionKey=schoolId+'|'+date;
 h.data.set(partitionKey+'|'+row.followupId,{partitionKey,rowKey:row.followupId,kind:'state',state:'acknowledged',recordVersion:row.recordVersion,acknowledgedBy:roy,acknowledgedRole:'school',acknowledgedAt:'2026-10-30T10:25:00Z',note:'已知悉',etag:'1'});
 const pending=await h.call('school','GET',{},schoolId,date,tseng);
 assert.equal(pending.body.counts.followup,5);
 assert.equal(pending.body.items[0].followup.state,'pending');
 assert.equal(pending.body.items[0].followup.adminAcknowledgedBy,roy);
 const result=await h.call('school','PATCH',{followupId:row.followupId,recordVersion:row.recordVersion,note:'曾老師已確認'},schoolId,date,tseng);
 assert.equal(result.status,200);
 const latest=await h.call('school','GET',{},schoolId,date,tseng);
 assert.equal(latest.body.counts.followup,4);
 assert.equal(latest.body.items[0].followup.acknowledgedBy,tseng);
 const audits=[...h.data.values()].filter(x=>x.kind==='audit');
 assert.equal(audits.length,1);
});
