import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';

function harness(file,{role='admin',finance=false,students=['s1'],seed={}}={}){
 const handlers={},calls={storage:0,parsed:0,writes:0,notices:0,lineStates:0},tables=new Map(),access={role,email:'user@example.test',students,capabilities:{financeVerifier:finance}};
 for(const [name,values] of Object.entries(seed))tables.set(name,new Map(values.map(value=>[value.rowKey,{partitionKey:'school-a',etag:'etag-1',...value}])));
 const store=name=>{
  if(!tables.has(name))tables.set(name,new Map());const rows=tables.get(name);
  return {createTable:async()=>{},getEntity:async(school,id)=>{assert.equal(school,'school-a');if(!rows.has(id))throw Object.assign(Error('missing'),{statusCode:404});return {...rows.get(id)}},
   listEntities:async function*(){for(const row of rows.values())yield {...row}},
   upsertEntity:async row=>{assert.equal(row.partitionKey,'school-a');calls.writes++;rows.set(row.rowKey,{...row,etag:'etag-2'})},
   createEntity:async row=>{assert.equal(row.partitionKey,'school-a');calls.writes++;rows.set(row.rowKey,{...row,etag:'etag-2'})},
   updateEntity:async row=>{assert.equal(row.partitionKey,'school-a');calls.writes++;rows.set(row.rowKey,{...row,etag:'etag-2'})}};
 };
 const source=readFileSync(new URL('../api/src/functions/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 runInNewContext(source,{
  app:{http:(name,options)=>handlers[name]=options.handler},URL,crypto:{randomUUID},randomUUID,process:{env:{STORAGE_CONNECTION_STRING:'test'}},console,
  getTenantContext:async()=>({access,schoolId:'school-a'}),ensureStudentAccess:(who,id)=>who.students?.includes(id),
  json:(jsonBody,status=200)=>({status,jsonBody:JSON.parse(JSON.stringify(jsonBody))}),
  TableClient:{fromConnectionString:(_connection,name)=>{calls.storage++;return store(name)}},
  safePaymentNotifications:async()=>{calls.notices++;return {status:'preview'}},
  uniformPaymentLineStates:async()=>{calls.lineStates++;return {u1:{status:'SENT'}}},
  paidActivitySchedule:row=>row,paidActivityNoticeSummary:()=>null,dispatchPaidActivityNotices:async()=>[],
  syncActivityCalendar:async()=>{},lineFirstLabEnabled:()=>true
 });
 const request=(name,{method='GET',query='',body={}}={})=>handlers[name]({method,url:'https://example.test/api?'+query,query:new URLSearchParams(query),json:async()=>{calls.parsed++;return structuredClone(body)}});
 return {request,calls,tables,access};
}
const bank={bankName:'測試銀行',bankCode:'007',accountHolder:'收款戶',accountNumber:'1234567890'};
const encoded=(rowKey,payload)=>({rowKey,payload:JSON.stringify(payload)});

test('ordinary backend staff cannot read or edit bank account templates, even through direct API calls',async()=>{
 for(const role of ['admin','parent','teacher'])for(const method of ['GET','POST']){
  const h=harness('paymentAccountTemplates.js',{role});
  const result=await h.request('paymentAccountTemplates',{method});assert.equal(result.status,403);
  assert.equal(h.calls.storage,0);assert.equal(h.calls.parsed,0);assert.equal(h.calls.writes,0);
 }
 const h=harness('paymentAccountTemplates.js',{finance:true,seed:{TenantPaymentAccountTemplates:[encoded('b1',{...bank,label:'測試帳戶',active:true})]}});
 assert.equal((await h.request('paymentAccountTemplates')).jsonBody.items[0].accountNumber,bank.accountNumber);
 assert.equal((await h.request('paymentAccountTemplates',{method:'POST',body:{...bank,id:'b1',label:'更新帳戶',active:true}})).status,200);
 assert.equal(h.calls.writes,1);
});

test('uniform bank settings are finance-only; parents retain only their own payable order access',async()=>{
 for(const method of ['GET','POST']){
  const h=harness('uniformPaymentAccount.js');assert.equal((await h.request('uniformPaymentAccount',{method,query:'kind=regularUniform'})).status,403);
  assert.equal(h.calls.storage,0);assert.equal(h.calls.parsed,0);
 }
 const seed={TenantUniformPaymentAccounts:[encoded('uniform:regularUniform',bank)],TenantUniformEventRequest:[encoded('u1',{kind:'regularUniform',studentId:'s1',status:'APPROVED',amount:400,acquisition:'SELF'})]};
 const finance=harness('uniformPaymentAccount.js',{finance:true,seed});assert.equal((await finance.request('uniformPaymentAccount',{query:'kind=regularUniform'})).jsonBody.item.accountNumber,bank.accountNumber);
 const parent=harness('uniformPaymentAccount.js',{role:'parent',seed});assert.equal((await parent.request('uniformPaymentAccount',{query:'kind=regularUniform&requestId=u1'})).status,200);
 const other=harness('uniformPaymentAccount.js',{role:'parent',students:['other'],seed});assert.equal((await other.request('uniformPaymentAccount',{query:'kind=regularUniform&requestId=u1'})).status,403);
 assert.equal((await parent.request('uniformPaymentAccount',{query:'kind=regularUniform'})).status,403);
 assert.equal((await parent.request('uniformPaymentAccount',{method:'POST'})).status,403);assert.equal(parent.calls.parsed,0);
});

