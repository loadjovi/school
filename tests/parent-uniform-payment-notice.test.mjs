import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const id1="11111111-1111-4111-8111-111111111111",id2="22222222-2222-4222-8222-222222222222";
const order=(extra={})=>({id:id1,kind:"regularUniform",studentId:"1",size:"XS",quantity:1,amount:400,status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",...extra});
function harness(){
  const listeners=new Map(),storage=new Map([["school_context_id","sacred-heart"]]),calls=[],timeouts=[],intervals=[];
  let response=async()=>({items:[]});
  const frame={contentWindow:{},contentDocument:{getElementById:()=>null}};
  const ctx={state:{me:{role:"parent",email:"parent@example.invalid"},page:"home",students:[{studentId:"1",name:"甲同學"},{studentId:"2",name:"乙同學"}],student:{studentId:"1"}},
    sessionStorage:{getItem:key=>storage.get(key)||""},home:()=>'<div id="existing-home">今日課程提醒</div>',go:async page=>{ctx.state.page=page},
    api:async(...args)=>{calls.push(args);return response(...args)},render:()=>{},esc:value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),
    document:{hidden:false,head:{append(){}},createElement:()=>({}),getElementById:id=>id==="parentUniformFrame"?frame:null,querySelector:()=>null,addEventListener:(name,fn)=>listeners.set("document:"+name,fn)},
    location:{origin:"https://lab.example.invalid"},addEventListener:(name,fn)=>listeners.set(name,fn),setTimeout:fn=>timeouts.push(fn),setInterval:fn=>intervals.push(fn),Date,console};
  ctx.window=ctx;
  for(const name of ["uniform-payment-state.js","parent-uniform-payment-notice.js"])runInNewContext(readFileSync(new URL("../app/"+name,import.meta.url),"utf8"),ctx);
  return {ctx,storage,calls,listeners,frame,timeouts,intervals,setResponse:fn=>{response=fn}};
}
test("only actionable self-paid approved orders appear; pending, cancelled, delivered, public and unknown amounts never cause payment demands",()=>{
  const {ctx}=harness(),model=ctx.uniformPaymentState;
  for(const status of ["APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"])assert.equal(model.due(order({status})),true);
  for(const extra of [{status:"PENDING"},{status:"CANCELLED"},{status:"FULFILLED"},{acquisition:"PUBLIC"},{amount:0},{amount:null},{amount:"400"},{paymentStatus:"VERIFIED"},{paymentStatus:"REPORTED_UNVERIFIED"},{paymentStatus:"NOT_REQUIRED"},{kind:"fieldTrip"}])assert.equal(model.due(order(extra)),false);
  assert.equal(model.due(order({paymentStatus:undefined})),true); // payable legacy order
  assert.equal(model.reported(order({paymentStatus:"REPORTED_UNVERIFIED"})),true);
  assert.match(model.stage(order()).title,/待匯款/);
  assert.match(model.stage(order({paymentStatus:"REPORTED_UNVERIFIED"})).title,/待財務核帳/);
  assert.match(model.stage(order({paymentStatus:"VERIFIED"})).title,/已確認入帳/);
  assert.equal(model.stage(order({acquisition:"PUBLIC"})),null);
});
test("login home puts each child's payment amount and direct action before the existing home content",async()=>{
  const h=harness();h.setResponse(async()=>({items:[order(),order({id:id2,studentId:"2",size:"M",quantity:2,amount:800})]}));
  await h.ctx.refreshParentUniformPayments();const html=h.ctx.home();
  assert.ok(html.indexOf("團 T 已核准")<html.indexOf('id="existing-home"'));
  assert.match(html,/2 筆待匯款/);assert.match(html,/甲同學/);assert.match(html,/乙同學/);assert.match(html,/NT\$ 400/);assert.match(html,/NT\$ 800/);
  assert.match(html,/查看匯款帳戶／回報末五碼/);assert.match(html,/轉出帳號末五碼/);
  await h.ctx.openParentUniformPayment(id2);assert.equal(h.ctx.state.parentUniformFocus,"payment:"+id2);assert.equal(h.ctx.state.page,"uniformEvents");
  assert.ok(h.calls.every(([url,options])=>url==="/api/uniform-events/requests"&&options===undefined));
});
test("later calendar decoration keeps the payment notice first",async()=>{
  const h=harness();h.setResponse(async()=>({items:[order()]}));await h.ctx.refreshParentUniformPayments();
  h.ctx.parentCalendarCard=()=>'<div id="calendar">活動提醒</div>';
  const source=readFileSync(new URL("../app/special-calendar.js",import.meta.url),"utf8"),start=source.indexOf('  const baseHome=typeof home'),end=source.indexOf('  async function loadCalendarAdmin',start);
  runInNewContext('(()=>{'+source.slice(start,end)+'})();',h.ctx);
  const html=h.ctx.home();assert.ok(html.indexOf("請完成匯款")<html.indexOf('id="calendar"'));assert.ok(html.indexOf('id="calendar"')<html.indexOf('id="existing-home"'));
});
test("reported transfers replace the payment demand and verified transfers remove the notice",async()=>{
  const h=harness();h.setResponse(async()=>({items:[order({paymentStatus:"REPORTED_UNVERIFIED"})]}));
  await h.ctx.refreshParentUniformPayments();const pending=h.ctx.home();
  assert.match(pending,/待財務核帳/);assert.match(pending,/無須重複匯款/);assert.doesNotMatch(pending,/筆待匯款|請完成匯款/);
  h.setResponse(async()=>({items:[order({paymentStatus:"VERIFIED"})]}));await h.ctx.refreshParentUniformPayments();assert.equal(h.ctx.home(),'<div id="existing-home">今日課程提醒</div>');
});
test("home safely escapes stored labels and never interpolates a malformed order ID into executable code",async()=>{
  const h=harness();h.ctx.state.students[0].name='<img onerror="attack()">';h.setResponse(async()=>({items:[order({id:"');attack();//",size:"<script>"})]}));
  await h.ctx.refreshParentUniformPayments();const html=h.ctx.home();assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img|<script|openParentUniformPayment\('[^']*attack/);
  await h.ctx.openParentUniformPayment(id2);assert.equal(h.ctx.state.page,"home");
});
test("a slow response from another parent, school or role cannot populate the current home",async()=>{
  for(const changed of ["parent","school","role"]){
    const h=harness();let release;h.setResponse(()=>new Promise(resolve=>{release=resolve}));const old=h.ctx.refreshParentUniformPayments();
    if(changed==="parent")h.ctx.state.me.email="other@example.invalid";
    if(changed==="school")h.storage.set("school_context_id","other-school");
    if(changed==="role")h.ctx.state.me.role="admin";
    h.setResponse(async()=>({items:[]}));await h.ctx.refreshParentUniformPayments();release({items:[order()]});await old;
    assert.doesNotMatch(h.ctx.home(),/NT\$ 400|請完成匯款/);
  }
});
test("returning home invalidates a pre-report response so it cannot reintroduce a payment demand",async()=>{
  const h=harness();let release;h.setResponse(()=>new Promise(resolve=>{release=resolve}));const old=h.ctx.refreshParentUniformPayments();
  await h.ctx.go("home");h.setResponse(async()=>({items:[order({paymentStatus:"REPORTED_UNVERIFIED"})]}));await h.ctx.refreshParentUniformPayments();release({items:[order()]});await old;
  assert.match(h.ctx.home(),/待財務核帳/);assert.doesNotMatch(h.ctx.home(),/請完成匯款/);
});
test("network errors show a retry instead of a stale payment demand, and only the genuine same-origin child can request updates",async()=>{
  const h=harness();h.setResponse(async()=>({items:[order()]}));await h.ctx.refreshParentUniformPayments();
  const handler=h.listeners.get("message"),data={type:"parent-uniform-requests-updated"},before=h.calls.length;
  handler({origin:"https://other.example.invalid",source:h.frame.contentWindow,data});handler({origin:h.ctx.location.origin,source:{},data});assert.equal(h.calls.length,before);
  h.setResponse(async()=>{throw Error("unavailable")});await h.ctx.refreshParentUniformPayments();const html=h.ctx.home();assert.match(html,/重新讀取付款狀態/);assert.doesNotMatch(html,/NT\$ 400|請完成匯款/);
  handler({origin:h.ctx.location.origin,source:h.frame.contentWindow,data});assert.equal(h.calls.length,before+2);
});
test("the requested payment opens the history panel and targets that exact order after the bank form is available",()=>{
  const source=readFileSync(new URL("../app/parent-uniform-events.js",import.meta.url),"utf8"),start=source.indexOf("let uniformPaymentFocused=false;"),end=source.indexOf('document.getElementById("refreshUniformRequests")',start),messages=[];
  let selected="";const target={style:{}},ctx={location:{search:"?focus="+encodeURIComponent("payment:"+id1),origin:"https://lab.example.invalid"},URLSearchParams,document:{getElementById:id=>id==="uniform-payment-"+id1?target:null},select:value=>{selected=value},requestAnimationFrame:fn=>fn(),window:{parent:{postMessage:(...args)=>messages.push(args)}}};
  runInNewContext(source.slice(start,end)+"\nfocusUniformPayment('"+id2+"');focusUniformPayment('"+id1+"');focusUniformPayment('"+id1+"');",ctx);
  assert.equal(selected,"history");assert.equal(messages.length,1);assert.equal(messages[0][0].requestId,id1);assert.equal(messages[0][1],ctx.location.origin);
  assert.match(source,/payment\.id="uniform-payment-"\+item\.id/);
});
