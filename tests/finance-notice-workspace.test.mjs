import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/payment-notification-admin.js',import.meta.url),'utf8');
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.handlers={};this.hidden=false;this.textContent='';this._html=''}
  set innerHTML(value){this._html=value;this.children=[];for(const [,tag,id] of value.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Element(tag);node.id=id;this.children.push(node)}}
  get innerHTML(){return this._html}
  append(...nodes){this.children.push(...nodes)}
  prepend(...nodes){this.children.unshift(...nodes)}
  replaceChildren(...nodes){this.children=nodes}
  querySelector(selector){if(selector[0]!=='#')throw Error('Unexpected selector '+selector);const id=selector.slice(1);for(const node of this.children){if(node.id===id)return node;const found=node.querySelector(selector);if(found)return found}return null}
  addEventListener(name,handler){(this.handlers[name]??=[]).push(handler)}
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
function harness({finance=false,authorized=false,fetchResponse}={}){
  const listeners={},intervals=[],calls=[],area=new Element(),financePanel=new Element(),store=new Map([['school_context_id','school-a'],['role_context','schoolAdmin']]);
  const document={hidden:false,documentElement:{classList:{contains:()=>false}},getElementById:id=>id==='protectedAdminArea'?area:id==='financeNotificationsPanel'?financePanel:null,createElement:tag=>new Element(tag)};
  const window={uniformFinanceWorkspace:{isFinance:finance,authorized},uniformEventAuthHeaders:()=>({'X-School-Id':store.get('school_context_id')}),addEventListener:(name,handler)=>(listeners[name]??=[]).push(handler),dispatchEvent:event=>{for(const handler of listeners[event.type]||[])handler(event)}};
  const response={status:'preview',uniformStates:[],financeStates:[],deliveryPolicy:'line_first_email_fallback'};
  const fetch=async(url,options)=>{calls.push({url,options});if(fetchResponse)return fetchResponse(url,options,calls.length);return {ok:true,json:async()=>response}};
  vm.runInNewContext(source,{window,document,fetch,sessionStorage:{getItem:key=>store.get(key)},CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail}},setInterval:handler=>intervals.push(handler),Date,Number,Object,String,Error});
  const emit=async(type,detail)=>{window.dispatchEvent({type,detail});await flush()};
  return {window,document,calls,area,financePanel,intervals,response,store,emit,flush};
}

test('operations retain delivery summaries without mounting or reading finance notices, even for a finance officer',async()=>{
  const h=harness();await h.emit('uniformAdminAuth',{authenticated:true,finance:true});await h.emit('uniformRequestsLoaded');await h.emit('focus');h.intervals[0]();await h.window.refreshPaymentEmailStatus();
  assert.equal(h.calls.length,0);assert.equal(h.financePanel.children.length,0);assert.equal(h.area.children.length,0);
  assert.match(h.window.paymentEmailSummaryText({status:'complete',sent:1,deliveryPolicy:'line_first_email_fallback'}),/LINE 優先/);
  const pending={status:'partial',remaining:3,sent:2};assert.equal(await h.window.finishPaymentNotificationBatches(pending),pending);assert.equal(h.calls.length,0);
});
test('finance mode waits for verified finance authorization and only reads on entry',async()=>{
  const h=harness({finance:true});await h.emit('uniformAdminAuth',{authenticated:true});await h.emit('focus');assert.equal(h.calls.length,0);
  await h.emit('uniformAdminAuth',{authenticated:true,finance:true});assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'GET');assert.match(h.calls[0].url,/view=payment-notifications/);assert.equal(h.financePanel.children[0].id,'paymentEmailNotifications');assert.equal(h.area.children.length,0);
});
test('late-loaded finance notices respect the already verified workspace state',async()=>{
  const h=harness({finance:true,authorized:true});await h.flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'GET');assert.equal(h.financePanel.children.length,1);
});
test('revoked finance authorization hides history and prevents refresh, polling and batch continuation',async()=>{
  const h=harness({finance:true});await h.emit('uniformAdminAuth',{authenticated:true,finance:true});assert.equal(h.calls.length,1);
  await h.emit('uniformAdminAuth',{authenticated:false,finance:false});assert.equal(h.financePanel.children[0].hidden,true);
  await h.emit('uniformRequestsLoaded');await h.emit('focus');h.intervals[0]();await h.window.refreshPaymentEmailStatus();await h.window.finishPaymentNotificationBatches({status:'partial',remaining:1});assert.equal(h.calls.length,1);assert.deepEqual(Object.keys(h.window.uniformPaymentEmailStates),[]);
});
test('finance batch continuation stays scoped and never resends an already completed initial result',async()=>{
  const h=harness({finance:true,authorized:true,fetchResponse:async(_url,options)=>({ok:true,json:async()=>options.method==='PATCH'?{status:'complete',sent:2,remaining:0}:{status:'preview',uniformStates:[],financeStates:[]}})});await h.flush();
  const scope={kind:'uniform',id:'order-1'};const result=await h.window.finishPaymentNotificationBatches({status:'partial',sent:1,remaining:2,scope});
  const sends=h.calls.filter(c=>c.options.method==='PATCH');assert.equal(sends.length,1);assert.deepEqual(JSON.parse(sends[0].options.body),{action:'SEND_PAYMENT_NOTICES',scope});assert.equal(result.sent,3);assert.equal(sends[0].options.headers['X-School-Id'],'school-a');
  await h.window.finishPaymentNotificationBatches({status:'complete',sent:1,remaining:0});assert.equal(h.calls.filter(c=>c.options.method==='PATCH').length,1);
});
test('parent reminder is available only for an unpaid displayed application and stops after the daily notice',async()=>{
  const h=harness({finance:true,authorized:true});h.response.uniformStates=[{id:'unpaid',status:'NOT_SENT',recipients:[]},{id:'today',status:'SENT',reminderSentToday:true,recipients:[]},{id:'paid',status:'NOT_REQUIRED',recipients:[]}];await h.flush();
  const history=h.financePanel.children[0].querySelector('#parentPaymentNoticeHistory');assert.equal(history.children.length,3);assert.equal(history.children[0].children.at(-1).textContent,'再次提醒此家長');assert.equal(history.children[1].children.at(-1).disabled,true);assert.equal(history.children[2].children.filter(c=>c.tagName==='button').length,0);
  await h.emit('uniformAdminAuth',{authenticated:false,finance:false});const before=h.calls.length;await history.children[0].children.at(-1).handlers.click[0]();assert.equal(h.calls.length,before);
});
test('per-application initial or failed retry stays scoped and is unavailable for accepted or unknown outcomes',async()=>{
  const h=harness({finance:true,authorized:true});h.response.uniformStates=['NOT_SENT','FAILED','SENT','UNCONFIRMED','PARTIAL','NOT_REQUIRED'].map(status=>({id:'order-'+status,status,recipients:[]}));await h.flush();
  const history=h.financePanel.children[0].querySelector('#parentPaymentNoticeHistory');
  for(let i=0;i<h.response.uniformStates.length;i++)assert.equal(history.children[i].children.some(c=>c.textContent==='補送此筆繳款通知'),i<2);
  const retry=history.children[0].children.find(c=>c.textContent==='補送此筆繳款通知');await retry.handlers.click[0]();
  const sends=h.calls.filter(c=>c.options.method==='PATCH');assert.equal(sends.length,1);assert.deepEqual(JSON.parse(sends[0].options.body),{action:'SEND_PAYMENT_NOTICES',scope:{kind:'uniform',id:'order-NOT_SENT'},retryFailed:true});
});
