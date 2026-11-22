import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {randomUUID,createHash} from "node:crypto";
import * as resolutionRules from "../api/src/lib/paymentResolutionRules.mjs";
import {validatePurchaseOrderInput,tshirtPurchaseOrderSizes} from "../api/src/lib/tshirtPurchaseOrderRules.mjs";
import {normalizeReceivingDetails} from "../api/src/lib/uniformReceivingRules.mjs";
import {familyPaymentInfo} from "../api/src/lib/paymentNoticeRules.mjs";
import {financeRecipients} from "../api/src/lib/financeNoticeRules.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8"),strip=source=>source.replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
function harness(){
 const records=new Map(),handlers={},notices=[];let version=0,school="school-a",role="admin",finance=true,loseBatch=false,failSource=false,hook;
 const error=code=>Object.assign(Error(String(code)),{statusCode:code}),key=(p,r)=>p+"|"+r;
 const rows=name=>{if(!records.has(name))records.set(name,new Map());return records.get(name)};
 const put=(name,row)=>{const saved={...structuredClone(row),etag:"v"+(++version)};rows(name).set(key(row.partitionKey,row.rowKey),saved);return saved};
 const db=name=>({createTable:async()=>{},getEntity:async(p,r)=>{const row=rows(name).get(key(p,r));if(!row)throw error(404);return structuredClone(row)},
  createEntity:async row=>{if(rows(name).has(key(row.partitionKey,row.rowKey)))throw error(409);put(name,row)},
  updateEntity:async(row,mode,options)=>{if(name==="TenantUniformEventRequest"&&failSource){failSource=false;throw error(503)}const old=rows(name).get(key(row.partitionKey,row.rowKey));if(!old)throw error(404);if(old.etag!==options?.etag)throw error(412);put(name,mode==="Merge"?{...old,...row}:row)},
  listEntities:async function*({queryOptions:{filter}}){const p=filter.match(/PartitionKey eq '([^']+)'/)[1];for(const row of rows(name).values())if(row.partitionKey===p)yield structuredClone(row)},
  submitTransaction:async actions=>{if(hook){const fn=hook;hook=null;fn(name)}const next=new Map(rows(name));assert.equal(new Set(actions.map(([,row])=>row.partitionKey)).size,1);for(const [action,row,,options] of actions){const k=key(row.partitionKey,row.rowKey),old=next.get(k);if(action==="create"?Boolean(old):!old||old.etag!==options.etag)throw error(action==="create"?409:412);next.set(k,{...structuredClone(row),etag:"v"+(++version)})}records.set(name,next);if(name==="TenantUniformInventory"&&loseBatch){loseBatch=false;throw error(503)}}});
 const access=()=>({role,email:role==="parent"?"parent@example.test":"finance@example.test",capabilities:{financeVerifier:finance},students:["990101"]});
 const scope={...resolutionRules,TableClient:{fromConnectionString:(_,name)=>db(name)},randomUUID,createHash,Buffer,URL,process:{env:{STORAGE_CONNECTION_STRING:"test"}},console:{error(){},warn(){}},app:{http:(name,config)=>{handlers[name]=config.handler}},json:(jsonBody,status=200)=>({status,jsonBody}),
  getTenantContext:async()=>({schoolId:school,access:access(),tenant:{schoolName:"測試學校"}}),ensureStudentAccess:(a,id)=>a.role==="admin"||a.students?.includes(id),getStudentAliasInfo:async id=>({canonicalStudentId:id}),getStudentMaster:async id=>({studentName:"學生"+id}),listUserStudentMappings:async()=>[],
  sendUniformRequestStatusEmail:async input=>{notices.push(input);return {status:"sent"}},notifyTenantPaymentVerified:async()=>({status:"accepted"}),notifyFinanceTransfer:async()=>({status:"accepted"}),retryFinanceTransfer:async()=>({status:"accepted"}),safePaymentNotifications:async()=>({}),lineFirstLabEnabled:()=>true,
  paymentResolutionEnabled:()=>true,familyPaymentInfo,financeRecipients,listTenantAdmins:async()=>[],financeAssignments:async()=>[],getMappedStudentsByEmail:async()=>[],labNoticeUrl:s=>"https://lab.example.test/?schoolId="+s,labNoticeLineResult:r=>({status:r.status}),deliverLabNotice:async()=>({status:"sent"}),validatePurchaseOrderInput,tshirtPurchaseOrderSizes,normalizeReceivingDetails};
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/tshirtPurchaseOrderFlow.js"))+";({tshirtClaimKey,activeTshirtClaim})",{...scope}));
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/tshirtAvailableStock.js"))+";({allocateTshirtAvailableStock,safeAllocateTshirtAvailableStock})",{...scope}));
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/paymentResolution.js"))+";({applyPaymentResolution})",{...scope}));
 for(const name of ["tshirtAvailableStock","uniformTransferReport","uniformFulfillment","tshirtPurchaseOrders"])runInNewContext(strip(read("api/src/functions/"+name+".js")),{...scope});
 const current=(name,id)=>rows(name).get(key(school,id)),record=id=>JSON.parse(current("TenantUniformEventRequest",id).payload);
 const seed=(id=randomUUID(),extra={})=>{put("TenantUniformEventRequest",{partitionKey:school,rowKey:id,payload:JSON.stringify({kind:"regularUniform",studentId:"990101",parentEmail:"parent@example.test",size:"S",quantity:1,status:"APPROVED",paymentStatus:"VERIFIED",amount:400,createdAt:"2026-11-22T01:00:00Z",...extra})});return id};
 const stock=(size="S",onHand=1,reserved=0,unavailable=0)=>put("TenantUniformInventory",{partitionKey:school,rowKey:"regular:"+size,onHand,reserved,unavailable});
 const allocate=id=>scope.allocateTshirtAvailableStock(school,id,{actor:"finance@example.test"});
 const call=(name,input,method="POST")=>handlers[name]({method,json:async()=>input,query:new URLSearchParams()});
 const verify=id=>call("uniformTransferReport",{requestId:id,etag:current("TenantUniformEventRequest",id).etag,amount:400,bankPostedAt:"2026-11-22",note:"銀行入帳核對完成"},"PATCH");
 return {...scope,put,current,seed,stock,record,allocate,call,verify,notices,records,setSchool:value=>{school=value},setRole:value=>{role=value},setFinance:value=>{finance=value},loseBatch:()=>{loseBatch=true},failSource:()=>{failSource=true},hook:fn=>{hook=fn},access};
}
test("paid add-ons reserve matching new stock, open actual issue, and deduct once only on handoff",async()=>{
 const h=harness(),id=h.seed();h.stock("S",3);h.put("TenantUniformInventory",{partitionKey:"school-a",rowKey:"regular-opened:S",onHand:10});
 assert.equal((await h.allocate(id)).status,"ready");assert.equal(h.record(id).status,"READY_FOR_PICKUP");assert.equal(h.record(id).stockSource,"existing_stock");assert.equal(h.record(id).procurementQuantity,undefined);
 assert.equal(h.current("TenantUniformInventory","regular:S").onHand,3);assert.equal(h.current("TenantUniformInventory","regular:S").reserved,1);assert.equal(h.notices.length,1);
 assert.equal((await h.allocate(id)).status,"ready");assert.equal(h.current("TenantUniformInventory","regular:S").reserved,1);assert.equal(h.notices.length,1);
 const issue=()=>h.call("uniformFulfillment",{id,etag:h.current("TenantUniformEventRequest",id).etag,receivedBy:"家長本人",note:"已核對尺寸"});
 assert.equal((await issue()).status,200);assert.equal((await issue()).status,200);assert.equal(h.record(id).status,"FULFILLED");assert.equal(h.current("TenantUniformInventory","regular:S").onHand,2);assert.equal(h.current("TenantUniformInventory","regular:S").reserved,0);assert.equal(h.current("TenantUniformInventory","regular-opened:S").onHand,10);
});
test("no stock, unavailable pieces, other reservations, partial stock and missing counts keep the procurement path",async()=>{
 for(const data of [null,[0,0,0],[2,1,1],[1,0,0]]){
  const h=harness(),id=h.seed(undefined,{quantity:2});if(data)h.stock("S",...data);
  assert.ok(["procurement_required","stock_requires_review"].includes((await h.allocate(id)).status));assert.equal(h.record(id).status,"APPROVED");assert.equal(h.current("TenantUniformInventory","received:"+id),undefined);assert.equal(await h.activeTshirtClaim("school-a","REQUEST",id),null);assert.equal(h.notices.length,0);
  const result=await h.call("tshirtPurchaseOrders",{action:"CREATE",requestKey:randomUUID(),schoolYear:115,semester:1,items:[{size:"S",quantity:10}],links:[{type:"REQUEST",id,etag:h.current("TenantUniformEventRequest",id).etag}]});assert.equal(result.status,201);assert.equal(h.record(id).status,"ORDERED");
 }
});
test("unapproved, unpaid, held, refunded and completed requests cannot consume stock",async()=>{
 for(const extra of [{status:"PENDING"},{paymentStatus:"AWAITING_TRANSFER"},{paymentStatus:"REPORTED_UNVERIFIED"},{paymentStatus:"ADJUSTMENT_REQUIRED"},{paymentStatus:"SUPPLEMENT_REPORTED"},{paymentStatus:"REFUND_REQUESTED"},{paymentStatus:"REFUNDED"},{status:"CANCELLED"},{status:"FULFILLED"},{kind:"competitionUniform"}]){
  const h=harness(),id=h.seed(undefined,extra);h.stock("S",2);assert.equal((await h.allocate(id)).status,"ineligible");assert.equal(h.current("TenantUniformInventory","regular:S").reserved,0);assert.equal(h.notices.length,0);
 }
});
test("two concurrent calls and two applicants competing for one piece cannot reserve it twice",async()=>{
 const h=harness(),a=h.seed(),b=h.seed();h.stock("S",1);
 await Promise.all([h.allocate(a),h.allocate(a),h.allocate(b)]);await h.allocate(a);await h.allocate(b);
 assert.equal(h.current("TenantUniformInventory","regular:S").reserved,1);assert.equal([h.record(a),h.record(b)].filter(row=>row.status==="READY_FOR_PICKUP").length,1);assert.equal(h.notices.length,1);
});
test("a lost inventory response and a failed request update are repairable without another reservation",async()=>{
 for(const failure of ["loseBatch","failSource"]){const h=harness(),id=h.seed();h.stock("S",2);h[failure]();const result=await h.allocate(id);assert.equal(result.status,failure==="loseBatch"?"ready":"sync_pending");assert.equal((await h.allocate(id)).status,"ready");assert.equal(h.current("TenantUniformInventory","regular:S").reserved,1);assert.equal(h.current("TenantUniformInventory","regular:S").onHand,2);assert.equal(h.notices.length,1)}
});
test("inventory ETag conflicts leave no partial receipt or reservation",async()=>{
 const h=harness(),id=h.seed();h.stock("S",2);h.hook(name=>{if(name==="TenantUniformInventory")h.stock("S",1,1)});
 assert.equal((await h.allocate(id)).status,"pending");assert.equal(h.current("TenantUniformInventory","received:"+id),undefined);assert.equal(h.current("TenantUniformInventory","regular:S").reserved,1);assert.equal(h.record(id).status,"APPROVED");
});
test("procurement claims win against automatic stock allocation, and allocated stock cannot be ordered again",async()=>{
 const h=harness(),id=h.seed();h.stock("S",3);
 const create=()=>h.call("tshirtPurchaseOrders",{action:"CREATE",requestKey:randomUUID(),schoolYear:115,semester:1,items:[{size:"S",quantity:10}],links:[{type:"REQUEST",id,etag:h.current("TenantUniformEventRequest",id).etag}]});
 assert.equal((await h.allocate(id)).status,"ready");assert.equal((await create()).status,409);assert.equal(h.current("TenantUniformInventory","regular:S").onHand,3);
 const other=h.seed();const order=await h.call("tshirtPurchaseOrders",{action:"CREATE",requestKey:randomUUID(),schoolYear:115,semester:1,items:[{size:"S",quantity:10}],links:[{type:"REQUEST",id:other,etag:h.current("TenantUniformEventRequest",other).etag}]});assert.equal(order.status,201);assert.equal((await h.allocate(other)).status,"ineligible");assert.equal(h.record(other).status,"ORDERED");assert.equal(h.current("TenantUniformInventory","regular:S").reserved,1);
});
test("stock allocation uses the authenticated school and the endpoint rejects other roles and invalid batches",async()=>{
 const h=harness(),id=h.seed();h.stock("S",2);h.setSchool("school-b");h.seed(id);assert.equal((await h.allocate(id)).status,"stock_requires_review");assert.equal(h.current("TenantUniformInventory","received:"+id),undefined);h.setSchool("school-a");assert.equal(h.current("TenantUniformInventory","regular:S").reserved,0);
 for(const role of ["parent","teacher"]){h.setRole(role);assert.equal((await h.call("tshirtAvailableStock",{ids:[id]})).status,403)}h.setRole("admin");for(const ids of [[],[id,id],Array.from({length:21},()=>randomUUID()),["../bad"]])assert.equal((await h.call("tshirtAvailableStock",{ids})).status,400);
 assert.equal((await h.call("tshirtAvailableStock",{ids:[id]})).jsonBody.results[0].status,"ready");
});
test("the real finance verification chooses stock or procurement only after committing full payment",async()=>{
 for(const count of [0,2]){const h=harness(),id=h.seed(undefined,{paymentStatus:"REPORTED_UNVERIFIED"});h.stock("S",count);h.setFinance(false);assert.equal((await h.verify(id)).status,403);h.setFinance(true);const result=await h.verify(id);assert.equal(result.status,200);assert.equal(h.record(id).paymentStatus,"VERIFIED");assert.equal(h.record(id).status,count?"READY_FOR_PICKUP":"APPROVED");assert.equal((await h.verify(id)).status,409);assert.equal(h.current("TenantUniformInventory","regular:S").reserved,count?1:0)}
});
test("second finance verification after a supplement uses the same stock path without bypassing the hold",async()=>{
 const h=harness(),id=h.seed(undefined,{paymentStatus:"REPORTED_UNVERIFIED"});h.stock("S",1);
 const apply=async(action,fields)=>{const row=h.current("TenantUniformEventRequest",id),item=h.record(id);return h.applyPaymentResolution("school-a",h.access(),{sourceType:"uniform",id,action,etag:row.etag,revision:item.paymentResolution?.revision,requestId:randomUUID(),...fields})};
 await apply("REQUEST_ADJUSTMENT",{receivedAmount:300,bankPostedAt:"2026-11-22",reason:"少付100"});assert.equal((await h.allocate(id)).status,"ineligible");
 h.setRole("parent");await apply("REPORT_SUPPLEMENT",{amount:100,transferDate:"2026-11-22",lastFive:"55555"});assert.equal((await h.allocate(id)).status,"ineligible");h.setRole("admin");
 const result=await apply("VERIFY_ADJUSTMENT",{receivedAmount:400,bankPostedAt:"2026-11-22",note:"兩筆合計400已核對"});assert.equal(result.item.status,"READY_FOR_PICKUP");assert.equal(h.record(id).paymentResolution.balance,0);assert.equal(h.current("TenantUniformInventory","regular:S").reserved,1);
});
test("the real request controls offer actual issue for allocated stock and procurement for shortages",()=>{
 const source=read("app/uniform-event-admin.js"),start=source.indexOf("function table("),end=source.indexOf("function uniformPaymentLineSummary",start),host={innerHTML:""};
 const table=runInNewContext(source.slice(start,end)+";table",{el:()=>host,esc:value=>String(value??""),cachedStock:[],window:{},requestUpdateFeedback:new Map(),issueErrors:new Map(),uniformPaymentLineSummary:()=>""});
 table("requests",[{id:"ready",kind:"團 T",status:"READY_FOR_PICKUP",paymentStatus:"VERIFIED",received:true,size:"S",quantity:1}],[],true);assert.match(host.innerHTML,/確認實際發放/);assert.doesNotMatch(host.innerHTML,/data-master-order|data-ready-stock/);
 table("requests",[{id:"short",kind:"團 T",status:"APPROVED",paymentStatus:"VERIFIED",size:"S",quantity:1}],[],true);assert.match(host.innerHTML,/前往採購總表/);assert.doesNotMatch(host.innerHTML,/確認實際發放/);
});
test("refresh reconciles an older verified request with stock and updates requests, receipts and inventory together",async()=>{
 const source=read("app/uniform-event-admin.js"),start=source.indexOf(" // Reconcile older paid requests"),end=source.indexOf(" if(hasFinanceAccess){",start),calls=[],events=[];
 const newer={id:"new-xs",kind:"regularUniform",size:"XS",quantity:1,status:"APPROVED",paymentStatus:"VERIFIED",createdAt:"2026-11-22"},requests=[newer,{...newer,id:"old-s",size:"S",status:"FULFILLED"},{...newer,id:"unpaid",paymentStatus:"REPORTED_UNVERIFIED"},{...newer,id:"in-po",purchaseOrderId:"po"},{...newer,id:"no-stock",size:"L"}];
 const stocks=[{key:"regular:XS",onHand:1,reserved:0,unavailable:0},{key:"regular:L",onHand:0,reserved:0,unavailable:0}];let renders=0;
 const scope={results:Array.from({length:5},()=>({status:"fulfilled"})),cachedRequests:requests,cachedStock:stocks,receivedRequestIds:new Set(),cachedStockDetails:null,issueErrors:new Map(),activeAdminTab:"regularUniform",window:{dispatchEvent:e=>events.push(e.type)},CustomEvent:class{constructor(type){this.type=type}},el:()=>({}),renderUniformRequestAlerts(){},renderModuleRequests(){renders++},renderModuleStock(){},
  api:async(path,options)=>{calls.push({path,options});if(options){assert.deepEqual(JSON.parse(options.body).ids,["new-xs"]);return {results:[{id:"new-xs",status:"ready"}]}}if(path.endsWith("requests"))return {items:requests.map(row=>row.id==="new-xs"?{...row,status:"READY_FOR_PICKUP",stockSource:"existing_stock",stockReceivedAt:"2026-11-22T04:00:00Z"}:row)};if(path.endsWith("receiving"))return {items:[{requestId:"new-xs"}]};return {items:stocks.map(row=>({...row,reserved:row.key==="regular:XS"?1:0}))}}
 };
 await runInNewContext("(async()=>{"+source.slice(start,end)+"})()",scope);
 assert.equal(scope.cachedRequests[0].status,"READY_FOR_PICKUP");assert.equal(scope.cachedRequests[1].status,"FULFILLED");assert.equal(scope.cachedStock[0].reserved,1);assert.equal(scope.receivedRequestIds.has("new-xs"),true);assert.equal(renders,1);assert.deepEqual(events,["uniformRequestsLoaded","uniformInventoryLoaded"]);assert.equal(calls.length,4);
});
test("failed inventory reads never trigger automatic allocation from stale cached quantities",async()=>{
 const source=read("app/uniform-event-admin.js"),start=source.indexOf(" // Reconcile older paid requests"),end=source.indexOf(" if(hasFinanceAccess){",start);let calls=0;
 await runInNewContext("(async()=>{"+source.slice(start,end)+"})()",{results:Array.from({length:5},(_,i)=>({status:i===4?"rejected":"fulfilled"})),api:async()=>{calls++}});assert.equal(calls,0);
});
