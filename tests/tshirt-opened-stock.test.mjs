import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {randomUUID} from "node:crypto";
import {openedStockKey,tshirtInventoryView} from "../api/src/lib/tshirtInventoryView.mjs";
import {normalizeReceivingDetails,statusAfterReceiving} from "../api/src/lib/uniformReceivingRules.mjs";
import {buildTshirtProcurementPlan,TSHIRT_PLAN_SIZES} from "../app/tshirt-procurement-plan.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8"),parent="parent@example.test",student="990101";
function harness(){
 const handlers={},tables=new Map();let school="school-a",role="admin",version=0,auditFailures=0,transactionHook=null;
 const error=statusCode=>Object.assign(Error(String(statusCode)),{statusCode});
 const rows=name=>{if(!tables.has(name))tables.set(name,new Map());return tables.get(name)};
 const pk=(p,r)=>p+"|"+r;
 const put=(name,row)=>rows(name).set(pk(row.partitionKey,row.rowKey),{...row,etag:"v"+(++version)});
 const db=name=>({createTable:async()=>{},getEntity:async(p,r)=>{const row=rows(name).get(pk(p,r));if(!row)throw error(404);return {...row}},
  createEntity:async row=>{if(name==="TenantUniformEventAudit"&&auditFailures){auditFailures--;throw error(503)}if(rows(name).has(pk(row.partitionKey,row.rowKey)))throw error(409);put(name,row)},
  updateEntity:async(row,mode,options)=>{const old=rows(name).get(pk(row.partitionKey,row.rowKey));if(!old)throw error(404);if(options?.etag&&options.etag!==old.etag)throw error(412);put(name,{...(mode==="Merge"?old:{}),...row})},
  listEntities:async function*({queryOptions:{filter}}){const selected=filter.match(/PartitionKey eq '([^']+)'/)[1];for(const row of rows(name).values())if(row.partitionKey===selected)yield {...row}},
  submitTransaction:async actions=>{
   if(transactionHook){const hook=transactionHook;transactionHook=null;hook(name)}
   const staged=new Map(rows(name));assert.equal(new Set(actions.map(([,row])=>row.partitionKey)).size,1);
   for(const [action,row,,options] of actions){const id=pk(row.partitionKey,row.rowKey),old=staged.get(id);if(action==="create"?!!old:!old||old.etag!==options?.etag)throw error(412);staged.set(id,{...row,etag:"v"+(++version)})}
   tables.set(name,staged);
  }});
 const context={app:{http:(name,config)=>{handlers[name]=config.handler}},TableClient:{fromConnectionString:(_,name)=>db(name)},randomUUID,Buffer,openedStockKey,tshirtInventoryView,normalizeReceivingDetails,statusAfterReceiving,
  getTenantContext:async()=>({schoolId:school,access:{role,email:"admin@example.test"},tenant:{schoolName:"測試學校"}}),json:(jsonBody,status=200)=>({jsonBody,status}),process:{env:{STORAGE_CONNECTION_STRING:"test"}},console:{warn(){},error(){}},
  ensureTenantTables:async()=>{},tenantTable:()=>db("links"),tenantParentPartition:(s,e)=>s+":"+e,getStudentMaster:async()=>({studentName:"學生甲",status:"active"}),getStudentAliasInfo:async id=>({canonicalStudentId:id}),listUserStudentMappings:async()=>[],sendUniformRequestStatusEmail:async()=>({status:"sent"}),cadreActions:new Set(),staffProcurement:()=>{throw Error("unexpected staff procurement")}};
 for(const file of ["uniformInventory","uniformReceiving","uniformFulfillment","tshirtParentLoans"])runInNewContext(read("api/src/functions/"+file+".js").replace(/^import .*;\n/gm,""),{...context});
 const call=(name,body,method="POST")=>handlers[name]({method,query:new URLSearchParams(),json:async()=>body});
 const stock=(size,count,opened=false)=>put("TenantUniformInventory",{partitionKey:school,rowKey:(opened?"regular-opened:":"regular:")+size,onHand:count,reserved:0,unavailable:0});
 const current=(name,key)=>rows(name).get(pk(school,key));
 const link=()=>put("links",{partitionKey:school+":"+parent,rowKey:student,status:"active"});link();
 const receive=()=>call("uniformReceiving",{id:"order-one",etag:current("TenantUniformEventRequest","order-one").etag,quantity:1,procurementQuantity:3,receivedDate:"2026-11-22",note:"S、M、XS 各 1 件，驗收無誤"});
 const opened=(action,size,quantity,requestId=randomUUID())=>call("uniformInventory",{action,size,quantity,requestId,openedEtag:current("TenantUniformInventory",openedStockKey(size))?.etag??null,stockEtag:current("TenantUniformInventory","regular:"+size)?.etag??null,note:"志工備用"});
 const loan=(action,extra={})=>call("tshirtParentLoans",{parentEmail:parent,parentName:"家長甲",studentId:student,size:"M",action,etag:current("TenantTshirtParentLoans",parent)?.etag||"",...extra});
 const seedOrder=()=>put("TenantUniformEventRequest",{partitionKey:school,rowKey:"order-one",payload:JSON.stringify({kind:"regularUniform",studentId:student,size:"S",quantity:1,procurementQuantity:3,procurementBreakdown:[{size:"S",quantity:1},{size:"M",quantity:1},{size:"XS",quantity:1}],status:"ORDERED",paymentStatus:"VERIFIED"})});
 return {call,rows,current,put,stock,receive,opened,loan,seedOrder,link,view:()=>call("uniformInventory",null,"GET"),auditFailure:()=>{auditFailures=1},setRole:value=>{role=value},setSchool:value=>{school=value},transactionHook:fn=>{transactionHook=fn}};
}
test("arrival, opened transfer, volunteer borrow/return and student issue share one inventory and keep all spare sizes",async()=>{
 const h=harness();for(const size of ["S","M","XS"])h.stock(size,0);h.seedOrder();
 assert.equal((await h.receive()).status,200);assert.equal((await h.receive()).status,200);
 let view=(await h.view()).jsonBody;for(const size of ["S","M","XS"])assert.equal(view.items.find(x=>x.key==="regular:"+size).onHand,1);
 assert.equal(view.movements.filter(x=>x.action==="到貨入庫").length,1);assert.equal(view.movements[0].quantity,3);assert.match(view.movements[0].sizes,/S × 1.*M × 1.*XS × 1/);
 assert.equal((await h.opened("OPEN_FROM_NEW","M",1)).status,200);assert.equal((await h.loan("BORROW_VOLUNTEER")).status,200);
 view=(await h.view()).jsonBody;assert.equal(view.openedItems[0].onHand,0);assert.equal(view.openedItems[0].borrowed,1);assert.equal(view.openedItems.length,1);
 assert.equal((await h.loan("RETURN")).status,200);view=(await h.view()).jsonBody;assert.equal(view.openedItems[0].onHand,1);assert.equal(view.openedItems[0].borrowed,0);assert.equal(view.items.find(x=>x.key==="regular:M").onHand,0);
 const order=h.current("TenantUniformEventRequest","order-one");assert.equal((await h.call("uniformFulfillment",{id:"order-one",etag:order.etag,receivedBy:"家長",note:"已核對 S 號一件"})).status,200);
 view=(await h.view()).jsonBody;assert.equal(view.items.find(x=>x.key==="regular:S").onHand,0);assert.equal(view.items.find(x=>x.key==="regular:XS").onHand,1);assert.equal(view.openedItems[0].onHand,1);
 for(const label of ["到貨入庫","實際發放","新團 T 拆封移入","志工借出（已拆封）","志工洗淨歸還（已拆封）"])assert.ok(view.movements.some(x=>x.action===label),label);
});
test("opened stock is never borrowed from the new-shirt pool implicitly and does not reduce new purchase demand",async()=>{
 const h=harness();h.stock("M",4);assert.equal((await h.loan("BORROW_VOLUNTEER")).status,409);assert.equal(h.current("TenantUniformInventory","regular:M").onHand,4);
 assert.equal((await h.opened("SET_OPENED_COUNT","M",5)).status,200);assert.equal(h.current("TenantUniformInventory","regular:M").onHand,4);
 h.stock("M",0);const view=(await h.view()).jsonBody;assert.ok(!view.items.some(x=>x.key.startsWith("regular-opened:")));
 const plan=buildTshirtProcurementPlan({schoolYear:115,semester:1,students:[{studentId:student,status:"active",groupName:"A"}],history:[{studentId:student,historicalIssued:true}],requests:[{id:"one",studentId:student,kind:"regularUniform",size:"M",quantity:1,status:"APPROVED",paymentStatus:"VERIFIED",createdAt:"2026-11-21T00:00:00Z"}],stock:TSHIRT_PLAN_SIZES.map(size=>view.items.find(x=>x.key==="regular:"+size)||{key:"regular:"+size,onHand:0,reserved:0,unavailable:0})});assert.equal(plan.needUnits,1);
});
test("retrying a committed opened transfer cannot deduct new shirts twice",async()=>{
 const h=harness();h.stock("M",4);const id=randomUUID();assert.equal((await h.opened("OPEN_FROM_NEW","M",2,id)).status,200);const repeated=await h.opened("OPEN_FROM_NEW","M",2,id);assert.equal(repeated.status,200);assert.equal(repeated.jsonBody.alreadyApplied,true);
 assert.equal(h.current("TenantUniformInventory","regular:M").onHand,2);assert.equal(h.current("TenantUniformInventory","regular-opened:M").onHand,2);assert.equal((await h.opened("OPEN_FROM_NEW","M",1,id)).status,409);
});
test("stale or insufficient opened transfers do not partially change either pool or create history",async()=>{
 const h=harness();h.stock("M",1);assert.equal((await h.opened("OPEN_FROM_NEW","M",2)).status,409);assert.equal(h.current("TenantUniformInventory","regular-opened:M"),undefined);
 h.transactionHook(()=>h.stock("M",3));assert.equal((await h.opened("OPEN_FROM_NEW","M",1)).status,409);assert.equal(h.current("TenantUniformInventory","regular:M").onHand,3);assert.equal(h.current("TenantUniformInventory","regular-opened:M"),undefined);
 assert.equal((await h.view()).jsonBody.movements.length,0);
});
test("an audit outage after volunteer stock commits can be retried without duplicating borrowing or returns",async()=>{
 const h=harness();await h.opened("SET_OPENED_COUNT","M",2);h.auditFailure();assert.equal((await h.loan("BORROW_VOLUNTEER")).status,500);assert.equal((await h.loan("BORROW_VOLUNTEER")).status,200);assert.equal(h.current("TenantUniformInventory","regular-opened:M").onHand,1);
 h.auditFailure();assert.equal((await h.loan("RETURN")).status,500);assert.equal((await h.loan("RETURN")).status,200);assert.equal(h.current("TenantUniformInventory","regular-opened:M").onHand,2);
 const moves=(await h.view()).jsonBody.movements;assert.equal(moves.filter(x=>x.action==="志工借出（已拆封）").length,1);assert.equal(moves.filter(x=>x.action==="志工洗淨歸還（已拆封）").length,1);
});
test("legacy loans remain visible and clean returns enter opened stock without increasing new-shirt counts",async()=>{
 const h=harness();h.stock("M",3);h.put("TenantTshirtParentLoans",{partitionKey:"school-a",rowKey:parent,parentName:"舊家長",studentId:student,role:"VOLUNTEER",size:"M",status:"WASHING"});
 let view=(await h.view()).jsonBody;assert.equal(view.openedItems[0].borrowed,1);assert.equal(view.openedItems[0].onHand,0);
 assert.equal((await h.loan("RETURN")).status,200);view=(await h.view()).jsonBody;assert.equal(view.openedItems[0].onHand,1);assert.equal(view.openedItems[0].borrowed,0);assert.equal(view.items[0].onHand,3);
});
test("size corrections move the tracked pool while old deductions retain their original accounting",async()=>{
 const h=harness();await h.opened("SET_OPENED_COUNT","M",2);await h.opened("SET_OPENED_COUNT","L",2);await h.loan("BORROW_VOLUNTEER");assert.equal((await h.loan("CORRECT_VOLUNTEER_SIZE",{size:"L",reason:"實物為 L 號"})).status,200);
 assert.equal(h.current("TenantUniformInventory","regular-opened:M").onHand,2);assert.equal(h.current("TenantUniformInventory","regular-opened:L").onHand,1);assert.equal((await h.loan("RETURN")).status,200);assert.equal(h.current("TenantUniformInventory","regular-opened:L").onHand,2);
 const legacy=harness();legacy.stock("M",2);legacy.stock("L",2);legacy.put("TenantTshirtParentLoans",{partitionKey:"school-a",rowKey:parent,parentName:"舊家長",studentId:student,role:"VOLUNTEER",size:"M",status:"BORROWED"});legacy.put("TenantUniformInventory",{partitionKey:"school-a",rowKey:"tshirt-loan:"+Buffer.from(parent).toString("base64url"),parentEmail:parent,size:"M",status:"BORROWED"});
 assert.equal((await legacy.loan("CORRECT_VOLUNTEER_SIZE",{size:"L",reason:"更正舊借用尺寸"})).status,200);assert.equal(legacy.current("TenantUniformInventory","regular:M").onHand,3);assert.equal(legacy.current("TenantUniformInventory","regular:L").onHand,1);
 assert.equal((await legacy.loan("RETURN")).status,200);assert.equal(legacy.current("TenantUniformInventory","regular:L").onHand,1);assert.equal(legacy.current("TenantUniformInventory","regular-opened:L").onHand,1);
});

