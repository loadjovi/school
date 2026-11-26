import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("app/student-number-support.js");
function approvalUi(response,{error}={}){
  const messages=[],requests=[],events=[];
  const fields={rn_registration:"正式學生",rg_registration:"四年級",rgrp_registration:"A",
    ri_registration:"小提琴",ry_registration:"115",rm_registration:"112001"};
  const context={approveReg(){},$:key=>({value:fields[key]}),
    api:async(path,options)=>{requests.push({path,...options,body:JSON.parse(options.body)});if(error)throw error;return response;},
    toast:text=>messages.push(text),loadAdmin:async()=>events.push("reload"),render:()=>events.push("render")};
  runInNewContext(source,context);
  return {run:()=>context.approveReg("registration"),messages,requests,events};
}

test("approval uses the actual LINE receipt without claiming delivery or an Email failure",async()=>{
  const h=approvalUi({notification:{channel:"line",status:"accepted"},lineNotification:{status:"accepted"}});
  await h.run();
  assert.match(h.messages[0],/已核准並綁定.*LINE 已受理.*收件待確認/);
  assert.doesNotMatch(h.messages[0],/Email|通知信|已送達|已閱讀|寄送成功/);
  assert.deepEqual(h.events,["reload","render"]);
  assert.equal(h.requests[0].path,"/api/student-registration");
  assert.equal(h.requests[0].method,"PATCH");
  assert.deepEqual(h.requests[0].body,{registrationId:"registration",action:"approve",studentName:"正式學生",
    grade:"四年級",groupName:"A",instrument:"小提琴",schoolYear:"115",studentId:"112001"});
});

test("LINE friend, processing and failure outcomes remain separate from successful student approval",async t=>{
  const cases=[
    ["pending_friend",/LINE.*好友.*補送/],
    ["pending",/LINE.*待確認/],
    ["unconfirmed",/LINE.*待確認/],
    ["partial",/部分 LINE.*已受理.*其餘.*待確認/],
    ["not_bound",/LINE.*收件帳號待確認.*尚未送出/],
    ["no_recipient",/LINE.*收件帳號待確認.*尚未送出/],
    ["not_configured",/LINE.*尚未完成設定/],
    ["environment_suppressed",/此環境未對外發送 LINE/],
    ["ineligible",/LINE.*收件資格待確認.*尚未送出/],
    ["failed",/LINE.*發送失敗/],
    ["future_status",/LINE.*待確認/]
  ];
  for(const [status,expected] of cases)await t.test(status,async()=>{
    const h=approvalUi({notification:{channel:"line",status,error:"Email failed secret provider detail"}});
    await h.run();
    assert.match(h.messages[0],/已核准並綁定/);assert.match(h.messages[0],expected);
    assert.doesNotMatch(h.messages[0],/Email|通知信|secret|已送達|已閱讀|寄送成功/);
    assert.deepEqual(h.events,["reload","render"]);
  });
});

test("explicit Email fallback reports Email outcomes while honoring the authoritative channel",async()=>{
  for(const [status,expected] of [["sent",/Email 已受理.*收件待確認/],["failed",/Email.*發送失敗/],
    ["not_configured",/Email.*尚未完成設定/],["no_recipient",/尚無可用的 Email 收件地址/]]){
    const h=approvalUi({notification:{channel:"email",status},lineNotification:{status:"accepted"}});
    await h.run();assert.match(h.messages[0],expected);assert.doesNotMatch(h.messages[0],/LINE 已受理|已送達|通知信/);
  }
});

test("legacy responses prefer known durable LINE results and otherwise use neutral notification wording",async()=>{
  for(const [status,expected] of [["accepted",/LINE 已受理/],["partial",/部分 LINE.*已受理/],
    ["pending_friend",/LINE.*好友.*補送/]]){
    const h=approvalUi({notification:{status:"failed"},lineNotification:{status}});await h.run();
    assert.match(h.messages[0],expected);assert.doesNotMatch(h.messages[0],/Email|通知信|發送失敗/);
  }
  for(const [response,expected] of [[{notification:{status:"sent"}},/核准通知已受理.*收件待確認/],
    [{notification:{status:"failed"}},/核准通知發送失敗/],[{},/^✅ 已核准並綁定$/]]){
    const h=approvalUi(response);await h.run();assert.match(h.messages[0],expected);
    assert.doesNotMatch(h.messages[0],/Email|LINE|通知信|已送達/);
  }
});

test("a failed approval request never claims approval or a successful notification",async()=>{
  const h=approvalUi(null,{error:new Error("審核資料已變更")});await h.run();
  assert.equal(h.messages[0],"❌ 審核資料已變更");assert.deepEqual(h.events,[]);
});

test("fresh page loads request the updated approval UI module",()=>{
  const loader=read("app/webview-guard.js"),html=read("app/index.html");
  assert.match(loader,/\/student-number-support\.js\?v=20261126-approval-notice-channel/);
  assert.match(html,/<script src="\/webview-guard\.js\?v=[^"]*20261126-approval-notice-channel" defer>/);
});
