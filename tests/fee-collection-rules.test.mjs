import test from "node:test";
import assert from "node:assert/strict";
import {
  canParentReport,maskBankAccount,normalizeFeeProject,paymentStatusLabel,
  validateTransferReport,validateVerification
} from "../api/src/lib/feeCollectionRules.mjs";

test("fee projects accept only the two phase-one sources",()=>{
  assert.deepEqual(normalizeFeeProject({kind:"TEAM_T",title:"第二次團 T",dueDate:"2026-11-30",accountTemplateId:"bank_1",instructions:"請依期限匯款"}),{kind:"TEAM_T",title:"第二次團 T",dueDate:"2026-11-30",accountTemplateId:"bank_1",activityId:"",instructions:"請依期限匯款"});
  assert.equal(normalizeFeeProject({kind:"YEAR_END_DINNER",title:"期末聚餐",dueDate:"2026-12-10",accountTemplateId:"bank_1",activityId:"dinner_115"}).activityId,"dinner_115");
  assert.throws(()=>normalizeFeeProject({kind:"DONATION",title:"捐款",dueDate:"2026-12-10",accountTemplateId:"bank_1"}),/收費類型/);
  assert.throws(()=>normalizeFeeProject({kind:"YEAR_END_DINNER",title:"期末聚餐",dueDate:"2026-12-10",accountTemplateId:"bank_1"}),/選擇活動/);
});

test("parent transfer reports require the exact amount, date and last five digits",()=>{
  assert.deepEqual(validateTransferReport({amount:400,lastFive:"12345",transferDate:"2026-11-07"},400),{amount:400,lastFive:"12345",transferDate:"2026-11-07"});
  assert.throws(()=>validateTransferReport({amount:399,lastFive:"12345",transferDate:"2026-11-07"},400),/相同/);
  assert.throws(()=>validateTransferReport({amount:400,lastFive:"1234",transferDate:"2026-11-07"},400),/末五碼/);
  assert.throws(()=>validateTransferReport({amount:400,lastFive:"12345",transferDate:"not-a-date"},400),/匯款日期/);
});

test("finance verification records posted date and a mandatory audit note",()=>{
  assert.deepEqual(validateVerification({amount:400,bankPostedAt:"2026-11-08",note:"已核對銀行明細"},400),{amount:400,bankPostedAt:"2026-11-08",note:"已核對銀行明細"});
  assert.throws(()=>validateVerification({amount:400,bankPostedAt:"2026-11-08",note:""},400),/核帳備註/);
  assert.throws(()=>validateVerification({amount:500,bankPostedAt:"2026-11-08",note:"已核對"},400),/不一致/);
});

test("reporting opens only for an open project with an unpaid positive charge",()=>{
  assert.equal(canParentReport({projectStatus:"OPEN",paymentStatus:"AWAITING_TRANSFER",amount:400}),true);
  assert.equal(canParentReport({projectStatus:"DRAFT",paymentStatus:"AWAITING_TRANSFER",amount:400}),false);
  assert.equal(canParentReport({projectStatus:"OPEN",paymentStatus:"REPORTED_UNVERIFIED",amount:400}),false);
  assert.equal(canParentReport({projectStatus:"OPEN",paymentStatus:"AWAITING_TRANSFER",amount:0}),false);
  assert.equal(paymentStatusLabel("VERIFIED"),"已確認入帳");
  assert.equal(maskBankAccount("123456789012"),"********9012");
});
