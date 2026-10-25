import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const directorySource=readFileSync(new URL("../src/functions/teacherDirectory.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"");
const masters=[{rowKey:"111001",studentName:"學生甲",status:"active"},{rowKey:"111002",studentName:"學生乙",status:"active"},{rowKey:"SH-OLD",studentName:"舊編號姓名",status:"inactive",replacedByStudentId:"111001"},{rowKey:"000003",studentName:"畢業學生丙",status:"inactive"}];
const lesson=(id,rating,extra={})=>({studentId:id,teacher:"teacher@example.org",teacherRating:rating,teacherReview:"原始評論 "+id,eventDate:"2026-10-22",teacherRatedAt:"2026-10-22T12:00:00Z",teacherRatedBy:"parent@example.org",rowKey:"lesson-"+id,...extra});
function harness(lessons,role="admin"){
 const handlers={},calls=[];
 const context={app:{http:(name,config)=>handlers[name]=config.handler},getTenantContext:async()=>({access:{role},schoolId:"school-a"}),json:(jsonBody,status=200)=>({jsonBody,status}),isPrivateOnlyTeacher:()=>false,
  listActivityRange:async(...args)=>{calls.push(["lessons",...args]);return lessons},listStudentMaster:async(...args)=>{calls.push(["students",...args]);return masters},listTeacherDirectory:async schoolId=>{calls.push(["teachers",schoolId]);return [{rowKey:"teacher@example.org",teacherName:"老師甲",status:"active"}]},getTeacherProfile:async()=>null,activityStudentId:r=>r.studentId||String(r.partitionKey||"").split("|student|")[1],
  getStudentAliasInfo:async(id,schoolId)=>{calls.push(["alias",id,schoolId]);return {canonicalStudentId:id==="SH-OLD"?"111001":id}},
  saveTeacherDirectory:async()=>{throw Error("GET must not write")},saveTeacherProfile:async()=>{throw Error("GET must not write")},console,URL};
 runInNewContext(directorySource,context);
 return {calls,get:()=>handlers.teacherDirectory({method:"GET",query:new URLSearchParams({schoolId:"school-b"})})};
}
test("each review identifies its own student and original reviewing parent, including siblings and legacy IDs",async()=>{
 const h=harness([lesson("111001",5,{teacherRatedAt:"2026-10-24T12:00:00Z"}),lesson("111002",4,{teacherRatedAt:"2026-10-23T12:00:00Z"}),lesson("SH-OLD",3),lesson("111001",5,{teacherReview:"",rowKey:"rating-only"})]);
 const response=await h.get(),teacher=response.jsonBody.items[0],rows=teacher.recentReviews;
 assert.equal(response.status,200);assert.equal(response.headers["Cache-Control"],"no-store");
 assert.equal(teacher.ratingCount,4);assert.equal(teacher.ratingAverage,4.25);assert.equal(teacher.fiveStarCount,2);
 assert.deepEqual(Array.from(rows,r=>[r.studentId,r.studentName]),[["111001","學生甲"],["111002","學生乙"],["111001","學生甲"]]);
 assert.ok(rows.every(r=>r.reviewerEmail==="parent@example.org"));assert.equal(rows[2].lessonId,"lesson-SH-OLD");
 assert.ok(h.calls.every(row=>!row.includes("school-b")));assert.deepEqual(h.calls.find(row=>row[0]==="alias"),["alias","SH-OLD","school-a"]);
});
test("inactive students remain identifiable; unresolved old records never borrow a current parent or child",async()=>{
 const h=harness([lesson("000003",5,{teacherRatedAt:"2026-10-25T12:00:00Z"}),lesson("ARCHIVE",4,{studentName:"原單學生快照",teacherRatedBy:"",teacherRatedAt:"2026-10-24T12:00:00Z"}),lesson("MISSING",3,{teacherRatedBy:"",teacherRatedAt:"2026-10-23T12:00:00Z"})]);
 const data=(await h.get()).jsonBody,rows=data.items[0].recentReviews;
 assert.equal(rows[0].studentName,"畢業學生丙");assert.equal(rows[1].studentName,"原單學生快照");assert.equal(rows[1].reviewerEmail,"");assert.equal(rows[2].studentName,"");assert.equal(rows[2].studentId,"MISSING");
 assert.deepEqual(Array.from(data.students,s=>s.studentId),["111001","111002"]);
});
test("parent and teacher roles cannot read family review identities or trigger data queries",async()=>{
 for(const role of ["parent","teacher","school"]){const h=harness([lesson("111001",5)],role);assert.equal((await h.get()).status,403);assert.equal(h.calls.length,0)}
});
test("teacher review cards show student, original parent, lesson and review dates with HTML escaping",()=>{
 const teacher={email:"teacher@example.org",teacherName:"老師甲",ratingCount:1,ratingAverage:5,fiveStarCount:1,recentReviews:[{rating:5,review:'<script>alert("review")</script>',studentId:"111001",studentName:'<img src="x">',reviewerEmail:'<parent@example.org>',lessonDate:"2026-10-22",ratedAt:"2026-10-22T12:00:00Z"},{rating:4,review:"舊評論",studentId:"SH-OLD"}]};
 const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
 const context={state:{me:{role:"parent"},teachers:[teacher],teacherStudents:[]},loadAdmin:async()=>{},adminPage:()=>"",render:()=>{},esc,window:null};context.window=context;
 runInNewContext(readFileSync(new URL("../../app/teacher-admin.js",import.meta.url),"utf8"),context);
 const html=context.teacherAdminManagementHtml();
 assert.match(html,/學生：&lt;img/);assert.match(html,/學號：111001/);assert.match(html,/評論家長：&lt;parent@example.org&gt;/);assert.match(html,/上課日期：2026-10-22/);assert.match(html,/評論時間：2026\/10\/22\s+20:00/);
 assert.match(html,/學生資料待確認/);assert.match(html,/舊紀錄未記錄家長帳號/);assert.match(html,/學生編號：SH-OLD/);
 assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;script&gt;/);
});
