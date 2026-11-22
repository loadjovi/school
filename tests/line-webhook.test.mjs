import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
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
  const source=readFileSync(new URL("../app/line-notification-settings.js",import.meta.url),"utf8");
  const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
  assert.match(source,/重要即時＋每日摘要/);
  assert.match(source,/只有即時/);
  assert.match(source,/只有每日摘要/);
  assert.match(source,/產生群組綁定碼/);
  assert.match(source,/發送測試通知/);
  assert.doesNotMatch(source,/lineChannelSecret|lineAccessToken/);
  assert.doesNotMatch(workspace,/operationTitle\.includes\('LINE 後台待辦通知'\)/);
  assert.match(workspace,/setGroup\(child,isSettings\?'settings':'attendance'\)/);
});


test("push messages attach a quick reply only when supplied and preserve the delivery retry key",async()=>{
 const calls=[];
 const source=readFileSync(new URL("../api/src/lib/lineMessaging.mjs",import.meta.url),"utf8").replace(/^import[^\n]*;\r?\n/gm,"").replace(/^export /gm,"");
 const push=runInNewContext(source+";pushLineMessage",{AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {status:200,ok:true,text:async()=>"{}"}}});
 const quickReply={items:[{type:"action",action:{type:"postback",label:"5 星",data:"lesson-review:0123456789ABCD:5",inputOption:"openKeyboard",fillInText:"#個課評鑑 0123456789ABCD 5 "}}]};
 await push("user","課後評鑑",{accessToken:"test",retryKey:"same-review-event",quickReply});
 assert.deepEqual(JSON.parse(calls[0].options.body).messages[0].quickReply,quickReply);
 assert.equal(calls[0].options.headers["X-Line-Retry-Key"],"same-review-event");
 await push("user","一般通知",{accessToken:"test"});
 assert.deepEqual(JSON.parse(calls[1].options.body).messages,[{type:"text",text:"一般通知"}]);
});