class Element{
 constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.value="";this.textContent="";this.disabled=false;this.attributes={};this.style={}}
 append(...children){this.children.push(...children)}replaceChildren(...children){this.children=children}setAttribute(key,value){this.attributes[key]=value}addEventListener(name,fn){this.handlers[name]=fn}contains(child){return this===child||this.children.some(x=>x.contains(child))}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]),content=node=>node.textContent+node.children.map(content).join("");
test("arrival summary counts only the family's pickup quantity while the procurement record retains all three received shirts",()=>{
 const source=read("app/uniform-event-admin.js"),start=source.indexOf("function renderModuleRequests("),end=source.indexOf("function renderModuleStock(",start),nodes=new Map();let displayed;
 const el=id=>{if(!nodes.has(id))nodes.set(id,new Element("div"));return nodes.get(id)};
 const scope={cachedRequests:[{id:"one",kind:"regularUniform",studentId:student,size:"S",quantity:1,procurementQuantity:3,procurementBreakdown:[{size:"S",quantity:1},{size:"M",quantity:1},{size:"XS",quantity:1}],status:"READY_FOR_PICKUP",paymentStatus:"VERIFIED"}],activeAdminTab:"regularUniform",activeReceivingForm:null,showRequestHistory:false,receivedRequestIds:new Set(["one"]),pendingRequestIds:new Set(),uniformStudentNames:new Map([[student,"學生甲"]]),approvedStage:()=>"ready",el,document:{createElement:tag=>new Element(tag)},window:{},esc:String,table:(id,rows)=>{displayed=rows}};
 runInNewContext(source.slice(start,end)+";renderModuleRequests();",scope);assert.match(content(el("requestSummary")),/已到貨待發放1 筆／1 件/);assert.match(displayed[0].procurementLabel,/3 件.*S 1、M 1、XS 1/);
});
function ui(data){
 const host=new Element("div"),calls=[];let reloads=0,loans=0,release=null,reject=false;
 const create=runInNewContext(read("app/tshirt-stock-details.js").replace("export function","function")+";createTshirtStockDetails",{document:{createElement:tag=>new Element(tag)},crypto:{randomUUID},Date});
 const widget=create({host,api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});if(release)await release;if(reject)throw Error("庫存已變動");return {updated:true}},onReload:async()=>{reloads++},onLoans:()=>{loans++}});widget.render(data);
 const form=descendants(host).find(x=>x.tag==="form"),field=name=>descendants(form).find(x=>x.name===name);
 return {widget,host,form,field,calls,reloads:()=>reloads,loans:()=>loans,hold:promise=>{release=promise},reject:()=>{reject=true},edit:(name,value)=>{field(name).value=value;form.handlers.input()},submit:()=>form.handlers.submit({preventDefault(){}})};
}
test("opened inventory lists only recorded sizes and arrival history is visible in the same stock panel",()=>{
 const h=ui({items:[{key:"regular:S",onHand:3}],openedItems:[{size:"M",onHand:2,borrowed:1,etag:"opened"}],movements:[{at:"2026-11-22T00:00:00Z",action:"到貨入庫",sizes:"S × 1、M × 1、XS × 1",quantity:3,note:"驗收無誤"}]});
 const table=descendants(h.host).find(x=>x.tag==="table"),body=table.children.find(x=>x.tag==="tbody");assert.equal(body.children.length,1);assert.match(content(table),/M2 件1 件/);assert.doesNotMatch(content(table),/XS|5L/);
 assert.match(content(h.host),/新團 T 在庫 3 件.*已拆封在庫 2 件.*借出／送洗 1 件/);assert.match(content(h.host),/到貨入庫.*S × 1、M × 1、XS × 1/);
 descendants(h.host).find(x=>x.tag==="button"&&x.textContent==="查看借用／歸還紀錄").handlers.click();assert.equal(h.loans(),1);
 h.widget.render({items:[],openedItems:[{size:"L",onHand:0,borrowed:1,etag:null}],movements:[]});assert.match(content(h.host),/1 個尺寸待盤點/);assert.match(content(descendants(h.host).find(x=>x.tag==="table")),/L待盤點1 件/);
});
test("opened entry submits one version-checked transfer and repeat clicks cannot duplicate it",async()=>{
 const h=ui({items:[{key:"regular:M",onHand:3,etag:"new-v1"}],openedItems:[{size:"M",onHand:1,borrowed:0,etag:"opened-v1"}],movements:[]});let release;h.hold(new Promise(resolve=>{release=resolve}));h.edit("size","M");h.edit("quantity","2");
 const pending=h.submit();await h.submit();assert.equal(h.calls.length,1);assert.equal(h.field("quantity").disabled,true);assert.equal(h.calls[0].body.action,"OPEN_FROM_NEW");assert.equal(h.calls[0].body.stockEtag,"new-v1");assert.equal(h.calls[0].body.openedEtag,"opened-v1");assert.equal(h.calls[0].body.quantity,2);release();await pending;assert.equal(h.reloads(),1);assert.match(content(h.host),/已更新已拆封庫存/);
});
test("a background update retains entered opened counts but uses the original version to prevent stale overwrites",async()=>{
 const h=ui({items:[],openedItems:[{size:"M",onHand:2,borrowed:1,etag:"old"}],movements:[]});h.edit("action","SET_OPENED_COUNT");h.edit("size","M");h.edit("quantity","0");h.widget.render({items:[],openedItems:[{size:"M",onHand:3,borrowed:0,etag:"new"}],movements:[]});h.reject();await h.submit();assert.equal(h.calls[0].body.openedEtag,"old");assert.equal(h.calls[0].body.quantity,0);assert.equal(h.field("quantity").value,"0");assert.match(content(h.host),/更新未確認/);
});
test("stock counts exclude borrowed shirts and school boundaries plus admin authorization protect both pools",async()=>{
 const h=harness();await h.opened("SET_OPENED_COUNT","M",2);await h.loan("BORROW_VOLUNTEER");await h.opened("SET_OPENED_COUNT","M",0);let view=(await h.view()).jsonBody;assert.equal(view.openedItems[0].onHand,0);assert.equal(view.openedItems[0].borrowed,1);
 for(const role of ["parent","teacher"]){h.setRole(role);assert.equal((await h.view()).status,403);assert.equal((await h.opened("SET_OPENED_COUNT","M",7)).status,403)}
 h.setRole("admin");h.setSchool("school-b");view=(await h.view()).jsonBody;assert.equal(view.items.length,0);assert.equal(view.openedItems.length,0);assert.equal(view.movements.length,0);assert.equal((await h.loan("BORROW_VOLUNTEER")).status,403);
});
