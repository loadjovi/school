import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/school-admin-workspace.js',import.meta.url),'utf8');
const begin=source.indexOf(' function taipeiClock(');
const finish=source.indexOf(' const taskScopeKey=',begin);
assert.ok(begin>0&&finish>begin,'Attendance rules must be present');
const runtime=vm.createContext({Intl,Date,Number,String,Object,Set,Array});
vm.runInContext(source.slice(begin,finish)+'\nthis.todoCounts=attendanceTodoCounts;',runtime);
const counts=(report,now)=>runtime.todoCounts(report,new Date(now));

function sample(overrides={}){
 return {
  date:'2026-10-18',
  items:[
   {studentId:'101',status:'absent',classType:'section'},
   {studentId:'102',status:'leave',classType:'ensemble'},
   {studentId:'103',status:'absent',classType:'private'},
   {studentId:'104',status:'absent',classType:'comprehensive'}
  ],
  courseSummary:[
   {key:'a',scheduleStatus:'active',expected:15,recorded:10,time:'08:45–10:15'},
   {key:'b',scheduleStatus:'active',expected:20,recorded:0,time:'12:30–13:20'},
   {key:'c',scheduleStatus:'active',expected:15,recorded:15,time:'08:45–10:15'},
   {key:'d',scheduleStatus:'cancelled',expected:20,recorded:0,time:'08:45–10:15'},
   {key:'e',scheduleStatus:'rescheduled',expected:20,recorded:0,time:'08:45–10:15'},
   {key:'f',scheduleStatus:'active',expected:0,recorded:0,time:'08:45–10:15'},
   {key:'g',scheduleStatus:'actual',expected:20,recorded:0,time:'08:45–10:15'},
   {key:'h',scheduleStatus:'active',expected:20,recorded:0,time:'依實際點名'}
  ],
  ...overrides
 };
}

test('counts only group-class absences, excludes excused leave and private lessons',()=>{
 const result=counts(sample(),'2026-10-18T11:10:00+08:00');
 assert.equal(result.absent,2);
 assert.equal(result.unmarked,1);
});
test('class in progress is not counted as overdue',()=>{
 const result=counts(sample(),'2026-10-18T10:14:00+08:00');
 assert.equal(result.unmarked,0);
});
test('end time is counted in Taiwan time even for UTC timestamps',()=>{
 const result=counts(sample(),'2026-10-18T02:15:00Z');
 assert.equal(result.unmarked,1);
});
test('scheduled classes become overdue only after their own end time',()=>{
 const result=counts(sample(),'2026-10-18T13:21:00+08:00');
 assert.equal(result.unmarked,2);
});
test('no class or absence is counted against a different date',()=>{
 const result=counts(sample(),'2026-10-19T13:21:00+08:00');
 assert.equal(result.absent,0);
 assert.equal(result.unmarked,0);
});
test('class after midnight does not inherit yesterday report',()=>{
 const result=counts(sample(),'2026-10-19T00:01:00+08:00');
 assert.equal(result.unmarked,0);
});
test('empty or invalid report produces no fabricated counts',()=>{
 assert.equal(counts(null,'2026-10-18T11:10:00+08:00').unmarked,0);
 assert.equal(counts(sample({items:[],courseSummary:[]}),'2026-10-18T11:10:00+08:00').absent,0);
});
test('clicking either attendance todo leads to the real attendance followup screen',()=>{
 assert.match(source,/\['absent','unmarked'\]\.includes\(b\.dataset\.adminTodo\)/);
 assert.match(source,/openSchoolAdminWorkspace\('attendance'\)/);
 assert.match(source,/todayAdminFollowup/);
});
test('attendance load failures are not shown as confirmed zero pending',()=>{
 assert.match(source,/summary\.error=results\.some\(result=>result\.status==='rejected'\)\|\|!summary\.attendance/);
});

test('acknowledged absence remains absent but disappears from unresolved todo counter',()=>{
 const input=sample({items:[
  {studentId:'101',status:'absent',classType:'section',followup:{state:'acknowledged'}},
  {studentId:'102',status:'leave',classType:'ensemble'},
  {studentId:'103',status:'absent',classType:'comprehensive',followup:{state:'pending'}},
  {studentId:'104',status:'absent',classType:'private'}
 ]});
 assert.equal(counts(input,'2026-10-18T11:10:00+08:00').absent,1);
});
test('backend acknowledgement must not rewrite the attendance record',()=>{
 const backend=readFileSync(new URL('../api/src/functions/attendanceReport.js',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../app/admin-operations.js',import.meta.url),'utf8');
 assert.match(backend,/if\(a\.role!=="admin"\)return json\(\{error:"Forbidden"\},403\)/);
 assert.match(backend,/const acknowledging=request\.method==="PATCH"&&request\.query\.get\("mode"\)==="acknowledge"/);
 assert.match(backend,/if\(acknowledging\)return json/);
 assert.match(backend,/請由學校老師在校方出缺勤畫面標記已知悉/);
 assert.match(backend,/pendingAbsence:items\.filter\(/);
 assert.match(admin,/data-followup-ack/);
 assert.match(admin,/window\.acknowledgeAdminAbsence/);
 assert.match(backend,/schoolAcknowledgement\(saved,x.recordVersion,schoolId\)/);
 assert.match(admin,/請由學校老師在校方出缺勤畫面標記已知悉/);
});
