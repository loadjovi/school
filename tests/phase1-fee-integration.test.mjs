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
  assert.match(app,/fee-collection-entry\.js\?v=20261108-line-notice/);
  assert.match(entry,/收費專案與匯款核帳/);
  assert.match(entry,/LINE 通知與家長服務/);
  assert.match(entry,/課程、活動與重要提醒/);
  assert.match(page,/開啟 LINE 個人通知/);
  assert.match(page,/本階段先提供團 T、期末餐費及匯款核帳通知/);
  assert.match(page,/目前沒有需要您繳費或回報的項目/);
  assert.match(page,/同步收費對象/);
  assert.match(page,/確認已入帳/);
  assert.match(page,/退回家長補正/);
});

test("first-time LINE onboarding has a verified friend link and refresh action",()=>{
  assert.match(page,/加入／開啟 LINE 官方帳號/);
  assert.match(page,/取得 6 位數綁定碼/);
  assert.match(page,/完整指令/);
  assert.match(page,/refresh-line-binding/);
  assert.match(page,/api\("line\/account-binding"\)/);
  assert.match(page,/尚未提供 LINE 官方帳號加入好友連結/);
  assert.match(page,/https:/);
  assert.match(webhook,/const officialAccountUrl=/);
  assert.match(webhook,/officialAccountUrl:officialAccountUrl\(\)/);
});
