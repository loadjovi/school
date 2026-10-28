import test from 'node:test';
import assert from 'node:assert/strict';
import {cadreApplication} from '../api/src/lib/tshirtCadreApplication.mjs';
import {buildTshirtProcurementPlan as build,tshirtPlanCsv,TSHIRT_PLAN_SIZES} from '../app/tshirt-procurement-plan.mjs';
const stamp='2026-10-28T03:00:00Z';
const input={action:'REQUEST_CADRE',size:'XL',parentName:'測試幹部',studentId:'112068'};
const fixture=loan=>({schoolYear:115,semester:1,parentLoans:[{parentEmail:'cadre@example.com',...loan}],stock:TSHIRT_PLAN_SIZES.map(size=>({key:'regular:'+size,onHand:0,reserved:0,unavailable:0}))});
test('initial application has no receipt timestamp and creates exactly one procurement/CSV demand',()=>{
 const loan=cadreApplication(null,input,stamp);assert.equal(loan.status,'REQUESTED');assert.equal(loan.issuedAt,'');assert.equal(loan.schoolYear,115);assert.equal(loan.semester,1);
 const p=build(fixture(loan));assert.equal(p.staffUnits,1);assert.equal(p.needUnits,1);assert.match(tshirtPlanCsv(p),/測試幹部/);assert.match(tshirtPlanCsv(p),/已申請，尚未領取/);
 const f=fixture(loan);f.stock.find(x=>x.key==='regular:XL').onHand=1;assert.equal(build(f).needUnits,0);assert.equal(build(f).staffUnits,1);
});
test('physical confirmation excludes the parent from procurement while preserving lifetime history',()=>{
 const pending=cadreApplication(null,input,stamp),issued=cadreApplication(pending,{...input,action:'ISSUE_CADRE'},stamp);
 assert.equal(issued.status,'ISSUED_LIFETIME');assert.equal(issued.issuedAt,stamp);assert.equal(build(fixture(issued)).staffUnits,0);assert.doesNotMatch(tshirtPlanCsv(build(fixture(issued))),/測試幹部/);
 assert.throws(()=>cadreApplication(issued,input,stamp));assert.throws(()=>cadreApplication(issued,{...input,action:'ISSUE_CADRE'},stamp));assert.throws(()=>cadreApplication(null,{...input,action:'ISSUE_CADRE'},stamp));
});
test('legacy issued state requires an explicit reason to restore demand and allows pending-size correction',()=>{
 const legacy={...input,role:'CADRE',status:'ISSUED_LIFETIME',issuedAt:'2026-10-15T01:17:00Z'};
 assert.throws(()=>cadreApplication(legacy,{...input,action:'CORRECT_CADRE_PENDING'},stamp));
 const corrected=cadreApplication(legacy,{...input,action:'CORRECT_CADRE_PENDING',reason:'舊表單登記申請時誤標領取'},stamp);
 assert.equal(corrected.previousIssuedAt,legacy.issuedAt);assert.equal(corrected.issuedAt,'');assert.equal(build(fixture(corrected)).needUnits,1);
 const resized=cadreApplication(corrected,{...input,action:'EDIT_CADRE_PENDING',size:'M'},stamp);const p=build(fixture(resized));assert.equal(p.sizes.find(x=>x.size==='M').need,1);assert.equal(p.sizes.find(x=>x.size==='XL').need,0);
 assert.throws(()=>cadreApplication(legacy,{...input,action:'EDIT_CADRE_PENDING'},stamp));assert.throws(()=>cadreApplication({...legacy,role:'VOLUNTEER'},{...input,action:'CORRECT_CADRE_PENDING',reason:'x'},stamp));
});
test('existing first demand deduplicates across children; paid add-ons remain independent after receipt',()=>{
 const pending=cadreApplication(null,input,stamp),f=fixture(pending);
 f.staffDemands=[{id:'first',parentEmail:'cadre@example.com',parentName:'測試幹部',studentId:'other-child',category:'CADRE_FIRST',status:'APPROVED',quantity:1,size:'XL',schoolYear:115,semester:1},{id:'extra',parentEmail:'cadre@example.com',parentName:'另購幹部',category:'CADRE_EXTRA',status:'APPROVED',paymentStatus:'VERIFIED',quantity:2,size:'M',schoolYear:115,semester:1}];
 assert.equal(build(f).staffUnits,3);
 f.parentLoans[0]={parentEmail:'cadre@example.com',...cadreApplication(pending,{...input,action:'ISSUE_CADRE'},stamp)};assert.equal(build(f).staffUnits,2);assert.equal(build(f).rows[0].type,'CADRE_EXTRA');
 f.parentLoans[0]={parentEmail:'cadre@example.com',...pending};f.staffDemands[0].status='FULFILLED';assert.equal(build(f).staffUnits,3);
});
test('pending requests carry to later terms but not earlier terms',()=>{
 const f=fixture(cadreApplication(null,input,stamp));f.schoolYear=114;assert.equal(build(f).staffUnits,0);f.schoolYear=116;assert.equal(build(f).staffUnits,1);assert.equal(build(f).carryover,1);
});
