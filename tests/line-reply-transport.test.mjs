import test from "node:test";
import assert from "node:assert/strict";
import {normalizeLineReplyMessage,replyLineMessage,pushLineMessage} from "../api/src/lib/lineMessaging.mjs";

const card=()=>({type:"flex",altText:"今日課程｜11/24",contents:{type:"bubble",body:{type:"box",layout:"vertical",contents:[{type:"text",text:"12:30–13:20 合奏課",wrap:true}]}},fallbackText:"今日課程\n12:30–13:20 合奏課"});
test("query cards are sent as native Flex messages without internal fallback fields",async t=>{
 const requests=[];t.mock.method(globalThis,"fetch",async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return {ok:true,status:200,text:async()=>"{}"}});
 await replyLineMessage("reply-token",card(),{accessToken:"school-a-token"});
 assert.equal(requests.length,1);assert.equal(requests[0].url,"https://api.line.me/v2/bot/message/reply");
 assert.equal(requests[0].options.headers.Authorization,"Bearer school-a-token");
 assert.equal(requests[0].body.replyToken,"reply-token");assert.equal(requests[0].body.messages.length,1);
 assert.deepEqual(Object.keys(requests[0].body.messages[0]),["type","altText","contents"]);
 assert.equal(requests[0].body.messages[0].type,"flex");assert.equal(requests[0].body.messages[0].contents.type,"bubble");
});

test("a confirmed provider rejection falls back once to the same query's readable text",async t=>{
 const requests=[];t.mock.method(globalThis,"fetch",async(_url,options)=>{requests.push(JSON.parse(options.body));const first=requests.length===1;return {ok:!first,status:first?400:200,text:async()=>"{}"}});
 const message=card();await replyLineMessage("reply-token",message,{accessToken:"school-token"});
 assert.equal(requests.length,2);assert.equal(requests[0].messages[0].type,"flex");assert.deepEqual(requests[1].messages,[{type:"text",text:message.fallbackText}]);
 assert.equal(requests[1].replyToken,requests[0].replyToken);
});

test("unknown delivery outcomes never retry or send an additional fallback",async t=>{
 let requests=0;t.mock.method(globalThis,"fetch",async()=>{requests++;return {ok:false,status:503,text:async()=>"{}"}});
 await assert.rejects(replyLineMessage("reply-token",card(),{accessToken:"school-token"}),error=>error.status===503);assert.equal(requests,1);
});

test("empty or excessive card payloads become bounded plain text before contacting LINE",()=>{
 for(const contents of [{type:"carousel",contents:[]},{type:"carousel",contents:Array.from({length:13},()=>card().contents)},{type:"bubble",body:{type:"box",layout:"vertical",contents:[{type:"text",text:"長".repeat(11000)}]}}]){
  assert.deepEqual(normalizeLineReplyMessage({...card(),contents}),{type:"text",text:card().fallbackText});
 }
 assert.equal(normalizeLineReplyMessage("原本的綁定通知").type,"text");
 assert.equal(normalizeLineReplyMessage("原本的綁定通知").text,"原本的綁定通知");
});

test("an absent reply token never sends a card or a plain notification",async t=>{
 t.mock.method(globalThis,"fetch",async()=>{throw Error("Unexpected send")});
 assert.deepEqual(await replyLineMessage("",card(),{accessToken:"school-token"}),{skipped:true});
});

test("private notification pushes retain the recipient, retry identity and rating shortcuts without leaking fallback fields",async t=>{
 const requests=[];t.mock.method(globalThis,"fetch",async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return {ok:true,status:200,text:async()=>"{}"}});
 const quickReply={items:[{type:"action",action:{type:"postback",label:"5 星",data:"review-code",inputOption:"openKeyboard",fillInText:"review draft"}}]};
 await pushLineMessage("own-parent",card(),{accessToken:"school-a-token",retryKey:"same-private-event",quickReply});
 assert.equal(requests.length,1);const {url,options,body}=requests[0];
 assert.equal(url,"https://api.line.me/v2/bot/message/push");assert.equal(body.to,"own-parent");
 assert.equal(options.headers["X-Line-Retry-Key"],"same-private-event");
 assert.equal(options.headers.Authorization,"Bearer school-a-token");
 assert.equal(body.messages[0].type,"flex");assert.deepEqual(body.messages[0].quickReply,quickReply);
 assert.equal(Object.hasOwn(body.messages[0],"fallbackText"),false);
});

test("a rejected notification card falls back once using the same recipient and retry key",async t=>{
 const requests=[];t.mock.method(globalThis,"fetch",async(_url,options)=>{requests.push({options,body:JSON.parse(options.body)});const first=requests.length===1;return {ok:!first,status:first?400:200,text:async()=>"{}"}});
 await pushLineMessage("own-parent",card(),{accessToken:"school-token",retryKey:"same-event"});
 assert.equal(requests.length,2);assert.equal(requests[0].body.messages[0].type,"flex");
 assert.deepEqual(requests[1].body.messages,[{type:"text",text:card().fallbackText}]);
 for(const request of requests){assert.equal(request.body.to,"own-parent");assert.equal(request.options.headers["X-Line-Retry-Key"],"same-event")}
});

test("uncertain notification delivery does not send a second card or fallback",async t=>{
 let requests=0;t.mock.method(globalThis,"fetch",async()=>{requests++;return {ok:false,status:503,text:async()=>"{}"}});
 await assert.rejects(pushLineMessage("own-parent",card(),{accessToken:"school-token",retryKey:"same-event"}),error=>error.status===503);
 assert.equal(requests,1);
});
