import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {followupTerm,buildPrivateLessonFollowup} from "../src/lib/privateLessonFollowup.js";

const base={students:[{studentId:"111001",aliases:["SH001"]},{studentId:"111002",aliases:[]}],teachers:[{email:"one@example.org",teacherName:"甲老師",status:"active",privateStudentIds:'["SH001"]'},{email:"old@example.org",teacherName:"舊老師",status:"inactive",privateStudentIds:'["111002"]'}],start:"2026-10-01",end:"2026-12-31",today:"2026-10-25",nowTime:"18:00"};
test("shows actual bindings separately from historical teachers and never guesses by section",()=>{
 const rows=buildPrivateLessonFollowup({...base,lessons:[{studentId:"111002",rowKey:"a",eventDate:"2026-10-20",status:"present",teacher:"old@example.org"}]});
 assert.deepEqual(rows[0].assignedTeachers,[{email:"one@example.org",name:"甲老師"}]);
 assert.equal(rows[0].recordCount,0);assert.deepEqual(rows[1].assignedTeachers,[]);
 assert.deepEqual(rows[1].recordTeachers,[{email:"old@example.org",name:"舊老師",inactive:true}]);
});
test("alias sessions deduplicate while trial, other students and future completions stay out",()=>{
 const lesson={studentId:"SH001",eventDate:"2026-10-20",sessionId:"session1",rowKey:"a",teacher:"one@example.org",status:"teacher_completed",createdAt:"2026-10-20T01:00:00Z"};
 const rows=buildPrivateLessonFollowup({...base,lessons:[lesson,{...lesson,studentId:"111001",rowKey:"b",createdAt:"2026-10-20T02:00:00Z"},{...lesson,rowKey:"c",sessionId:"trial",eventDate:"2026-09-20"},{...lesson,studentId:"other-school-student",sessionId:"other"},{...lesson,eventDate:"2026-11-20",sessionId:"future"}]});
 assert.equal(rows[0].recordCount,1);assert.equal(rows[0].completed,1);assert.equal(rows[0].awaitingParent,1);assert.equal(rows[1].recordCount,0);
 assert.equal(rows[0].lastCompletedDate,"2026-10-20");
});
test("follow-up distinguishes overdue teacher work, future bookings, parent confirmation, issues and cancellations",()=>{
 const make=(rowKey,eventDate,status,extra={})=>({studentId:"111001",rowKey,eventDate,status,teacher:"one@example.org",...extra});
 const [row]=buildPrivateLessonFollowup({...base,lessons:[make("1","2026-10-25","scheduled",{endTime:"17:00"}),make("2","2026-10-25","scheduled",{endTime:"19:00"}),make("3","2026-11-01","scheduled"),make("4","2026-10-23","teacher_completed"),make("5","2026-10-22","present",{parentConfirmation:"confirmed"}),make("6","2026-10-21","completion_issue"),make("7","2026-10-20","cancelled")]});
 assert.equal(row.teacherPending,1);assert.equal(row.upcoming,2);assert.equal(row.awaitingParent,1);assert.equal(row.completed,2);assert.equal(row.issues,1);assert.equal(row.cancelled,1);
 assert.equal(row.lastLessonDate,"2026-10-25");
});
test("uses the same formal scoring months, including the next Gregorian year for term two",()=>{
 assert.deepEqual(followupTerm("115","1"),{start:"2026-10-01",end:"2026-12-31"});
 assert.deepEqual(followupTerm("115","2"),{start:"2027-02-01",end:"2027-05-31"});
 for(const values of [["115x","1"],["115","3"],["99","1"]])assert.equal(followupTerm(...values),null);
});
test("follow-up API is admin-only, uses the authenticated tenant, and never writes lesson data",async()=>{
 const handlers={},calls=[];let role="teacher";
 const context={app:{http:(name,config)=>handlers[name]=config.handler},getTenantContext:async()=>({access:{role},schoolId:"school-a"}),json:(jsonBody,status=200)=>({jsonBody,status}),followupTerm,buildPrivateLessonFollowup,activityStudentId:r=>r.studentId,Intl,Date,
 listStudentMaster:async(...args)=>{calls.push(["students",...args]);return [{rowKey:"111001"}]},listTeacherDirectory:async(...args)=>{calls.push(["teachers",...args]);return []},listActivityRange:async(...args)=>{calls.push(["lessons",...args]);return []},getStudentIdAliases:async(id,sid)=>{calls.push(["aliases",id,sid]);return [id]},getTeacherProfile:async()=>{throw Error("not needed")}};
 runInNewContext(readFileSync(new URL("../src/functions/adminPrivateLessonFollowup.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,""),context);
 const request=values=>handlers.adminPrivateLessonFollowup({query:new URLSearchParams({schoolYear:"115",semester:"1",schoolId:"school-b",...values})});
 assert.equal((await request()).status,403);assert.equal(calls.length,0);role="admin";
 assert.equal((await request({schoolYear:"bad"})).status,400);assert.equal(calls.length,0);
 const response=await request();assert.equal(response.status,200);assert.equal(response.headers["Cache-Control"],"no-store");assert.equal(response.jsonBody.items.length,1);
 assert.ok(calls.every(row=>!row.includes("school-b")));assert.deepEqual(calls.find(row=>row[0]==="lessons"),["lessons","privateLesson","school-a","2026-10-01","2026-12-31"]);
});
