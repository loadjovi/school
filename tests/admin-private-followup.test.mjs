import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
function pageHarness(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:["group","privateTeacher"].includes(id)?"ALL":id==="followup"?"all":"",addEventListener(){},setAttribute(){}});return nodes.get(id)};
 const context={document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){}},window:{},sessionStorage:{getItem:()=>null},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>{},Intl,Date,URLSearchParams};
 context.window=context;
 const script=readFileSync(new URL("../app/admin-semester-scores.html",import.meta.url),"utf8").split("<script>")[1].split("</script>")[0].replace(/\nload\(\);\n/,"\nwindow.testPage={config,filtered,teacherText,teacherMarkup,followupMarkup,buildMobileCard,csvSafe};\n");
 runInNewContext(script,context);return {...context.testPage,node};
}
test("pending filter finds missing private grades and teacher filter uses bindings or actual record teachers",()=>{
 const p=pageHarness();p.config.students=[{studentId:"1",name:"甲",groupName:"A"},{studentId:"2",name:"乙",groupName:"B"},{studentId:"3",name:"丙",groupName:"A"}];
 for(const id of ["1","2","3"])p.config.scores.set(id,{score:{semesterScore:{performance5:id==="3"?2.5:null,performanceSource:id==="3"?"privateLessonFrequency":"pending"}}});
 p.config.followups.set("1",{assignedTeachers:[{email:"a",name:"甲老師"}],recordTeachers:[],recordCount:0});
 p.config.followups.set("3",{assignedTeachers:[],recordTeachers:[{email:"b",name:"乙老師"}],recordCount:1});
 p.node("followup").value="score_pending";assert.deepEqual(Array.from(p.filtered(),x=>x.studentId),["1"]);
 p.node("followup").value="all";p.node("privateTeacher").value="b";assert.deepEqual(Array.from(p.filtered(),x=>x.studentId),["3"]);
 assert.equal(p.teacherText({studentId:"3"}),"乙老師（紀錄老師）");
 p.node("privateTeacher").value="ALL";p.node("followup").value="no_records";assert.deepEqual(Array.from(p.filtered(),x=>x.studentId),["1"]);
});
test("desktop and mobile follow-up output escapes names and preserves official pending scores",()=>{
 const p=pageHarness(),student={studentId:"1",name:"測試學生",groupName:"A"};
 p.config.followups.set("1",{assignedTeachers:[{email:"a",name:'<img onerror="x">'}],recordTeachers:[],recordCount:0,teacherPending:0,awaitingParent:0,upcoming:0,issues:0,cancelled:0,other:0,lastLessonDate:""});
 p.config.scores.set("1",{score:{semesterScore:{practice10:4,attendance5:5,performance5:null,total20:null,privateLessonCompleted:0}}});
 assert.match(p.teacherMarkup(student),/&lt;img/);assert.doesNotMatch(p.teacherMarkup(student),/<img/);
 const mobile=p.buildMobileCard(student);assert.match(mobile,/個課老師/);assert.match(mobile,/尚無個課紀錄/);assert.match(mobile,/待完成/);assert.match(mobile,/已取得 9 分（非總分）/);
 assert.equal(p.csvSafe("=SUM(A1)"),'"\'=SUM(A1)"');
});
