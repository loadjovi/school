import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=name=>readFileSync(new URL('../app/'+name,import.meta.url),'utf8');
const source=read('uniform-event-admin.js');
function modeHarness(search){
 const nodes=[],byId=new Map();let ready;
 class Node{
  constructor(tag='section'){this.tag=tag;this.children=[];this.dataset={};this.hidden=false;this.attrs={};this.listeners={};nodes.push(this)}
  set id(value){this._id=value;byId.set(value,this)}get id(){return this._id}
  append(...items){this.children.push(...items)}prepend(...items){this.children.unshift(...items)}
  setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}
  addEventListener(k,fn){this.listeners[k]=fn}
 }
 for(const id of ['protectedAdminArea','inlineFinanceReview','uniformFinanceSettings','uniformFinanceKindWrap','uniformFinanceKind','uniformPriceSettings','uniformPriceForm']){const n=new Node();n.id=id}
 byId.get('uniformPriceForm').elements={kind:{value:'regularUniform'}};
 const accounts=new Node();accounts.attrs['data-admin-view']='accounts';
 const document={documentElement:{classList:{add(){}}},createElement:tag=>new Node(tag),getElementById:id=>byId.get(id),addEventListener:(_name,fn)=>{ready=fn},querySelector:selector=>selector.includes('data-admin-view')?accounts:null,querySelectorAll:selector=>nodes.filter(n=>selector.includes('data-finance-panel')?n.dataset.financePanel:n.dataset.financeTab)};
 const window={dispatchEvent(){}};
 runInNewContext(read('uniform-finance-workspace.js'),{window,document,location:{search},URLSearchParams,Event:class{}});ready();
 return {state:window.uniformFinanceWorkspace,byId,nodes};
}
test('finance workspace denies ordinary administrators and parent roles before exposing panels',()=>{
 const h=modeHarness('?workspace=finance');
 for(const me of [{role:'admin',capabilities:{}},{role:'parent',capabilities:{financeVerifier:true}}]){
  assert.equal(h.state.activate(me),false);assert.equal(h.byId.get('financeWorkspaceShell').hidden,true);
 }
});
test('authorized finance workspace shows one task at a time and keeps the operations area separate',()=>{
 const h=modeHarness('?workspace=finance&task=accounts');
 assert.equal(h.state.activate({role:'admin',capabilities:{financeVerifier:true}}),true);
 assert.equal(h.byId.get('financeWorkspaceShell').hidden,false);
 assert.deepEqual(h.nodes.filter(n=>n.dataset.financePanel&&!n.hidden).map(n=>n.dataset.financePanel),['accounts']);
 h.state.select('notifications');
 assert.deepEqual(h.nodes.filter(n=>n.dataset.financePanel&&!n.hidden).map(n=>n.dataset.financePanel),['notifications']);
 h.state.select('not-a-task');
 assert.deepEqual(h.nodes.filter(n=>n.dataset.financePanel&&!n.hidden).map(n=>n.dataset.financePanel),['finance']);
 assert.match(read('uniform-finance-workspace.css'),/#protectedAdminArea>:not\(#financeWorkspaceShell\)/);
});
test('normal operations page never authorizes the financial panels, even for a financial officer',()=>{
 const h=modeHarness('?embedded=school');
 assert.equal(h.state.activate({role:'admin',capabilities:{financeVerifier:true}}),false);
 assert.equal(h.byId.has('financeWorkspaceShell'),false);
});
test('unauthorized direct finance entry stops after identity check without loading financial data',async()=>{
 const start=source.slice(source.indexOf('async function start(){'),source.indexOf('\nel("reload").onclick'));
 for(const me of [{role:'admin',capabilities:{}},{role:'parent',capabilities:{financeVerifier:true}}]){
  const calls=[],gates=[];
  const startFn=runInNewContext(start+';start',{window:{uniformFinanceWorkspace:{ready:Promise.resolve()}},financeWorkspace:true,hasFinanceAccess:false,api:async path=>{calls.push(path);return me},setAuthGate:reason=>gates.push(reason)});
  await startFn();assert.deepEqual(calls,['me']);assert.match(gates.at(-1),/僅限/);
 }
});
test('workspace loader excludes operations modules from finance and bank editors from operations',()=>{
 const scripts=[{dataset:{scope:'finance'},src:'/dinner-bank-admin.js'},{dataset:{scope:'operations'},src:'/tshirt-procurement-admin.js'}];
 for(const finance of [false,true]){
  const loaded=[];
  runInNewContext(read('uniform-admin-loader.js').replace('import(script.src)','load(script.src)'),{window:{uniformFinanceWorkspace:{isFinance:finance}},document:{querySelectorAll:()=>scripts},load:async src=>{loaded.push(src)},console});
  assert.deepEqual(loaded,finance?['/dinner-bank-admin.js']:['/tshirt-procurement-admin.js']);
 }
});
test('operations approval preflight checks only bank availability, not full bank details',()=>{
 const fn=source.slice(source.indexOf('async function checkUniformApprovalAccount('),source.indexOf('function requestUpdateWasSaved'));
 assert.match(fn,/view=availability/);assert.match(fn,/data.configured!==true/);
 const save=source.slice(source.indexOf('el("config").onsubmit='),source.indexOf('document.getElementById("retryAdminAuth")'));
 assert.match(save,/!financeWorkspace/);assert.match(save,/delete item\[key\]/);
});
test('a verified finance update refreshes operational progress without reloading the page or overwriting activity drafts',async()=>{
 let handler;const parent={},calls=[],events=[];
 const scope={financeWorkspace:false,adminAuthenticated:true,location:{origin:'https://school.test'},sessionStorage:{getItem:()=> 'sacred-heart'},window:{parent,addEventListener:(_type,fn)=>{handler=fn},dispatchEvent:event=>events.push(event.type)},CustomEvent:class{constructor(type){this.type=type}},
  cachedRequests:[{id:'request',paymentStatus:'REPORTED_UNVERIFIED'}],cachedStock:[],cachedStockDetails:{},receivedRequestIds:new Set(),
  api:async path=>{calls.push(path);return {items:path.endsWith('/requests')?[{id:'request',status:'APPROVED',paymentStatus:'VERIFIED'}]:[]}},
  renderUniformRequestAlerts(){},renderModuleRequests(){},renderModuleStock(){},el:()=>({textContent:''})};
 const code=source.slice(source.lastIndexOf('window.addEventListener("message",async event=>'));
 runInNewContext(code,scope);
 const event={origin:'https://school.test',source:parent,data:{type:'school-finance-updated',schoolId:'sacred-heart'}};
 await handler({...event,source:{}});await handler({...event,data:{...event.data,schoolId:'another-school'}});assert.equal(calls.length,0);
 await handler(event);assert.equal(scope.cachedRequests[0].paymentStatus,'VERIFIED');
 assert.deepEqual(calls,['uniform-events/requests','uniform-events/inventory','uniform-events/receiving']);
 assert.deepEqual(events,['uniformRequestsLoaded','uniformInventoryLoaded']);
});
test('dedicated finance keeps legacy volunteer payment verification available when adjustment controls are disabled',async()=>{
 class Node{constructor(tag){this.tag=tag;this.children=[];this.handlers={}}append(...nodes){this.children.push(...nodes)}setAttribute(){}addEventListener(type,fn){this.handlers[type]=fn}}
 const calls=[];
 const cardFactory=runInNewContext(source.slice(source.indexOf('function financeCard('),source.indexOf('async function loadInlineFinance()'))+';financeCard',{
  document:{createElement:tag=>new Node(tag)},window:{paymentResolutionUI:{enabled:()=>false}},uniformStudentNames:new Map(),financeWorkspace:true,hasFinanceAccess:true,confirm:()=>true,
  api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return{}},loadInlineFinance:async()=>{}});
 const card=cardFactory({id:'volunteer',etag:'v1',amount:400,parentEmail:'parent@example.test'},'staff');
 const form=card.children.find(n=>n.tag==='form');assert.ok(form);
 const inputs=form.children.filter(n=>n.tag==='label').map(n=>n.children[0]);
 ['2026-11-23','400','12345','銀行查核完成'].forEach((value,i)=>inputs[i].value=value);
 await form.handlers.submit({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].path,'uniform-events/parent-loans');
 assert.deepEqual(calls[0].body,{action:'VERIFY_DEMAND_PAYMENT',id:'volunteer',etag:'v1',bankPostedDate:'2026-11-23',paidAmount:400,lastFive:'12345',note:'銀行查核完成'});
});