test('dinner and activity bank settings are finance-only while published parent payment information remains available',async()=>{
 for(const [name,module] of [['dinnerPaymentAccount','yearEndDinner'],['fieldTripPaymentAccount','fieldTrip']]){
  for(const method of ['GET','POST']){const h=harness('dinnerPaymentAccount.js');assert.equal((await h.request(name,{method,query:'activityId=a1'})).status,403);assert.equal(h.calls.storage,0);assert.equal(h.calls.parsed,0)}
  const seed={TenantUniformEventConfig:[encoded(module+':a1',{enabled:true,paymentOpen:true,collectionOpen:true,feeStatus:'PUBLISHED'})],TenantEventPaymentAccounts:[encoded(module+':a1',bank)]};
  const finance=harness('dinnerPaymentAccount.js',{finance:true,seed});assert.equal((await finance.request(name,{query:'activityId=a1'})).jsonBody.item.accountNumber,bank.accountNumber);
  const parent=harness('dinnerPaymentAccount.js',{role:'parent',seed});assert.equal((await parent.request(name,{query:'activityId=a1'})).status,200);
  assert.equal((await parent.request(name,{method:'POST'})).status,403);assert.equal(parent.calls.parsed,0);
  const closed=harness('dinnerPaymentAccount.js',{role:'parent',seed:{...seed,TenantUniformEventConfig:[encoded(module+':a1',{enabled:false})]}});assert.equal((await closed.request(name,{query:'activityId=a1'})).status,403);
 }
});

test('financial notification history and explicit reminder delivery require assigned finance permission',async()=>{
 for(const role of ['admin','parent']){
  const h=harness('uniformEventRequests.js',{role});assert.equal((await h.request('uniformEventRequests',{query:'view=payment-notifications'})).status,403);assert.equal(h.calls.storage,0);
  for(const action of ['SEND_PAYMENT_NOTICES','SEND_PAYMENT_REMINDER','SEND_PAYMENT_LINE'])assert.equal((await h.request('uniformEventRequests',{method:'PATCH',body:{action,id:'u1'}})).status,403);
  assert.equal(h.calls.notices,0);assert.equal(h.calls.writes,0);
 }
 const h=harness('uniformEventRequests.js',{finance:true});assert.equal((await h.request('uniformEventRequests',{query:'view=payment-notifications'})).status,200);
 assert.equal((await h.request('uniformEventRequests',{method:'PATCH',body:{action:'SEND_PAYMENT_REMINDER',id:'u1'}})).status,200);assert.equal(h.calls.notices,2);
});

test('operations retain request progress without bank evidence or financial notice history',async()=>{
 const seed={TenantUniformEventRequest:[encoded('u1',{kind:'regularUniform',studentId:'s1',status:'APPROVED',paymentStatus:'REPORTED_UNVERIFIED',transferReport:{lastFive:'12345'},verificationNote:'private',bankPostedAt:'2026-11-22',paymentResolution:{balance:100},paymentResolutionEvents:[{note:'private'}],paymentHistory:[{lineRecipient:'parent@example.test'}]})]};
 const operations=harness('uniformEventRequests.js',{seed}),result=await operations.request('uniformEventRequests');assert.equal(result.status,200);
 const item=result.jsonBody.items[0];assert.equal(item.paymentStatus,'REPORTED_UNVERIFIED');
 for(const field of ['transferReport','verificationNote','bankPostedAt','paymentResolution','paymentResolutionEvents','paymentHistory','paymentLineNotification'])assert.equal(Object.hasOwn(item,field),false,field);
 assert.equal(operations.calls.lineStates,0);
 const finance=harness('uniformEventRequests.js',{finance:true,seed}),full=await finance.request('uniformEventRequests');assert.equal(full.jsonBody.items[0].transferReport.lastFive,'12345');assert.equal(full.jsonBody.items[0].paymentLineNotification.status,'SENT');assert.equal(finance.calls.lineStates,1);
});

