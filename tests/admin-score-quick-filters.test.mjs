import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const page=readFileSync(new URL("../app/admin-semester-scores.html",import.meta.url),"utf8");
function harness(){
 const nodes=new Map(),node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:["group","privateTeacher"].includes(id)?"ALL":id==="followup"?"all":"",attrs:{},handlers:{},setAttribute(name,value){this.attrs[name]=value},addEventListener(name,fn){this.handlers[name]=fn}});
  return nodes.get(id);
 };
 const tiles=["all","scored","pending","error"].map(status=>Object.assign(node(status),{dataset:{scoreStatus:status}}));
 let csv="";
 const context={document:{getElementById:node,querySelectorAll:selector=>selector==="[data-score-status]"?tiles:[],addEventListener(){},body:{append(){}},createElement:()=>({click(){},remove(){}})},window:null,sessionStorage:{getItem:()=>null},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>{},Intl,Date,URLSearchParams,Blob:class{constructor(parts){this.text=parts.join("")}},URL:{createObjectURL:blob=>{csv=blob.text;return "test-blob"},revokeObjectURL(){}}};
 context.window=context;
 const script=page.split("<script>")[1].split("</script>")[0].replace(/\nload\(\);\n/,"\nwindow.testPage={config,filtered,display,exportCsv,matchesScoreStatus};\n");
 runInNewContext(script,context);
 const p=context.testPage;
 p.config.students=[{studentId:"1",name:"甲",groupName:"A"},{studentId:"2",name:"乙",groupName:"A"},{studentId:"3",name:"丙",groupName:"A"},{studentId:"4",name:"丁",groupName:"B"},{studentId:"5",name:"戊",groupName:"A"}];
 p.config.scores.set("1",{score:{semesterScore:{practice10:0,attendance5:0,performance5:0,total20:0}}});
 p.config.scores.set("2",{score:{semesterScore:{practice10:4,attendance5:5,performance5:null,total20:null}}});
 p.config.scores.set("3",{error:"temporary request failure"});
 p.config.scores.set("4",{score:{semesterScore:{practice10:10,attendance5:5,performance5:5,total20:20,performanceSource:"sectionFinal"}}});
 for(const student of p.config.students)p.config.followups.set(student.studentId,{assignedTeachers:[{email:student.studentId==="4"?"b":"a",name:"老師"}],recordTeachers:[],recordCount:student.studentId==="2"?0:1,teacherPending:0,awaitingParent:0,upcoming:0,issues:0,cancelled:0,other:0,lastLessonDate:""});
 p.config.followupLoaded=true;
 return {...p,node,tiles,click:status=>tiles.find(t=>t.dataset.scoreStatus===status).handlers.click(),ids:()=>Array.from(p.filtered(),x=>x.studentId),csv:()=>csv};
}
test("clickable totals select the correct subset, including a valid zero score, without collapsing the other totals",()=>{
 const p=harness();p.display();
 p.click("scored");assert.deepEqual(p.ids(),["1","4"]);
 assert.deepEqual(["countStudents","countScored","countPending","countErrors"].map(id=>p.node(id).textContent),["5","2","1","1"]);
 assert.equal(p.node("scored").attrs["aria-pressed"],"true");assert.equal(p.node("all").attrs["aria-pressed"],"false");
 assert.equal(p.node("scoreFilterSummary").textContent,"目前顯示：目前可合計 /20（2 位）");
 assert.equal((p.node("rows").innerHTML.match(/<tr>/g)||[]).length,2);assert.equal((p.node("mobileStudents").innerHTML.match(/<article /g)||[]).length,2);
 p.click("pending");assert.deepEqual(p.ids(),["2"]);p.click("error");assert.deepEqual(p.ids(),["3"]);p.click("all");assert.deepEqual(p.ids(),["1","2","3","4","5"]);
});
test("numeric filter composes with group, teacher, tracking and scoring mode; All clears only the numeric filter",()=>{
 const p=harness();p.node("group").value="A";p.node("privateTeacher").value="a";p.config.mode="private";
 p.click("pending");assert.deepEqual(p.ids(),["2"]);assert.equal(p.node("countStudents").textContent,"4");
 p.node("followup").value="no_records";p.display();assert.equal(p.node("countStudents").textContent,"1");assert.deepEqual(p.ids(),["2"]);
 p.click("all");assert.deepEqual(p.ids(),["2"]);assert.equal(p.node("group").value,"A");assert.equal(p.node("privateTeacher").value,"a");assert.equal(p.config.mode,"private");assert.equal(p.node("followup").value,"no_records");
});
test("zero matches show a clear empty state; loading and failed records never count as unfinished grades",()=>{
 const p=harness();p.node("search").value="甲";p.config.loading=true;p.click("error");
 assert.deepEqual(p.ids(),[]);assert.equal(p.node("countErrors").textContent,"0");assert.match(p.node("rows").innerHTML,/目前沒有讀取失敗/);assert.match(p.node("mobileStudents").innerHTML,/目前沒有讀取失敗/);assert.match(p.node("scoreFilterSummary").textContent,/資料讀取中/);assert.equal(p.node("export").disabled,true);
 assert.equal(p.matchesScoreStatus(undefined,"pending"),false);assert.equal(p.matchesScoreStatus({error:"failed"},"pending"),false);
});
test("CSV exports only the same selected subset and controls use native keyboard-accessible buttons",()=>{
 const p=harness();p.click("pending");p.exportCsv();const lines=p.csv().trim().split("\r\n");
 assert.equal(lines.length,2);assert.match(lines[1],/"2","乙"/);assert.doesNotMatch(lines[1],/"甲"|"丙"|"丁"/);
 assert.equal((page.match(/<button[^>]+data-score-status=/g)||[]).length,4);
 assert.equal((page.match(/aria-controls="scoreStudentList"/g)||[]).length,4);assert.match(page,/<section class="card" id="scoreStudentList">/);
});
