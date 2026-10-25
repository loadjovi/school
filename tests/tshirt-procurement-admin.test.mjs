import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import * as model from "../app/tshirt-procurement-plan.mjs";
function harness(failure=""){
 const nodes=new Map(),node=id=>{
  if(!nodes.has(id))nodes.set(id,{id,value:"",hidden:false,disabled:false,options:[],handlers:{},dataset:{},addEventListener(k,fn){this.handlers[k]=fn},replaceChildren(...children){this.options=children;this.innerHTML=""},add(option){this.options.push(option)},append(){}});
  return nodes.get(id);
 };
 let csv="",getCount=0;
 const bodies={"student-master":{items:[{studentId:"111001",studentName:"學生甲",groupName:"C",status:"active"}]},"uniform-events/tshirt-historical-size":{items:[{studentId:"111001",historicalIssued:false,size:"10"}]},"uniform-events/requests":{items:[]},"uniform-events/inventory":{items:model.TSHIRT_PLAN_SIZES.map(size=>({key:"regular:"+size,onHand:0,reserved:0,unavailable:0}))},"uniform-events/parent-loans?view=procurement":{items:[],canVerifyFinance:false},"uniform-events/parent-loans":{items:[]},"student-parent-links":{items:[]}};
 const window={uniformEventAuthHeaders:()=>({"X-School-Id":"school-a"}),addEventListener(){},dispatchEvent(){}};
 const scope={...model,window,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,createElement:tag=>({click(){},download:"",href:""})},Option:class{constructor(text,value){this.text=text;this.value=value}},Intl,Date,AbortController,setTimeout,clearTimeout,Blob:class{constructor(parts){this.value=parts.join("")}},URL:{createObjectURL:blob=>{csv=blob.value;return "test-blob"},revokeObjectURL(){}},fetch:async(path,options)=>{getCount++;assert.equal(options.cache,"no-store");assert.equal(options.headers["X-School-Id"],"school-a");const key=path.replace("/api/","");return {ok:key!==failure,status:key===failure?500:200,json:async()=>key===failure?{error:"讀取失敗"}:bodies[key]}},console};
 const source=readFileSync(new URL("../app/tshirt-procurement-admin.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"");
 runInNewContext(source+"\nthis.ui={load,draw};",scope);
 node("tshirtPlanYear").value=115;node("tshirtPlanSemester").value=1;
 return {node,bodies,load:scope.ui.load,csv:()=>csv,getCount:()=>getCount};
}
test("procurement view loads all authoritative sources and exports exactly the visible plan",async()=>{
 const h=harness();await h.load();assert.equal(h.getCount(),7);assert.equal(h.node("exportTshirtPlan").disabled,false);assert.match(h.node("tshirtPlanMetrics").innerHTML,/學生首次公費/);assert.match(h.node("tshirtPlanOrderTotal").textContent,/規劃採購 1 件/);
 h.node("exportTshirtPlan").handlers.click();assert.match(h.csv(),/學生甲/);assert.match(h.csv(),/尺碼彙總/);
 h.node("exportTshirtSupplierPlan").handlers.click();assert.doesNotMatch(h.csv(),/學生甲|111001/);
});
test("any source failure blocks zero-looking totals and exports instead of silently dropping staff or first-time needs",async()=>{
 for(const path of ["uniform-events/tshirt-historical-size","uniform-events/inventory","uniform-events/parent-loans?view=procurement"]){
  const h=harness(path);await h.load();assert.equal(h.node("exportTshirtPlan").disabled,true);assert.equal(h.node("exportTshirtSupplierPlan").disabled,true);assert.match(h.node("tshirtPlanStatus").textContent,/讀取失敗/);assert.equal(h.node("tshirtPlanMetrics").innerHTML,"");
 }
});
test("explicit per-size stock additions flow into the same one-click export",async()=>{
 const h=harness();await h.load();
 const target={dataset:{planExtra:"M"},value:"9",setCustomValidity(){}};h.node("tshirtPlanSizeRows").handlers.change({target});
 assert.match(h.node("tshirtPlanOrderTotal").textContent,/規劃採購 10 件/);h.node("exportTshirtPlan").handlers.click();assert.match(h.csv(),/"M",(?:[^\r\n]*),"9","9"/);
});
test("finance header includes staff demand and does not claim zero before the staff source is available",()=>{
 const source=readFileSync(new URL("../app/uniform-event-admin.js",import.meta.url),"utf8");
 const start=source.indexOf("let cachedStaffFinanceItems=null;"),end=source.indexOf("async function refreshFinancePending",start);
 const summary={textContent:""},review={dataset:{},querySelector:()=>summary};
 const scope={hasFinanceAccess:true,el:()=>review};
 runInNewContext(source.slice(start,end)+"\nthis.setStaff=items=>{cachedStaffFinanceItems=items};this.draw=showFinancePending;",scope);
 scope.draw([],[]);assert.match(summary.textContent,/尚未讀取完成/);
 scope.setStaff([{category:"VOLUNTEER_EXTRA",status:"APPROVED",paymentStatus:"AWAITING_TRANSFER"},{category:"CADRE_FIRST",status:"APPROVED",paymentStatus:"NOT_REQUIRED"},{category:"CADRE_EXTRA",status:"CANCELLED",paymentStatus:"AWAITING_TRANSFER"},{category:"CADRE_EXTRA",status:"APPROVED",paymentStatus:"VERIFIED"}]);
 scope.draw([],[]);assert.match(summary.textContent,/待財務核帳 1 筆/);assert.match(summary.textContent,/幹部／志工 1/);assert.equal(review.dataset.pending,"true");
 scope.setStaff([]);scope.draw([],[]);assert.match(summary.textContent,/目前無待核帳款項/);
});