const trip={module:'fieldTrip',id:'a1',enabled:true,title:'交流活動',location:'學校',startAt:'2026-12-05T12:00:00+08:00',targetGroups:'ALL',paymentMode:'PAY_LATER',feeStatus:'DRAFT',paymentOpen:false,collectionOpen:false,studentFee:400,firstAdultFee:100,extraAdultFee:50,extraChildFee:20};
const financialFields=['paymentMode','feeStatus','paymentOpen','collectionOpen','studentFee','firstAdultFee','extraAdultFee','extraChildFee'];
test('ordinary staff may edit existing activity details while omitted financial settings are preserved',async()=>{
 const h=harness('uniformEventConfig.js',{seed:{TenantUniformEventConfig:[encoded('fieldTrip:a1',trip)]}}),body={...trip,title:'更新交流活動'};
 for(const field of financialFields)delete body[field];
 const result=await h.request('uniformEventConfig',{method:'POST',body});assert.equal(result.status,200);
 const saved=JSON.parse(h.tables.get('TenantUniformEventConfig').get('fieldTrip:a1').payload);
 assert.equal(saved.title,body.title);for(const field of financialFields)assert.equal(saved[field],trip[field]);
});
test('ordinary staff cannot change fees, payment mode or collection status through activity metadata APIs',async()=>{
 const changes={paymentMode:'PAY_NOW',feeStatus:'PUBLISHED',paymentOpen:true,collectionOpen:true,studentFee:401,firstAdultFee:101,extraAdultFee:51,extraChildFee:21};
 for(const [field,value] of Object.entries(changes)){
  const h=harness('uniformEventConfig.js',{seed:{TenantUniformEventConfig:[encoded('fieldTrip:a1',trip)]}});
  const result=await h.request('uniformEventConfig',{method:'POST',body:{...trip,[field]:value}});assert.equal(result.status,403,field);assert.equal(h.calls.writes,0,field);assert.equal(h.calls.notices,0,field);
 }
});
test('ordinary staff may create unpaid drafts; financial officers may update prices without changing activity metadata',async()=>{
 const draft={...trip,enabled:false};for(const field of financialFields)delete draft[field];
 const operations=harness('uniformEventConfig.js');assert.equal((await operations.request('uniformEventConfig',{method:'POST',body:draft})).status,200);
 const saved=JSON.parse(operations.tables.get('TenantUniformEventConfig').get('fieldTrip:a1').payload);assert.equal(saved.studentFee,0);assert.equal(saved.paymentOpen,false);assert.equal(saved.feeStatus,'DRAFT');
 const rejected=harness('uniformEventConfig.js');assert.equal((await rejected.request('uniformEventConfig',{method:'POST',body:{...draft,studentFee:400}})).status,403);assert.equal(rejected.calls.writes,0);
 const finance=harness('uniformEventConfig.js',{finance:true,seed:{TenantUniformEventConfig:[encoded('fieldTrip:a1',trip)]}});assert.equal((await finance.request('uniformEventConfig',{method:'POST',body:{...trip,studentFee:500}})).status,200);
 const priced=JSON.parse(finance.tables.get('TenantUniformEventConfig').get('fieldTrip:a1').payload);assert.equal(priced.studentFee,500);assert.equal(priced.title,trip.title);
});


test('ordinary approval checks receive only a configured boolean, never the account details',async()=>{
 for(const [account,configured] of [[bank,true],[{...bank,accountNumber:'invalid'},false],[null,false]]){
  const seed={TenantUniformPaymentAccounts:account?[encoded('uniform:regularUniform',account)]:[]};
  const h=harness('uniformPaymentAccount.js',{seed});
  const response=await h.request('uniformPaymentAccount',{query:'kind=regularUniform&view=availability'});
  assert.equal(response.status,200);assert.deepEqual(response.jsonBody,{configured});
 }
 const parent=harness('uniformPaymentAccount.js',{role:'parent',seed:{TenantUniformPaymentAccounts:[encoded('uniform:regularUniform',bank)]}});
 assert.equal((await parent.request('uniformPaymentAccount',{query:'kind=regularUniform&view=availability'})).status,403);
});

test('operational audit history excludes financial bank evidence and notice recipients for ordinary staff',async()=>{
 const actions=['request.status','inventory.receive','uniform.transfer.report','uniform.transfer.verify','uniform.price.update','payment-resolution.REQUEST_ADJUSTMENT','payment.email.sent','request.payment_line','request.amount_confirm','family.REPORT_TRANSFER','family.VERIFY_PAYMENT','tshirt.staff.VERIFY_DEMAND_PAYMENT'];
 const seed={TenantUniformEventAudit:actions.map((action,index)=>({rowKey:String(index),action,details:action.startsWith('request.status')?'operation':'private bank evidence'}))};
 const staff=harness('uniformEventAudit.js',{seed}),result=await staff.request('uniformEventAudit');
 assert.equal(result.status,200);assert.deepEqual(result.jsonBody.items.map(row=>row.action),actions.slice(0,2));
 const finance=harness('uniformEventAudit.js',{finance:true,seed});assert.equal((await finance.request('uniformEventAudit')).jsonBody.items.length,actions.length);
});


test('finance officers editing operational metadata also preserve every omitted financial setting',async()=>{
 const h=harness('uniformEventConfig.js',{finance:true,seed:{TenantUniformEventConfig:[encoded('fieldTrip:a1',trip)]}}),body={...trip,title:'財務幹部更新活動地點',location:'文化中心'};
 for(const field of financialFields)delete body[field];
 const result=await h.request('uniformEventConfig',{method:'POST',body});assert.equal(result.status,200);
 const saved=JSON.parse(h.tables.get('TenantUniformEventConfig').get('fieldTrip:a1').payload);
 assert.equal(saved.title,body.title);assert.equal(saved.location,body.location);
 for(const field of financialFields)assert.equal(saved[field],trip[field],field);
});
