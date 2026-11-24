import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {buildTodayCourseCards,buildActivityCalendarCards,buildLatestAnnouncementCards} from "../api/src/lib/lineReplyCards.mjs";
import {formatLineTodayCourses,uniquePrivateLessons} from "../api/src/lib/lineTodayCoursesFormat.mjs";
import {formatLineActivityCalendar,uniqueActivityEvents} from "../api/src/lib/lineActivityCalendarFormat.mjs";
import {formatLineLatestAnnouncements,isImportantAnnouncement,uniqueAnnouncementEvents} from "../api/src/lib/lineLatestAnnouncementsFormat.mjs";

const source=readFileSync(new URL("../api/src/lib/tenantLineReplies.mjs",import.meta.url),"utf8").replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const date=new Date("2026-11-24T08:00:00Z");
function fixture({approved=true,admin=false}={}){
 const reads=[],children=[{studentId:"one",name:"孩子甲",groupName:"A"},{studentId:"two",name:"孩子乙",groupName:"A"}];
 const shared={schoolId:"school-a",eventType:"training",eventDate:"2026-11-28",title:"集合時間調整",startTime:"09:00",endTime:"11:00",note:"請提早至大門集合",location:"學校"};
 const globals={console,
  buildTodayCourseCards,buildActivityCalendarCards,buildLatestAnnouncementCards,formatLineTodayCourses,formatLineActivityCalendar,formatLineLatestAnnouncements,
  uniquePrivateLessons,uniqueActivityEvents,uniqueAnnouncementEvents,isImportantAnnouncement,isTrainingEventType:type=>type==='training',
  listTenantRolesByEmail:async(email,status)=>{reads.push({type:'roles',email,status});return admin?[{schoolId:'school-a',role:'schoolAdmin'}]:[{schoolId:'school-b',role:'schoolAdmin'}]},
  tenantLineParentStudents:async(school,email)=>{reads.push({type:'children',school,email});return approved?children:[]},
  resolveSchoolCourses:async(school,_date,student)=>{reads.push({type:'courses',school,student:student?.studentId});return [{courseName:'合奏課',startTime:'12:30',endTime:'13:20',groupName:'A'}]},
  listCalendarEvents:async(school)=>{reads.push({type:'events',school});return [shared,{...shared,title:'一般加練',note:''}]},
  calendarEventsForStudent:async(school,_from,_to,student)=>{reads.push({type:'events',school,student:student.studentId});return [shared,{...shared}]},
  listByStudent:async(type,id,_from,_to,school)=>{reads.push({type,school,student:id});return [{rowKey:'private-'+id,eventDate:'2026-11-24',startTime:'19:00',endTime:'20:00',teacherName:'授課老師'}]}
 };
 const api=runInNewContext(source+';({tenantLineParentReply,tenantLineStaffReply})',globals);
 return {...api,reads};
}
const bubbles=message=>message.contents.type==='bubble'?[message.contents]:message.contents.contents;

test("authorized parent cards use only their approved children and retain deduplicated calendar and important-news filters",async()=>{
 const h=fixture(),account={parentEmail:'approved@example.invalid'};
 const today=await h.tenantLineParentReply('today','school-a',account,date,{cards:true});assert.equal(today.type,'flex');
 const text=JSON.stringify(today.contents);assert.match(text,/孩子甲/);assert.match(text,/孩子乙/);assert.match(text,/個別課/);
 const calendar=await h.tenantLineParentReply('calendar','school-a',account,date,{cards:true});assert.equal(calendar.type,'flex');assert.equal(bubbles(calendar).length,1);
 const news=await h.tenantLineParentReply('announcements','school-a',account,date,{cards:true});assert.equal(news.type,'flex');assert.match(JSON.stringify(news.contents),/請提早至大門集合/);
 assert.equal(h.reads.filter(row=>row.type==='children').every(row=>row.email===account.parentEmail),true);
 assert.equal(h.reads.every(row=>!row.school||row.school==='school-a'),true);
 assert.equal(h.reads.filter(row=>row.type==='privateLesson').every(row=>['one','two'].includes(row.student)),true);
});

test("unbound and unapproved parents receive no child or course cards",async()=>{
 const h=fixture({approved:false});const unbound=await h.tenantLineParentReply('today','school-a',null,date,{cards:true});assert.equal(typeof unbound,'string');assert.equal(h.reads.length,0);
 const pending=await h.tenantLineParentReply('today','school-a',{parentEmail:'pending@example.invalid'},date,{cards:true});assert.equal(typeof pending,'string');assert.match(pending,/尚無已核准/);
 assert.equal(h.reads.length,1);assert.equal(h.reads[0].type,'children');
});

test("school staff cards retain live same-school admin authorization and do not query private lessons",async()=>{
 const denied=fixture();const result=await denied.tenantLineStaffReply('today','school-a',{googleEmail:'staff@example.invalid'},date,{cards:true});assert.equal(typeof result,'string');assert.match(result,/尚無本校/);assert.deepEqual(denied.reads.map(row=>row.type),['roles']);
 const h=fixture({admin:true});const today=await h.tenantLineStaffReply('today','school-a',{googleEmail:'staff@example.invalid'},date,{cards:true});assert.equal(today.type,'flex');assert.doesNotMatch(JSON.stringify(today.contents),/孩子甲|孩子乙|個別課|授課老師/);
 const news=await h.tenantLineStaffReply('announcements','school-a',{googleEmail:'staff@example.invalid'},date,{cards:true});assert.equal(bubbles(news).length,1);assert.doesNotMatch(JSON.stringify(news.contents),/一般加練/);
 assert.equal(h.reads.some(row=>['children','privateLesson'].includes(row.type)),false);assert.equal(h.reads.every(row=>!row.school||row.school==='school-a'),true);
});
