import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=p=>readFileSync(new URL("../app/"+p,import.meta.url),"utf8"),source=read("parent-uniform-events.js");
class Element{
 constructor(tag="div"){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.style={};this.attributes={};this.handlers={};this.ownText="";this.open=false;this.hidden=false;this.id="";this.className=""}
 get textContent(){return this.ownText+this.children.map(child=>child.textContent||"").join("")}
 set textContent(text){this.ownText=String(text);this.children=[]}
 get childElementCount(){return this.children.length}
 append(...children){for(const child of children){child.parentElement=this;this.children.push(child)}}
 prepend(...children){for(const child of children)child.parentElement=this;this.children.unshift(...children)}
 replaceChildren(...children){this.ownText="";this.children=[];this.append(...children)}
 setAttribute(key,value){this.attributes[key]=value}
 addEventListener(key,handler){this.handlers[key]=handler}
 get all(){return this.children.flatMap(child=>[child,...child.all])}
 matches(selector){const [tag,cls]=selector.split(".");return this.tagName===tag.toUpperCase()&&(!cls||this.className.split(" ").includes(cls))}
 querySelectorAll(selector){return this.all.filter(child=>child.matches(selector))}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 closest(selector){for(let row=this;row;row=row.parentElement)if(row.matches(selector))return row;return null}
 scrollIntoView(){this.scrolled=true}focus(){this.focused=true}
}
const first={studentId:"1",studentName:"甲同學",historicalIssued:true,received:true,size:"12",receivedAt:"2026-11-19T01:00:00Z"};
const order=(id="old",extra={})=>({id,studentId:"1",kind:"regularUniform",size:"S",quantity:1,amount:400,status:"FULFILLED",paymentStatus:"VERIFIED",createdAt:"2026-11-20T01:00:00Z",updatedAt:"2026-11-22T01:00:00Z",...extra});
function page({requests=[order()],tshirts=[first],focus=""}={}){
 const roots=Object.fromEntries(["uniformRequestSummary","uniformRequestHistory","uniformRequestProgress","panel-uniform"].map(id=>{const node=new Element();node.id=id;return [id,node]})),selections=[],calls=[];let fail=false;
 const scope={URLSearchParams,location:{search:focus?"?focus="+encodeURIComponent(focus):"",origin:"https://lab.example.test"},document:{getElementById:id=>Object.values(roots).flatMap(root=>[root,...root.all]).find(node=>node.id===id)||null,createElement:tag=>new Element(tag)},requestAnimationFrame:fn=>fn(),console,
  growthStudents:[],growthRequests:[],growthTshirts:[],growthRequestsLoaded:false,publicUsedStudentIds:new Set(),historicalPublicStudentIds:new Set(),renderUniformGrowth(){},syncCompetitionPublicEligibility(){},element:(tag,text,cls)=>{const node=new Element(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node},formatDate:value=>value||"",select:view=>{selections.push(view);roots["panel-uniform"].hidden=view!=="uniform"},
  parentApi:async(path,options)=>{calls.push({path,options});if(fail)throw Error("network unavailable");if(path==="me")return {role:"parent",students:[{studentId:"1",name:"甲同學"}]};if(path==="uniform-events/requests")return {items:requests};if(path==="uniform-events/tshirt-historical-size")return {items:tshirts};if(path.startsWith("uniform-events/uniform-payment-account"))return {item:{bankName:"銀行",bankCode:"807",accountHolder:"學校",accountNumber:"12345678"}};return {}},
  paymentResolutionUI:{active:new Set(["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED","REFUND_REQUESTED"]),labels:{ADJUSTMENT_REQUIRED:"待補款",VERIFIED:"已足額核帳"}}
 };scope.window=scope;scope.parent=scope;runInNewContext(read("uniform-payment-state.js"),scope);
 const start=source.indexOf("const uniformRequestStage="),end=source.indexOf('document.getElementById("refreshUniformRequests")',start);
 runInNewContext(source.slice(start,end)+";this.load=loadUniformRequestProgress;this.shortLabel=parentRequestLabel",scope);
 return {scope,roots,selections,calls,load:()=>scope.load(),get:id=>scope.document.getElementById(id),setFail:()=>{fail=true}};
}
test("completed first shirts and purchases move to collapsed history, leaving no duplicate progress panel",async()=>{
 const p=page();await p.load();assert.equal(p.roots.uniformRequestSummary.childElementCount,0);assert.equal(p.roots.uniformRequestProgress.hidden,true);assert.equal(p.roots.uniformRequestProgress.dataset.empty,"true");
 assert.match(p.roots.uniformRequestHistory.textContent,/首次團 T 領用紀錄/);const record=p.get("uniform-record-old");assert.equal(record.open,false);assert.match(record.children[0].textContent,/甲同學・S・已領取/);assert.equal(p.roots.uniformRequestHistory.children[0].open,false);
});
test("all active requests show name, size, state and one direct action while fulfilled orders stay historical",async()=>{
 const p=page({requests:[order("old"),order("pay",{size:"XS",status:"APPROVED",paymentStatus:"AWAITING_TRANSFER"}),order("review",{size:"M",status:"PENDING",amount:null,paymentStatus:""})]});await p.load();const summary=p.roots.uniformRequestSummary;
 assert.equal(summary.childElementCount,2);assert.equal(p.roots.uniformRequestProgress.hidden,false);assert.match(summary.textContent,/XS・1 件[\s\S]*NT\$ 400[\s\S]*查看帳戶／回報匯款/);assert.match(summary.textContent,/M・1 件[\s\S]*修改／取消申請/);assert.doesNotMatch(summary.textContent,/已領取|申請時間|更新時間/);
 const pay=summary.children.find(card=>card.textContent.includes("XS"));pay.querySelector("button").handlers.click();assert.equal(p.get("uniform-record-pay").open,true);assert.equal(p.get("uniform-record-old").open,false);assert.equal(p.selections.at(-1),"history");
});
test("missing historical size and actual first receipt remain actionable even without new purchase orders",async()=>{
 for(const record of [{...first,size:null},{...first,historicalIssued:false,received:false,schoolIssuedAt:"2026-11-21T01:00:00Z"}]){
  const p=page({requests:[],tshirts:[record]});await p.load();assert.equal(p.roots.uniformRequestProgress.hidden,false);assert.equal(p.roots.uniformRequestSummary.childElementCount,1);assert.match(p.roots.uniformRequestSummary.textContent,record.size?/確認收到團 T/:/填寫尺寸/);assert.doesNotMatch(p.roots.uniformRequestHistory.textContent,/首次團 T 領用紀錄/);
 }
});
test("a saved payment link opens that collapsed record and reveals the correct bank form",async()=>{
 const p=page({focus:"payment:pay",requests:[order("old"),order("pay",{status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",size:"XS"})]});await p.load();await Promise.resolve();assert.equal(p.get("uniform-record-pay").open,true);assert.equal(p.get("uniform-record-old").open,false);assert.equal(p.selections.at(-1),"history");assert.match(p.get("uniform-payment-pay").textContent,/12345678/);assert.ok(p.calls.some(call=>call.path.includes("requestId=pay")));
});
test("failed status reads show a visible retry state instead of hiding an error as no pending tasks",async()=>{
 const p=page();await p.load();p.setFail();await p.load();assert.equal(p.roots.uniformRequestProgress.hidden,false);assert.match(p.roots.uniformRequestSummary.textContent,/讀取失敗/);assert.doesNotMatch(p.roots.uniformRequestHistory.textContent,/已領取/);
});
test("ready badges never hide missing stock receipt or unverified payment",()=>{
 const p=page();assert.equal(p.scope.shortLabel(order("x",{status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",amount:null})),"待確認金額");assert.equal(p.scope.shortLabel(order("x",{status:"READY_FOR_PICKUP",stockReceivedAt:"now"})),"可以領取");assert.equal(p.scope.shortLabel(order("x",{status:"READY_FOR_PICKUP",stockReceivedAt:""})),"待學校確認");assert.equal(p.scope.shortLabel(order("x",{status:"READY_FOR_PICKUP",stockReceivedAt:"now",paymentStatus:"REPORTED_UNVERIFIED"})),"待學校確認");
});
test("closed adjustments render only in the history target, while pending balances remain at the top",async()=>{
 const host=new Element(),history=new Element(),scope={window:{},document:{documentElement:{hasAttribute:()=>true},createElement:tag=>new Element(tag),head:new Element("head")}};
 runInNewContext(read("payment-resolution.js"),scope);let items=[{id:"closed",sourceType:"uniform",title:"團 T",paymentStatus:"VERIFIED",paymentResolution:{expectedAmount:400,receivedAmount:400}}];const api=async()=>({items});
 await scope.window.paymentResolutionUI.loadParent(host,api,null,{historyHost:history});assert.equal(host.hidden,true);assert.equal(host.childElementCount,0);assert.equal(history.hidden,false);assert.equal(history.children[0].open,false);assert.match(history.textContent,/補款／退費已結案/);
 items=[...items,{id:"pending",sourceType:"uniform",title:"加購團 T",paymentStatus:"ADJUSTMENT_REQUIRED",paymentResolution:{expectedAmount:400,receivedAmount:300,balance:100,reason:"少付100"}}];await scope.window.paymentResolutionUI.loadParent(host,api,null,{historyHost:history});assert.equal(host.hidden,false);assert.match(host.textContent,/待處理款項（1）/);assert.match(host.textContent,/100/);assert.doesNotMatch(host.textContent,/已足額核帳/);assert.equal(history.children[0].open,false);
 await scope.window.paymentResolutionUI.loadParent(host,async()=>{throw Error("offline")},null,{historyHost:history});assert.equal(host.hidden,false);assert.equal(history.hidden,true);assert.equal(history.childElementCount,0);assert.match(host.textContent,/重新讀取/);
});
test("the mobile entry keeps navigation first and collapses the detailed size history",()=>{
 const html=read("parent-uniform-events.html"),css=read("parent-uniform-simple.css");assert.ok(html.indexOf('class="tabs"')<html.indexOf('id="newActivityNotice"'));assert.ok(html.indexOf('class="tabs"')<html.indexOf('id="paymentResolutionTasks"'));assert.match(html,/<details id="uniformGrowth"[^>]*><summary>尺寸與領用歷史<\/summary>/);assert.doesNotMatch(html,/<details id="uniformGrowth"[^>]*\bopen/);assert.match(css,/body\.embedded>#functional-uat-banner\{display:none!important\}/);assert.match(css,/min-height:44px/);assert.match(css,/max-width:520px/);assert.doesNotMatch(html,/先核對領用紀錄與尺寸；/);
});
