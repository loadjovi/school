import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {newStaffDemand,updateStaffDemand,StaffDemandError} from '../api/src/lib/tshirtStaffDemandRules.mjs';
import {cadreActions,cadreApplication} from '../api/src/lib/tshirtCadreApplication.mjs';
import {validatePurchaseOrderInput,tshirtPurchaseOrderSizes} from '../api/src/lib/tshirtPurchaseOrderRules.mjs';
import {normalizeReceivingDetails} from '../api/src/lib/uniformReceivingRules.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const strip=s=>s.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
function harness(){
 const stores=new Map(),handlers={};let version=0,schoolId='school-a',role='admin',loseBatch=false,failWrite;
 const key=(p,r)=>p+'|'+r,error=statusCode=>Object.assign(Error(String(statusCode)),{statusCode});
 const rows=name=>{if(!stores.has(name))stores.set(name,new Map());return stores.get(name)};
 const put=(name,row)=>{const saved={...structuredClone(row),etag:'e'+(++version)};rows(name).set(key(row.partitionKey,row.rowKey),saved);return saved};
 const db=name=>({createTable:async()=>{},getEntity:async(p,r)=>{const row=rows(name).get(key(p,r));if(!row)throw error(404);return structuredClone(row)},
  createEntity:async row=>{if(rows(name).has(key(row.partitionKey,row.rowKey)))throw error(409);put(name,row)},
  upsertEntity:async(row,mode)=>{const old=rows(name).get(key(row.partitionKey,row.rowKey));put(name,{...(mode==='Merge'?old:{}),...row})},
  updateEntity:async(row,mode,options)=>{if(failWrite?.name===name&&failWrite.id===row.rowKey){failWrite=null;throw error(503)}const old=rows(name).get(key(row.partitionKey,row.rowKey));if(!old)throw error(404);if(options?.etag&&options.etag!=='*'&&old.etag!==options.etag)throw error(412);put(name,{...(mode==='Merge'?old:{}),...row})},
  listEntities:async function*({queryOptions}={}){const p=queryOptions?.filter?.match(/PartitionKey eq '([^']+)'/)?.[1];for(const row of rows(name).values())if(!p||row.partitionKey===p)yield structuredClone(row)},
  submitTransaction:async actions=>{assert.ok(actions.length<=100);assert.equal(new Set(actions.map(([,r])=>r.partitionKey)).size,1);const staged=new Map(rows(name)),seen=new Set();for(const [action,row,mode,options]of actions){const k=key(row.partitionKey,row.rowKey),old=staged.get(k);assert.equal(seen.has(k),false);seen.add(k);if(action==='create'?!!old:!old||options?.etag&&options.etag!=='*'&&old.etag!==options.etag)throw error(action==='create'?409:412);staged.set(k,{...(mode==='Merge'?old:{}),...structuredClone(row),etag:'e'+(++version)})}stores.set(name,staged);if(name==='TenantUniformInventory'&&loseBatch){loseBatch=false;throw error(503)}}});
 const scope={TableClient:{fromConnectionString:(_connection,name)=>db(name)},randomUUID,Buffer,URL,console:{error(){},warn(){}},process:{env:{STORAGE_CONNECTION_STRING:'test'}},newStaffDemand,updateStaffDemand,StaffDemandError,cadreActions,cadreApplication,validatePurchaseOrderInput,tshirtPurchaseOrderSizes,normalizeReceivingDetails,
  app:{http:(name,config)=>{handlers[name]=config.handler}},json:(jsonBody,status=200)=>({status,jsonBody}),getTenantContext:async()=>({schoolId,access:{role,email:'admin@example.test',capabilities:{financeVerifier:true}},tenant:{schoolName:'學校'}}),getUniformPrice:async()=>({unitPrice:400}),safePaymentNotifications:async()=>({status:'disabled'}),getStudentMaster:async id=>({studentName:'學生'+id,status:'active'}),getStudentAliasInfo:async id=>({canonicalStudentId:id}),listUserStudentMappings:async()=>[],ensureTenantTables:async()=>{},tenantTable:db,tenantParentPartition:(s,email)=>s+':'+email,sendUniformRequestStatusEmail:async()=>({status:'sent'})};
 Object.assign(scope,runInNewContext(strip(read('api/src/lib/tshirtPurchaseOrderFlow.js'))+';({tshirtClaimKey,activeTshirtClaim})',{...scope}));
 Object.assign(scope,runInNewContext(strip(read('api/src/lib/tshirtStaffIssue.js'))+';({issueStaffTshirt,staffReceiptKey,staffIssueKey,cadreIssueKey,getStaffIssueRow,syncCadreIssueLoan})',{...scope}));
 Object.assign(scope,runInNewContext(strip(read('api/src/lib/tshirtAvailableStock.js'))+';({allocateTshirtAvailableStock})',{...scope}));
 Object.assign(scope,runInNewContext(strip(read('api/src/lib/tshirtStaffProcurement.js'))+';({staffProcurement})',{...scope}));
 for(const name of ['tshirtPurchaseOrders','tshirtParentLoans'])runInNewContext(strip(read('api/src/functions/'+name+'.js')),{...scope});
 const current=(name,id,s=schoolId)=>rows(name).get(key(s,id));
 const payload=(name,id)=>JSON.parse(current(name,id).payload);
 const stock=(onHand=1,reserved=0)=>put('TenantUniformInventory',{partitionKey:schoolId,rowKey:'regular:S',onHand,reserved,unavailable:0});
 const seed=(id='staff-one',extra={})=>{const record={parentEmail:'parent@example.test',parentName:'幹部家長',studentId:'990101',category:'CADRE_FIRST',size:'S',quantity:1,schoolYear:115,semester:1,status:'APPROVED',paymentStatus:'NOT_REQUIRED',amount:0,createdAt:'2026-11-24T00:00:00Z',...extra};put('TenantTshirtStaffDemand',{partitionKey:schoolId,rowKey:id,payload:JSON.stringify(record)});put('tenantUserStudentMap',{partitionKey:schoolId+':'+record.parentEmail,rowKey:record.studentId,status:'active'});return id};
 const call=(name,input,method='POST')=>handlers[name]({method,query:new URLSearchParams(),json:async()=>input});
 const create=ids=>call('tshirtPurchaseOrders',{action:'CREATE',requestKey:randomUUID(),schoolYear:115,semester:1,items:[{size:'S',quantity:10}],links:ids.map(id=>({type:'STAFF',id,etag:current('TenantTshirtStaffDemand',id).etag}))});
 const receive=id=>call('tshirtPurchaseOrders',{action:'RECEIVE',id,etag:current('TenantTshirtPurchaseOrders',id).etag,receivedDate:'2026-11-24',note:'尺碼件數核對無誤'});
 const fulfill=id=>call('tshirtParentLoans',{action:'UPDATE_DEMAND_STATUS',id,etag:current('TenantTshirtStaffDemand',id).etag,status:'FULFILLED',note:'已核對尺寸並實際交付'});
 const requestLoan=()=>call('tshirtParentLoans',{action:'REQUEST_CADRE',parentEmail:'parent@example.test',parentName:'幹部家長',studentId:'990101',size:'S'});
 const issueLoan=()=>call('tshirtParentLoans',{action:'ISSUE_CADRE',parentEmail:'parent@example.test',parentName:'幹部家長',studentId:'990101',size:'S',etag:current('TenantTshirtParentLoans','parent@example.test')?.etag});
 return {...scope,db,put,current,payload,stock,seed,call,create,receive,fulfill,requestLoan,issueLoan,rows,setSchool:id=>{schoolId=id},setRole:value=>{role=value},loseBatch:()=>{loseBatch=true},failUpdate:(name,id)=>{failWrite={name,id}}};
}
test('staff whole-order arrival reserves its piece and actual issue closes demand and lifetime record exactly once',async()=>{
 const h=harness(),id=h.seed();h.put('TenantUniformInventory',{partitionKey:'school-a',rowKey:'regular-opened:S',onHand:4,reserved:0,unavailable:0});
 const created=await h.create([id]);assert.equal(created.status,201);const order=created.jsonBody.item.id;
 assert.equal((await h.receive(order)).status,200);assert.equal((await h.receive(order)).status,200);
 assert.equal(h.current('TenantUniformInventory','regular:S').onHand,10);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,1);
 assert.equal(h.payload('TenantTshirtStaffDemand',id).status,'ARRIVED');
 assert.equal((await h.fulfill(id)).status,200);assert.equal(h.current('TenantUniformInventory','regular:S').onHand,9);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,0);
 assert.equal(h.payload('TenantTshirtStaffDemand',id).status,'FULFILLED');assert.equal(h.current('TenantTshirtParentLoans','parent@example.test').status,'ISSUED_LIFETIME');
 await h.fulfill(id);await h.issueLoan();assert.equal(h.current('TenantUniformInventory','regular:S').onHand,9);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,0);
 assert.equal(h.current('TenantUniformInventory','regular-opened:S').onHand,4);
});
test('a failed source update after issue is recoverable without a second physical deduction',async()=>{
 const h=harness(),id=h.seed();const order=(await h.create([id])).jsonBody.item.id;await h.receive(order);
 h.failUpdate('TenantTshirtStaffDemand',id);assert.notEqual((await h.fulfill(id)).status,200);assert.equal(h.current('TenantUniformInventory','regular:S').onHand,9);
 const retried=await h.fulfill(id);assert.equal(retried.status,200);assert.equal(h.payload('TenantTshirtStaffDemand',id).status,'FULFILLED');assert.equal(h.current('TenantUniformInventory','regular:S').onHand,9);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,0);
});
test('the cadre confirmation screen closes its matching arrived procurement demand without a second handover',async()=>{
 const h=harness(),id=h.seed();assert.equal((await h.requestLoan()).status,200);const order=(await h.create([id])).jsonBody.item.id;await h.receive(order);
 assert.equal((await h.issueLoan()).status,200);assert.equal(h.payload('TenantTshirtStaffDemand',id).status,'FULFILLED');assert.equal(h.current('TenantTshirtParentLoans','parent@example.test').status,'ISSUED_LIFETIME');
 assert.equal(h.current('TenantUniformInventory','regular:S').onHand,9);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,0);
 await h.issueLoan();await h.fulfill(id);assert.equal(h.current('TenantUniformInventory','regular:S').onHand,9);
});
test('verified staff extra purchases issue their actual quantity and do not consume a lifetime entitlement',async()=>{
 const h=harness(),id=h.seed('staff-extra',{category:'VOLUNTEER_EXTRA',quantity:2,paymentStatus:'VERIFIED',amount:800});const order=(await h.create([id])).jsonBody.item.id;
 assert.equal((await h.receive(order)).status,200);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,2);
 assert.equal((await h.fulfill(id)).status,200);assert.equal(h.current('TenantUniformInventory','regular:S').onHand,8);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,0);
 assert.equal(h.current('TenantTshirtParentLoans','parent@example.test'),undefined);assert.ok(h.current('TenantUniformInventory',h.staffIssueKey(id)));assert.equal(h.current('TenantUniformInventory',h.cadreIssueKey('parent@example.test')),undefined);
 await h.fulfill(id);assert.equal(h.current('TenantUniformInventory','regular:S').onHand,8);
});
test('a direct cadre handover uses available new stock and never consumes another reservation',async()=>{
 for(const reserved of [0,1]){
  const h=harness();h.seed('mapping-only');h.rows('TenantTshirtStaffDemand').clear();h.stock(1,reserved);assert.equal((await h.requestLoan()).status,200);
  const result=await h.issueLoan();assert.equal(result.status,reserved?409:200);
  assert.equal(h.current('TenantUniformInventory','regular:S').onHand,reserved?1:0);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,reserved);
  assert.equal(h.current('TenantTshirtParentLoans','parent@example.test').status,reserved?'REQUESTED':'ISSUED_LIFETIME');
  await h.issueLoan();assert.equal(h.current('TenantUniformInventory','regular:S').onHand,reserved?1:0);
 }
});
test('a separate first entitlement cannot reuse an earlier lifetime handover ledger',async()=>{
 const h=harness(),record={category:'CADRE_FIRST',parentEmail:'parent@example.test',size:'S',quantity:1,status:'ARRIVED',paymentStatus:'NOT_REQUIRED'};h.stock(3);
 await h.issueStaffTshirt({inventory:h.db('TenantUniformInventory'),schoolId:'school-a',id:'first-a',record,actor:'admin@example.test',note:'交付'});
 await assert.rejects(h.issueStaffTshirt({inventory:h.db('TenantUniformInventory'),schoolId:'school-a',id:'first-b',record,actor:'admin@example.test',note:'不同申請'}));
 assert.equal(h.current('TenantUniformInventory','regular:S').onHand,2);
});
test('an already issued lifetime entitlement blocks both new procurement and a later receipt race',async()=>{
 const h=harness(),id=h.seed();h.stock(3);
 h.put('TenantTshirtParentLoans',{partitionKey:'school-a',rowKey:'parent@example.test',parentName:'幹部家長',studentId:'990101',role:'CADRE',size:'S',status:'ISSUED_LIFETIME'});
 assert.equal((await h.create([id])).status,409);assert.equal(h.current('TenantUniformInventory','regular:S').onHand,3);
 const r=harness(),rid=r.seed(),order=(await r.create([rid])).jsonBody.item.id;
 r.put('TenantTshirtParentLoans',{partitionKey:'school-a',rowKey:'parent@example.test',parentName:'幹部家長',studentId:'990101',role:'CADRE',size:'S',status:'ISSUED_LIFETIME'});
 assert.equal((await r.receive(order)).status,409);assert.equal(r.current('TenantUniformInventory','regular:S'),undefined);assert.equal(r.current('TenantUniformInventory','po-received:'+order),undefined);assert.equal(r.current('TenantUniformInventory',r.staffReceiptKey(rid)),undefined);
});
test('concurrent actual issue attempts share one durable ledger even when the first response is lost',async()=>{
 const h=harness(),record={category:'CADRE_FIRST',parentEmail:'parent@example.test',size:'S',quantity:1,status:'ARRIVED',paymentStatus:'NOT_REQUIRED'};h.stock(2,1);
 h.put('TenantUniformInventory',{partitionKey:'school-a',rowKey:h.staffReceiptKey('same-staff'),demandId:'same-staff',size:'S',quantity:1,reservedQuantity:1});
 h.loseBatch();await Promise.allSettled(Array.from({length:3},()=>h.issueStaffTshirt({inventory:h.db('TenantUniformInventory'),schoolId:'school-a',id:'same-staff',record,actor:'admin@example.test',note:'交付'})));
 await h.issueStaffTshirt({inventory:h.db('TenantUniformInventory'),schoolId:'school-a',id:'same-staff',record,actor:'admin@example.test',note:'重試確認'});
 assert.equal(h.current('TenantUniformInventory','regular:S').onHand,1);assert.equal(h.current('TenantUniformInventory','regular:S').reserved,0);assert.ok(h.current('TenantUniformInventory',h.cadreIssueKey(record.parentEmail)));
});
test('a parent allocation and direct staff issue cannot both consume the last available new shirt',async()=>{
 const h=harness(),id=h.seed(),record={...h.payload('TenantTshirtStaffDemand',id),status:'ARRIVED'};h.stock(1);
 h.put('TenantUniformEventRequest',{partitionKey:'school-a',rowKey:'parent-request',payload:JSON.stringify({kind:'regularUniform',studentId:'990101',parentEmail:'other@example.test',size:'S',quantity:1,status:'APPROVED',paymentStatus:'VERIFIED'})});
 await Promise.allSettled([h.issueStaffTshirt({inventory:h.db('TenantUniformInventory'),schoolId:'school-a',id,record,actor:'admin@example.test',note:'交付'}),h.allocateTshirtAvailableStock('school-a','parent-request',{actor:'admin@example.test'})]);
 const stock=h.current('TenantUniformInventory','regular:S'),issued=!!h.current('TenantUniformInventory',h.cadreIssueKey(record.parentEmail)),parentReady=h.payload('TenantUniformEventRequest','parent-request').status==='READY_FOR_PICKUP';
 assert.ok(stock.onHand>=stock.reserved);assert.equal(Number(issued)+Number(parentReady),1);assert.equal(stock.onHand+Number(issued),1);
});
test('unpaid staff purchases, foreign-school stock and historical fulfilled records are never newly deducted',async()=>{
 for(const paymentStatus of ['AWAITING_TRANSFER','REPORTED_UNVERIFIED','ADJUSTMENT_REQUIRED','REFUND_REQUESTED']){
  const h=harness(),id=h.seed('unpaid',{category:'CADRE_EXTRA',paymentStatus,status:'ARRIVED',amount:400});h.stock(2);
  assert.notEqual((await h.fulfill(id)).status,200);assert.equal(h.current('TenantUniformInventory','regular:S').onHand,2);
 }
 const h=harness(),id=h.seed('historical',{status:'FULFILLED'});h.stock(2);await h.fulfill(id);assert.equal(h.current('TenantUniformInventory','regular:S').onHand,2);
 const record={category:'CADRE_FIRST',parentEmail:'parent@example.test',size:'S',quantity:1,status:'APPROVED',paymentStatus:'NOT_REQUIRED'};await assert.rejects(h.issueStaffTshirt({inventory:h.db('TenantUniformInventory'),schoolId:'school-b',id:'foreign',record,actor:'admin@example.test',note:'交付'}));
 assert.equal(h.current('TenantUniformInventory','regular:S').onHand,2);
});
