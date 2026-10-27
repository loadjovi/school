import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {financeRecipients,financeNoticeCandidates} from '../api/src/lib/financeNoticeRules.mjs';
import {deliverPaymentNotices,paymentNoticeKey} from '../api/src/lib/paymentNoticeRules.mjs';
const uniform={id:'u1',kind:'regularUniform',studentId:'123456',status:'APPROVED',acquisition:'SELF',amount:300,paymentStatus:'AWAITING_TRANSFER'};
const build=(item=uniform)=>financeNoticeCandidates({uniforms:[item],recipients:['finance@example.com']});
test('only active school admins with active finance assignments receive notifications',()=>{
 assert.deepEqual(financeRecipients([{partitionKey:'FINANCE@example.com',role:'schoolAdmin',status:'active'},{partitionKey:'ordinary@example.com',role:'schoolAdmin',status:'active'},{partitionKey:'inactive@example.com',role:'schoolAdmin',status:'inactive'},{partitionKey:'teacher@example.com',role:'teacher',status:'active'}],[{email:'finance@example.com',status:'active'},{email:'inactive@example.com',status:'active'},{email:'teacher@example.com',status:'active'}]),['finance@example.com']);
});
test('due and reported produce distinct notices; paid, cancelled, free and invalid amounts produce none',()=>{
 const due=build()[0],reported=build({...uniform,paymentStatus:'REPORTED_UNVERIFIED',transferReport:{reportedAt:'2026-10-27T01:00:00Z'}})[0];
 assert.equal(due.stage,'due');assert.equal(reported.stage,'reported');assert.notEqual(paymentNoticeKey(due),paymentNoticeKey(reported));
 for(const overrides of [{paymentStatus:'VERIFIED'},{status:'CANCELLED'},{acquisition:'PUBLIC'},{amount:0},{amount:null},{status:'PENDING'}])assert.equal(build({...uniform,...overrides}).length,0);
 assert.equal(build({...uniform,kind:'competitionUniform'})[0].title,'A 團比賽服');
});
test('dinner reported with registration and field trip due are included; verified registrations excluded',()=>{
 const config={module:'yearEndDinner',id:'d1',title:'期末餐會',enabled:true,paymentOpen:true,feeStatus:'PUBLISHED',firstAdultFee:500,extraAdultFee:400,extraChildFee:200};
 const dinner={id:'f1',kind:'yearEndDinner',activityId:'d1',registrationStatus:'REGISTERED',paymentStatus:'REPORTED_UNVERIFIED',studentIds:['s1'],adults:1,extraChildren:0,transferReport:{expectedAmount:500,reportedAt:'today'}};
 const result=financeNoticeCandidates({families:[dinner,{...dinner,id:'paid',paymentStatus:'VERIFIED'}],configs:[config],recipients:['finance@example.com']});assert.equal(result.length,1);assert.equal(result[0].stage,'reported');assert.equal(result[0].amount,500);
 const field={...config,module:'fieldTrip',studentFee:100};assert.equal(financeNoticeCandidates({families:[{...dinner,kind:'fieldTrip',paymentStatus:'NOT_OPEN',transferReport:undefined}],configs:[field],recipients:['finance@example.com']})[0].stage,'due');
});
test('durable ledger deduplicates each recipient and stage; LAB disabled; stale paid notices never send',async()=>{
 const states=new Map(),sent=[];
 const repository={states:async()=>states,claim:async(k,n)=>{if(states.has(k))return false;states.set(k,{status:'SENDING'});return true},finish:async(k,status)=>states.set(k,{status}),audit:async()=>{},stillDue:async()=>true};
 const send=async n=>{sent.push(n);return {status:'sent'}};
 const notices=build();await deliverPaymentNotices({notices,repository,send,disabled:true});assert.equal(sent.length,0);
 await deliverPaymentNotices({notices,repository,send});await deliverPaymentNotices({notices,repository,send});assert.equal(sent.length,1);
 await deliverPaymentNotices({notices:build({...uniform,paymentStatus:'REPORTED_UNVERIFIED',transferReport:{reportedAt:'t'}}),repository,send});assert.equal(sent.length,2);
 repository.stillDue=async()=>false;await deliverPaymentNotices({notices:build({...uniform,id:'paid-before-send'}),repository,send});assert.equal(sent.length,2);
});
test('transfer reports and dinner registration notify after successful writes; finance delivery respects LAB and rechecks permissions',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const uniform=read('api/src/functions/uniformTransferReport.js');assert.ok(uniform.lastIndexOf('safePaymentNotifications(schoolId')>uniform.lastIndexOf('await t.updateEntity'));
 const family=read('api/src/functions/familyEventRegistration.js');assert.match(family,/payload.paymentStatus==="REPORTED_UNVERIFIED"/);assert.match(family,/body.action==="REPORT_TRANSFER"\?await safePaymentNotifications/);
 const adapter=read('api/src/lib/paymentNotifications.js');assert.match(adapter,/LAB_ENVIRONMENT==="functional-uat"/);assert.match(adapter,/financeRecipients\(admins,assignments\)/);assert.match(adapter,/rebuilt.some\(n=>paymentNoticeKey\(n\)===paymentNoticeKey\(notice\)\)/);
});
