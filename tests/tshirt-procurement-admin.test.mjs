import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import * as model from "../app/tshirt-procurement-plan.mjs";
function harness(failure="",{holdRequests=false}={}){
 const nodes=new Map(),node=id=>{
  if(!nodes.has(id))nodes.set(id,{id,value:"",hidden:false,disabled:false,options:[],children:[],handlers:{},dataset:{},setAttribute(){},addEventListener(k,fn){this.handlers[k]=fn},replaceChildren(...children){this.options=children;this.children=children;this.innerHTML=""},add(option){this.options.push(option)},append(...children){this.children.push(...children)}});
  return nodes.get(id);
 };
 const posts=[];let csv="",getCount=0,releaseRequests,heldSignal;const held=new Promise(resolve=>{heldSignal=resolve});
 const bodies={"student-master":{items:[{studentId:"111001",studentName:"學生甲",groupName:"C",status:"active"}]},"uniform-events/tshirt-historical-size":{items:[{studentId:"111001",historicalIssued:false,size:"10"}]},"uniform-events/requests":{items:[]},"uniform-events/inventory":{items:model.TSHIRT_PLAN_SIZES.map(size=>({key:"regular:"+size,onHand:0,reserved:0,unavailable:0}))},"uniform-events/parent-loans?view=procurement":{items:[],canVerifyFinance:false},"uniform-events/parent-loans":{items:[]},"uniform-events/tshirt-purchase-orders":{items:[]},"student-parent-links":{items:[]}};
 const window={uniformEventAuthHeaders:()=>({"X-School-Id":"school-a"}),addEventListener(){},dispatchEvent(){}};
 const scope={...model,window,confirm:()=>true,prompt:()=>"取消測試",CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,createElement:tag=>({tagName:tag.toUpperCase(),textContent:"",className:"",type:"",disabled:false,children:[],handlers:{},setAttribute(){},append(...children){this.children.push(...children)},addEventListener(k,fn){this.handlers[k]=fn},click(){},download:"",href:""})},Option:class{constructor(text,value){this.text=text;this.value=value}},Intl,Date,AbortController,setTimeout,clearTimeout,crypto:{randomUUID:()=>"123e4567-e89b-42d3-a456-426614174000"},Blob:class{constructor(parts){this.value=parts.join("")}},URL:{createObjectURL:blob=>{csv=blob.value;return "test-blob"},revokeObjectURL(){}},fetch:async(path,options)=>{getCount++;assert.equal(options.cache,"no-store");assert.equal(options.headers["X-School-Id"],"school-a");const key=path.replace("/api/","");if(options.method==="POST"){const body=JSON.parse(options.body);posts.push(body);return {ok:true,status:200,json:async()=>({item:{id:body.requestKey||body.id,orderNumber:"T-TEST",totalQuantity:10,links:body.links||[]}})}}return {ok:key!==failure,status:key===failure?500:200,json:async()=>{if(key==="uniform-events/requests"&&holdRequests){holdRequests=false;const snapshot=structuredClone(bodies[key]);heldSignal();await new Promise(resolve=>{releaseRequests=resolve});return snapshot}return key===failure?{error:"讀取失敗"}:bodies[key]}}},console};
 const source=readFileSync(new URL("../app/tshirt-procurement-admin.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"");
 runInNewContext(source+"\nthis.ui={load,draw};",scope);
 node("tshirtPlanYear").value=115;node("tshirtPlanSemester").value=1;
 return {node,bodies,posts,load:scope.ui.load,csv:()=>csv,getCount:()=>getCount,held,releaseRequests:()=>releaseRequests()};
}
test("procurement view loads all authoritative sources and exports exactly the visible plan",async()=>{
 const h=harness();await h.load();assert.equal(h.getCount(),8);assert.equal(h.node("exportTshirtPlan").disabled,false);assert.match(h.node("tshirtPlanMetrics").innerHTML,/學生首次公費/);assert.match(h.node("tshirtPlanOrderTotal").textContent,/規劃採購 1 件/);
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
test("known-size order can be confirmed while an unsized demand remains visibly excluded",async()=>{
 const h=harness();h.bodies["uniform-events/tshirt-historical-size"].items[0].size=null;await h.load();
 const target={dataset:{planExtra:"M"},value:"10",setCustomValidity(){}};h.node("tshirtPlanSizeRows").handlers.change({target});
 assert.equal(h.node("confirmTshirtPurchaseOrder").disabled,false);assert.match(h.node("tshirtPurchaseOrderHint").textContent,/1 件待填尺寸/);assert.match(h.node("tshirtPlanStatus").textContent,/可先建立採購單/);
});
test("a paid demand can be purchased while other applications remain pending",async()=>{
 const h=harness();
 const requests=h.bodies["uniform-events/requests"].items;
 requests.push({id:"paid",kind:"regularUniform",studentId:"111001",size:"M",quantity:9,status:"APPROVED",paymentStatus:"VERIFIED",createdAt:"2026-11-17T00:00:00Z"});
 requests.push({...requests[0],id:"unpaid",quantity:2,paymentStatus:"REPORTED_UNVERIFIED"});
 await h.load();
 assert.match(h.node("tshirtPlanOrderTotal").textContent,/規劃採購 10 件/);
 assert.equal(h.node("confirmTshirtPurchaseOrder").disabled,false);
 assert.match(h.node("tshirtPlanStatus").textContent,/已自動列入採購/);
 assert.match(h.node("tshirtPlanWarnings").innerHTML,/2 件待審核、匯款或財務核帳，尚未列入採購/);
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

test("a verification update during an older procurement read queues one fresh read instead of dropping the update",async()=>{
 const h=harness("",{holdRequests:true});h.bodies["uniform-events/tshirt-historical-size"].items[0].historicalIssued=true;
 const order={id:"paid-after-supplement",kind:"regularUniform",studentId:"111001",size:"S",quantity:1,status:"APPROVED",paymentStatus:"SUPPLEMENT_REPORTED",createdAt:"2026-11-21T10:00:00Z"};
 h.bodies["uniform-events/requests"].items=[order];const first=h.load();await h.held;
 order.paymentStatus="VERIFIED";await h.load();await h.load();h.releaseRequests();await first;
 assert.equal(h.getCount(),16);assert.match(h.node("tshirtPlanOrderTotal").textContent,/規劃採購 1 件/);assert.match(h.node("tshirtPlanDetailRows").innerHTML,/已入帳，已列入採購需求/);
 assert.doesNotMatch(h.node("tshirtPlanWarnings").innerHTML,/尚未列入採購/);
});


test("confirming a planned master order includes paid parents and no individual procurement writes",async()=>{
 const h=harness();h.bodies["uniform-events/tshirt-historical-size"].items[0].historicalIssued=true;
 h.bodies["uniform-events/requests"].items=[{id:"paid",etag:"request-etag",kind:"regularUniform",studentId:"111001",size:"S",quantity:1,status:"APPROVED",paymentStatus:"VERIFIED",createdAt:"2026-11-21T00:00:00Z"},{id:"unpaid",kind:"regularUniform",studentId:"111001",size:"S",quantity:1,status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",createdAt:"2026-11-21T00:00:00Z"}];
 await h.load();h.node("tshirtPlanSizeRows").handlers.change({target:{dataset:{planExtra:"S"},value:"9",setCustomValidity(){}}});
 await h.node("confirmTshirtPurchaseOrder").handlers.click();assert.equal(h.posts.length,1);assert.equal(h.posts[0].action,"CREATE");assert.deepEqual(JSON.parse(JSON.stringify(h.posts[0].links)),[{type:"REQUEST",id:"paid",etag:"request-etag"}]);
});
test("saved orders expose one whole-order receipt and an explicit opt-in for previously arrived parent applications",async()=>{
 const h=harness();h.bodies["uniform-events/tshirt-historical-size"].items[0].historicalIssued=true;
 h.bodies["uniform-events/requests"].items=[{id:"legacy",etag:"legacy-etag",kind:"regularUniform",studentId:"111001",size:"S",quantity:1,status:"READY_FOR_PICKUP",paymentStatus:"VERIFIED",createdAt:"2026-11-21T00:00:00Z"}];
 h.bodies["uniform-events/tshirt-purchase-orders"].items=[{id:"po",etag:"po-etag",orderNumber:"T-EXISTING",schoolYear:115,semester:1,status:"ORDERED",createdAt:"2026-11-21T00:00:00Z",totalQuantity:10,items:[{size:"S",quantity:10}],links:[]}];
 await h.load();const descendants=node=>(node.children||[]).flatMap(child=>[child,...descendants(child)]),nodes=descendants(h.node("tshirtPurchaseOrders"));
 const check=nodes.find(x=>x.type==="checkbox");assert.equal(check.checked,false);
 const form=nodes.find(x=>x.className==="tshirt-order-receive");assert.ok(form);const children=descendants(form),date=children.find(x=>x.type==="date"),note=children.find(x=>x.tagName==="TEXTAREA");note.value="十件外觀與尺碼無誤";form.handlers.input();
 await h.load();const restored=descendants(h.node("tshirtPurchaseOrders")).find(x=>x.className==="tshirt-order-receive");assert.equal(descendants(restored).find(x=>x.tagName==="TEXTAREA").value,note.value);
 await restored.handlers.submit({preventDefault(){}});assert.equal(h.posts.length,1);assert.equal(h.posts[0].action,"RECEIVE");assert.equal(h.posts[0].id,"po");assert.equal(h.posts[0].etag,"po-etag");assert.equal(h.posts[0].receivedDate,date.value);assert.equal(h.posts[0].note,note.value);
});
