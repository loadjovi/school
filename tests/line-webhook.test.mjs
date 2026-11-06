import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  lineBindingCodeHash,lineNotificationModeLabel,normalizeLineNotificationMode,
  parseLineBindingCommand,verifyLineSignature
} from "../api/src/lib/lineMessaging.mjs";

test("LINE webhook signature is checked against the untouched request bytes",()=>{
  const secret="test-channel-secret",body=Buffer.from('{"events":[]}');
  const signature=createHmac("sha256",secret).update(body).digest("base64");
  assert.equal(verifyLineSignature(body,signature,secret),true);
  assert.equal(verifyLineSignature(Buffer.from('{"events": [ ]}'),signature,secret),false);
  assert.equal(verifyLineSignature(body,"invalid",secret),false);
  assert.equal(verifyLineSignature(body,signature,"wrong-secret"),false);
});

test("LINE group binding accepts only the explicit six-digit command",()=>{
  assert.equal(parseLineBindingCommand("#綁定通知 123456"),"123456");
  assert.equal(parseLineBindingCommand("綁定通知：654321"),"654321");
  assert.equal(parseLineBindingCommand("請綁定通知 123456"),"");
  assert.equal(parseLineBindingCommand("#綁定通知 12345"),"");
  assert.equal(lineBindingCodeHash("123456","secret").length,64);
  assert.equal(lineBindingCodeHash("12345","secret"),"");
  assert.notEqual(lineBindingCodeHash("123456","secret"),lineBindingCodeHash("123456","other"));
});

test("LINE notification modes have safe defaults and Traditional Chinese labels",()=>{
  assert.equal(normalizeLineNotificationMode("instant_only"),"instant_only");
  assert.equal(normalizeLineNotificationMode("unknown"),"important_and_daily");
  assert.equal(lineNotificationModeLabel("important_and_daily"),"重要即時＋每日摘要");
  assert.equal(lineNotificationModeLabel("daily_only"),"只有每日摘要");
});

test("webhook endpoint never trusts JSON before validating LINE signature",()=>{
  const source=readFileSync(new URL("../api/src/functions/lineWebhook.js",import.meta.url),"utf8");
  const signatureCheck=source.indexOf("verifyLineSignature");
  const jsonParse=source.indexOf("JSON.parse(rawBody");
  assert.ok(signatureCheck>=0&&jsonParse>signatureCheck);
  assert.match(source,/request\.arrayBuffer\(\)/);
  assert.match(source,/route:"line\/webhook"/);
  assert.match(source,/access\.role!=="admin"/);
  assert.doesNotMatch(source,/console\.log\([^\n]*(LINE_CHANNEL_SECRET|LINE_CHANNEL_ACCESS_TOKEN)/);
});

test("admin UI exposes mode, secure binding and test controls without rendering secrets",()=>{
  const source=readFileSync(new URL("../app/admin-operations.js",import.meta.url),"utf8");
  assert.match(source,/重要即時＋每日摘要/);
  assert.match(source,/只有即時/);
  assert.match(source,/只有每日摘要/);
  assert.match(source,/產生群組綁定碼/);
  assert.match(source,/發送測試通知/);
  assert.doesNotMatch(source,/lineChannelSecret|lineAccessToken/);
});
