import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseLineAccountBindingCommand} from "../api/src/lib/lineMessaging.mjs";

const feeApi=readFileSync(new URL("../api/src/functions/feeCollections.js",import.meta.url),"utf8");
const webhook=readFileSync(new URL("../api/src/functions/lineWebhook.js",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/fee-collections.js",import.meta.url),"utf8");
const entry=readFileSync(new URL("../app/fee-collection-entry.js",import.meta.url),"utf8");
const app=readFileSync(new URL("../app/app-v3.js",import.meta.url),"utf8");

test("parent LINE binding uses a separate explicit private-chat command",()=>{
  assert.equal(parseLineAccountBindingCommand("#綁定帳號 123456"),"123456");
  assert.equal(parseLineAccountBindingCommand("綁定帳號：654321"),"654321");
  assert.equal(parseLineAccountBindingCommand("#綁定通知 123456"),"");
  assert.equal(parseLineAccountBindingCommand("#綁定帳號 12345"),"");
  assert.match(webhook,/event\.source\?\.type!=="user"/);
  assert.match(webhook,/route:"line\/account-binding"/);
  assert.match(webhook,/不會在群組公開個人付款資料/);
});

test("phase one fee projects wrap the existing T-shirt and dinner sources",()=>{
  assert.match(feeApi,/TenantUniformEventRequest/);
  assert.match(feeApi,/TenantFamilyEventRegistration/);
  assert.match(feeApi,/projectSourceType\(project\.kind\)/);
  assert.match(feeApi,/FEE_PROJECT_KINDS\.YEAR_END_DINNER/);
  assert.match(feeApi,/route:"fee-collections\/projects"/);
  assert.match(feeApi,/route:"fee-collections\/transfers"/);
  assert.doesNotMatch(feeApi,/LINE[_ ]?Pay/i);
});

test("only assigned finance staff can open projects and verify bank deposits",()=>{
  assert.match(feeApi,/financeVerifier!==true.*僅指定財務人員可開放收費/);
  assert.match(feeApi,/financeVerifier!==true.*僅指定財務人員可核帳/);
  assert.match(feeApi,/PAYMENT_STATUSES\.REPORTED_UNVERIFIED/);
  assert.match(feeApi,/PAYMENT_STATUSES\.VERIFIED/);
  assert.match(feeApi,/fee\.transfer\.verify/);
  assert.match(feeApi,/fee\.transfer\.correction/);
});

test("the role-aware workspace entry links parents and admins to phase one",()=>{
  assert.match(app,/fee-collection-entry\.js\?v=20261107-phase1/);
  assert.match(entry,/收費專案與匯款核帳/);
  assert.match(entry,/查看我的收費專案/);
  assert.match(page,/綁定個人 LINE/);
  assert.match(page,/同步收費對象/);
  assert.match(page,/確認已入帳/);
  assert.match(page,/退回家長補正/);
});
