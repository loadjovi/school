import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {randomUUID} from "node:crypto";
import {validatePurchaseOrderInput,tshirtPurchaseOrderSizes} from "../api/src/lib/tshirtPurchaseOrderRules.mjs";
import {normalizeReceivingDetails,statusAfterReceiving} from "../api/src/lib/uniformReceivingRules.mjs";
import {tshirtInventoryView} from "../api/src/lib/tshirtInventoryView.mjs";
import {buildTshirtProcurementPlan,tshirtOrderCandidates,TSHIRT_PLAN_SIZES} from "../app/tshirt-procurement-plan.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
function harness(){
 const handlers={},tables=new Map(),notices=[];let school="school-a",role="admin",version=0,hook=null,failWrite=null,loseBatch=false;
 const error=statusCode=>Object.assign(Error(String(statusCode)),{statusCode}),key=(p,r)=>p+"|"+r;
 const rows=name=>{if(!tables.has(name))tables.set(name,new Map());return tables.get(name)};
 const put=(name,row)=>{const next={...row,etag:"v"+(++version)};rows(name).set(key(row.partitionKey,row.rowKey),next);return next};
 const db=name=>({createTable:async()=>{},getEntity:async(p,r)=>{const value=rows(name).get(key(p,r));if(!value)throw error(404);return structuredClone(value)},
  createEntity:async row=>{if(rows(name).has(key(row.partitionKey,row.rowKey)))throw error(409);put(name,row)},
  updateEntity:async(row,mode,options)=>{if(failWrite?.name===name&&failWrite.id===row.rowKey){failWrite=null;throw error(503)}const old=rows(name).get(key(row.partitionKey,row.rowKey));if(!old)throw error(404);if(old.etag!==options?.etag)throw error(412);put(name,{...(mode==="Merge"?old:{}),...row})},
  listEntities:async function*({queryOptions:{filter}}){const partition=filter.match(/PartitionKey eq '([^']+)'/)[1];for(const row of rows(name).values())if(row.partitionKey===partition)yield structuredClone(row)},
  submitTransaction:async actions=>{
   if(hook){const fn=hook;hook=null;fn(name)}assert.ok(actions.length<=100);assert.equal(new Set(actions.map(([,row])=>row.partitionKey)).size,1);
   const staged=new Map(rows(name)),seen=new Set();
   for(const [action,row,,options] of actions){const k=key(row.partitionKey,row.rowKey),old=staged.get(k);assert.equal(seen.has(k),false);seen.add(k);if(action==="create"?!!old:!old||old.etag!==options.etag)throw error(action==="create"?409:412);staged.set(k,{...row,etag:"v"+(++version)})}
   tables.set(name,staged);if(name==="TenantUniformInventory"&&loseBatch){loseBatch=false;throw error(503)}
  }});
 const context={app:{http:(name,config)=>{handlers[name]=config.handler}},TableClient:{fromConnectionString:(_,name)=>db(name)},randomUUID,Buffer,validatePurchaseOrderInput,tshirtPurchaseOrderSizes,normalizeReceivingDetails,statusAfterReceiving,process:{env:{STORAGE_CONNECTION_STRING:"test"}},console:{error(){},warn(){}},
  getTenantContext:async()=>({schoolId:school,access:{role,email:"admin@example.test"},tenant:{schoolName:"測試學校"}}),json:(jsonBody,status=200)=>({status,jsonBody}),getStudentMaster:async id=>({studentName:"學生"+id,status:"active"}),getStudentAliasInfo:async id=>({canonicalStudentId:id}),listUserStudentMappings:async()=>[],sendUniformRequestStatusEmail:async input=>{notices.push(input);return {status:"sent"}}};
 const flow=runInNewContext(read("api/src/lib/tshirtPurchaseOrderFlow.js").replace(/^import .*;\n/gm,"").replaceAll("export ","")+";({tshirtClaimKey,activeTshirtClaim})",context);
 for(const file of ["tshirtPurchaseOrders","uniformReceiving","uniformFulfillment"])runInNewContext(read("api/src/functions/"+file+".js").replace(/^import .*;\n/gm,""),{...context,...flow});
 const current=(name,id)=>rows(name).get(key(school,id));
 const seed=(id,size="S",quantity=1,extra={})=>put("TenantUniformEventRequest",{partitionKey:school,rowKey:id,payload:JSON.stringify({kind:"regularUniform",studentId:"990101",parentEmail:id+"@example.test",size,quantity,status:"APPROVED",paymentStatus:"VERIFIED",createdAt:"2026-11-21T00:00:00Z",...extra})});
 const call=(name,input,method="POST")=>handlers[name]({method,query:new URLSearchParams(),json:async()=>input});
 const order=(action,id,extra={})=>call("tshirtPurchaseOrders",{action,id,etag:current("TenantTshirtPurchaseOrders",id)?.etag,...extra});
 const create=(ids=[],items=[{size:"S",quantity:10}],extra={})=>{const id=extra.requestKey||randomUUID();return call("tshirtPurchaseOrders",{action:"CREATE",requestKey:id,schoolYear:115,semester:1,items,links:ids.map(x=>typeof x==="string"?{type:"REQUEST",id:x,etag:current("TenantUniformEventRequest",x).etag}:x),...extra})};
 const receive=(id,extra={})=>order("RECEIVE",id,{receivedDate:"2026-11-22",note:"整單尺碼、件數與外觀核對無誤",...extra});
 const stock=(size,onHand,reserved=0)=>put("TenantUniformInventory",{partitionKey:school,rowKey:"regular:"+size,onHand,reserved,unavailable:0});
 const record=id=>JSON.parse(current("TenantUniformEventRequest",id).payload);
 return {current,put,seed,call,order,create,receive,stock,record,notices,flow,rows,getOrders:()=>call("tshirtPurchaseOrders",null,"GET"),inventory:()=>tshirtInventoryView([...rows("TenantUniformInventory").values()].filter(x=>x.partitionKey===school)),setSchool:value=>{school=value},setRole:value=>{role=value},hook:fn=>{hook=fn},failUpdate:(name,id)=>{failWrite={name,id}},loseBatch:()=>{loseBatch=true}};
}
test("one master order links paid parent demands, receives every size once, reserves pickup pieces and issues only the parent quantity",async()=>{
 const h=harness();h.seed("parent-one","S",1);h.seed("parent-two","M",2);const items=[{size:"S",quantity:2},{size:"M",quantity:3},{size:"XS",quantity:5}];
 const result=await h.create(["parent-one","parent-two"],items);assert.equal(result.status,201);const id=result.jsonBody.item.id;
 assert.equal(h.record("parent-one").status,"ORDERED");assert.equal(h.record("parent-one").purchaseOrderId,id);assert.equal(h.inventory().items.length,0);
 assert.equal((await h.receive(id)).status,200);assert.equal((await h.receive(id)).status,200);
 for(const [size,onHand,reserved] of [["S",2,1],["M",3,2],["XS",5,0]]){const stock=h.current("TenantUniformInventory","regular:"+size);assert.equal(stock.onHand,onHand);assert.equal(stock.reserved,reserved)}
 assert.equal(h.record("parent-one").status,"READY_FOR_PICKUP");assert.equal(h.notices.length,2);assert.equal(h.inventory().movements.filter(x=>x.action==="採購單整單到貨").length,1);
 const issue=()=>h.call("uniformFulfillment",{id:"parent-one",etag:h.current("TenantUniformEventRequest","parent-one").etag,receivedBy:"家長本人",note:"核對 S 號一件"});
 assert.equal((await issue()).status,200);assert.equal((await issue()).status,200);assert.equal(h.current("TenantUniformInventory","regular:S").onHand,1);assert.equal(h.current("TenantUniformInventory","regular:S").reserved,0);assert.equal(h.current("TenantUniformInventory","regular:XS").onHand,5);
 assert.equal((await h.order("SYNC",id)).status,200);assert.equal(h.record("parent-one").status,"FULFILLED");assert.equal(h.notices.length,2);assert.equal((await h.getOrders()).jsonBody.items[0].status,"RECEIVED");
});
test("stale, unpaid, foreign and already claimed requests cannot be silently inserted into another procurement",async()=>{
 const h=harness();h.seed("paid");h.seed("unpaid","S",1,{paymentStatus:"REPORTED_UNVERIFIED"});
 assert.equal((await h.create(["unpaid"])).status,409);assert.equal((await h.create([{type:"REQUEST",id:"paid",etag:"stale"}])).status,409);
 const first=await h.create(["paid"]);assert.equal(first.status,201);const count=(await h.getOrders()).jsonBody.items.length;
 assert.equal((await h.create(["paid"])).status,409);assert.equal((await h.getOrders()).jsonBody.items.length,count);
 h.setSchool("school-b");assert.equal((await h.create([{type:"REQUEST",id:"paid",etag:"anything"}])).status,409);assert.equal((await h.getOrders()).jsonBody.items.length,0);
});
test("cancelling the whole order restores parent demands and releases their claims without changing stock",async()=>{
 const h=harness();h.seed("parent");const first=(await h.create(["parent"])).jsonBody.item;
 assert.equal((await h.order("CANCEL",first.id,{reason:"廠商尚未製作，重新整併"})).status,200);assert.equal(h.record("parent").status,"APPROVED");assert.equal(h.record("parent").purchaseOrderId,undefined);assert.equal(await h.flow.activeTshirtClaim("school-a","REQUEST","parent"),null);assert.equal(h.inventory().items.length,0);
 assert.equal((await h.create(["parent"])).status,201);assert.equal((await h.receive(first.id)).status,409);
});
test("an update outage after whole-order receipt leaves a visible repair action and retries never add stock again",async()=>{
 const h=harness();h.seed("parent");const id=(await h.create(["parent"])).jsonBody.item.id;h.failUpdate("TenantUniformEventRequest","parent");
 const result=await h.receive(id);assert.equal(result.status,200);assert.equal(result.jsonBody.syncPending,true);assert.equal(h.record("parent").status,"ORDERED");assert.equal(h.current("TenantUniformInventory","regular:S").onHand,10);
 let order=(await h.getOrders()).jsonBody.items[0];assert.equal(order.status,"RECEIVED");assert.equal(order.syncPending,true);
 assert.equal((await h.order("SYNC",id)).jsonBody.syncPending,false);assert.equal(h.record("parent").status,"READY_FOR_PICKUP");assert.equal(h.current("TenantUniformInventory","regular:S").onHand,10);assert.equal(h.notices.length,1);
});
test("unknown network results and concurrent stock writes preserve atomic receipt ledgers",async()=>{
 const h=harness();h.seed("parent");const id=(await h.create(["parent"])).jsonBody.item.id;h.stock("S",1);h.hook(name=>{if(name==="TenantUniformInventory")h.stock("S",2)});
 assert.equal((await h.receive(id)).status,409);assert.equal(h.current("TenantUniformInventory","regular:S").onHand,2);assert.equal(h.current("TenantUniformInventory","received:parent"),undefined);assert.equal(h.current("TenantUniformInventory","po-received:"+id),undefined);
 h.loseBatch();assert.equal((await h.receive(id)).status,200);assert.equal(h.current("TenantUniformInventory","regular:S").onHand,12);assert.equal((await h.receive(id)).status,200);assert.equal(h.current("TenantUniformInventory","regular:S").onHand,12);
});
test("legacy individual arrivals must be explicitly matched and are credited without double stocking or regressing a delivered parent",async()=>{
 const h=harness(),parts=[{size:"S",quantity:1},{size:"M",quantity:1},{size:"XS",quantity:1}];h.seed("legacy","S",1,{status:"FULFILLED",procurementQuantity:3,procurementBreakdown:parts});
 h.put("TenantUniformInventory",{partitionKey:"school-a",rowKey:"received:legacy",requestId:"legacy",kind:"regularUniform",size:"S",quantity:1,procurementQuantity:3,breakdown:JSON.stringify(parts),source:"new_arrival",receivedAt:"2026-11-21T01:00:00Z"});
 h.put("TenantUniformInventory",{partitionKey:"school-a",rowKey:"issued:legacy",requestId:"legacy",kind:"regularUniform",size:"S",quantity:1,issuedAt:"2026-11-21T02:00:00Z"});h.stock("S",0);h.stock("M",1);h.stock("XS",1);h.seed("new","S",1);
 const id=(await h.create([], [{size:"S",quantity:2},{size:"M",quantity:3},{size:"XS",quantity:5}])).jsonBody.item.id;
 assert.equal((await h.order("LINK",id,{links:[{type:"REQUEST",id:"legacy",etag:h.current("TenantUniformEventRequest","legacy").etag}]})).status,409);
 const linked=await h.order("LINK",id,{links:[{type:"REQUEST",id:"legacy",etag:h.current("TenantUniformEventRequest","legacy").etag,includeReceived:true},{type:"REQUEST",id:"new",etag:h.current("TenantUniformEventRequest","new").etag}]});assert.equal(linked.status,200);
 const result=await h.receive(id);assert.equal(result.status,200);assert.equal(result.jsonBody.item.creditedQuantity,3);assert.equal(result.jsonBody.item.addedQuantity,7);
 assert.equal(h.current("TenantUniformInventory","regular:S").onHand,1);assert.equal(h.current("TenantUniformInventory","regular:M").onHand,3);assert.equal(h.current("TenantUniformInventory","regular:XS").onHand,5);assert.equal(h.record("legacy").status,"FULFILLED");assert.equal(h.record("new").status,"READY_FOR_PICKUP");assert.equal(h.notices.length,1);
 assert.equal((await h.receive(id)).status,200);assert.equal(h.current("TenantUniformInventory","regular:M").onHand,3);
});
test("a linked parent cannot use the old individual receipt route to duplicate a batch receipt",async()=>{
 const h=harness();h.seed("parent");await h.create(["parent"]);
 const result=await h.call("uniformReceiving",{id:"parent",etag:h.current("TenantUniformEventRequest","parent").etag,quantity:1,receivedDate:"2026-11-22",note:"另行入庫"});assert.equal(result.status,409);assert.match(result.jsonBody.error,/整單到貨/);assert.equal(h.inventory().items.length,0);
});
test("existing stock can directly open a paid unclaimed request and its reservation is released only on actual issue",async()=>{
 const h=harness();h.seed("parent");h.stock("S",3);
 const receive=()=>h.call("uniformReceiving",{id:"parent",etag:h.current("TenantUniformEventRequest","parent").etag,quantity:1,useExistingStock:true});assert.equal((await receive()).status,200);assert.equal((await receive()).status,200);assert.equal(h.record("parent").status,"READY_FOR_PICKUP");assert.equal(h.current("TenantUniformInventory","regular:S").onHand,3);assert.equal(h.current("TenantUniformInventory","regular:S").reserved,1);
 const result=await h.call("uniformFulfillment",{id:"parent",etag:h.current("TenantUniformEventRequest","parent").etag,receivedBy:"家長",note:"實際交付"});assert.equal(result.status,200);assert.equal(h.current("TenantUniformInventory","regular:S").onHand,2);assert.equal(h.current("TenantUniformInventory","regular:S").reserved,0);
});
test("staff sources join the same master order and nonadministrators cannot read or mutate procurement",async()=>{
 const h=harness();const staff=h.put("TenantTshirtStaffDemand",{partitionKey:"school-a",rowKey:"staff",payload:JSON.stringify({category:"CADRE_FIRST",parentName:"幹部",studentId:"990101",size:"S",quantity:1,status:"APPROVED",paymentStatus:"NOT_REQUIRED"})});
 const result=await h.create([{type:"STAFF",id:"staff",etag:staff.etag}]);assert.equal(result.status,201);const id=result.jsonBody.item.id;assert.equal((await h.receive(id)).status,200);assert.equal(JSON.parse(h.current("TenantTshirtStaffDemand","staff").payload).status,"ARRIVED");
 for(const role of ["teacher","parent"]){h.setRole(role);assert.equal((await h.getOrders()).status,403);assert.equal((await h.receive(id)).status,403)}
});
test("the procurement plan does not count a parent's allocated batch piece again as free incoming stock",()=>{
 const students=[{studentId:"990101",studentName:"學生甲",status:"active",groupName:"C"}],history=[{studentId:"990101",historicalIssued:false,size:"S"}],requests=[{id:"paid",kind:"regularUniform",studentId:"990101",size:"S",quantity:1,status:"APPROVED",paymentStatus:"VERIFIED",createdAt:"2026-11-21T00:00:00Z"}],stock=TSHIRT_PLAN_SIZES.map(size=>({key:"regular:"+size,onHand:0,reserved:0,unavailable:0}));
 const purchaseOrders=[{id:"po",schoolYear:115,semester:1,status:"ORDERED",items:[{size:"S",quantity:1}],links:[{type:"REQUEST",id:"paid",size:"S",quantity:1,parts:[{size:"S",quantity:1}]}]}];
 let plan=buildTshirtProcurementPlan({students,history,requests,stock,purchaseOrders,schoolYear:115,semester:1});assert.equal(plan.coveredUnits,1);assert.equal(plan.sizes.find(x=>x.size==="S").incoming,0);assert.equal(plan.needUnits,1);
 purchaseOrders[0].status="RECEIVED";stock.find(x=>x.key==="regular:S").onHand=1;stock.find(x=>x.key==="regular:S").reserved=1;
 plan=buildTshirtProcurementPlan({students,history,requests,stock,purchaseOrders,schoolYear:115,semester:1});assert.equal(plan.needUnits,1);
 const selected=tshirtOrderCandidates({students,requests,staffDemands:[],purchaseOrders:[]},{schoolYear:115,semester:1,items:[{size:"S",quantity:10}]});assert.equal(selected.length,1);assert.equal(selected[0].id,"paid");
});


test("saved order identity and legacy size boundaries reject incorrect merges without touching inventory",async()=>{
 const h=harness();const result=await h.create([], [{size:"S",quantity:10}]),id=result.jsonBody.item.id;
 assert.equal((await h.create([], [{size:"M",quantity:10}],{requestKey:id})).status,409);
 h.seed("legacy","M",1,{status:"READY_FOR_PICKUP"});h.put("TenantUniformInventory",{partitionKey:"school-a",rowKey:"received:legacy",requestId:"legacy",kind:"regularUniform",size:"M",quantity:1,procurementQuantity:1,breakdown:JSON.stringify([{size:"M",quantity:1}]),source:"new_arrival"});h.stock("M",1);
 const linked=await h.order("LINK",id,{links:[{type:"REQUEST",id:"legacy",etag:h.current("TenantUniformEventRequest","legacy").etag,includeReceived:true}]});assert.equal(linked.status,409);assert.equal(h.current("TenantUniformInventory","regular:M").onHand,1);assert.equal((await h.getOrders()).jsonBody.items[0].links.length,0);
});
