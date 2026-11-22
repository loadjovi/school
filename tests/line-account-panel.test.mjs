import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../app/line-account-panel.js',import.meta.url),'utf8').replace(/^export /gm,'');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.parentNode=null;this.ownText='';this.handlers={};this.hidden=false;this.disabled=false}
 get isConnected(){return this.connected===true||this.parentNode?.isConnected===true}
 set textContent(value){this.ownText=String(value);this.children=[]}get textContent(){return this.ownText+this.children.map(x=>x.textContent||'').join('')}
 append(...nodes){for(const node of nodes){if(node.parentNode){node.parentNode.children=node.parentNode.children.filter(x=>x!==node)}node.parentNode=this;this.children.push(node)}}
 replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.ownText='';this.append(...nodes)}
 addEventListener(type,fn){this.handlers[type]=fn}setAttribute(name,value){this[name]=value}
}
function nodes(host){return [host,...host.children.flatMap(nodes)]}
const bound={configured:true,bound:true,googleLinked:true,authProvider:'google',lineDisplayName:'測試家長'};
const unbound={configured:true,bound:false,googleLinked:false,authProvider:'google',lineDisplayName:''};
function fixture({line=bound,role='admin',capability=true,returnTo='account',onChanged=async()=>{},apiOverride,google=false}={}){
 const host=new Element();host.connected=true;const calls=[],navigation=[],changes=[],storage=new Map([['school_context_id','school-a'],['role_context','schoolAdmin'],['google_id_token','token-a']]);let current={...line},confirmed=true,googleConfig;
 const document={head:new Element('head'),createElement:tag=>new Element(tag)};document.head.connected=true;
 const window={confirm:()=>confirmed,...(google?{google:{accounts:{id:{initialize:config=>{googleConfig=config},renderButton:node=>node.append(new Element('google-button'))}}}}:{})};
 const factory=runInNewContext(source+';createLineAccountPanel',{window,document,sessionStorage:{getItem:key=>storage.get(key)||''},location:{assign:url=>navigation.push(url)},navigator:{userAgent:'Test Chrome'},URL,Set,Promise});
 const api=async(path,options)=>{
  const body=options?.body?JSON.parse(options.body):undefined;calls.push({path,method:options?.method||'GET',body});
  if(apiOverride){const response=await apiOverride(path,options,body);if(response!==undefined)return response}
  if(path==='/api/config')return {googleClientId:'google-client'};
  if(path.includes('/tenant-login/'))return {url:'https://access.line.me/oauth2/v2.1/authorize?state=test'};
  if(!options?.method||options.method==='GET')return {...current};
  if(options.method==='DELETE'){current={...unbound};return {configured:true,bound:false}}
  if(body?.credential){current={...current,pendingLink:{confirmationId:'confirm-id',googleEmail:'parent@example.test',lineDisplayName:'LINE 家長'}};return {...current}}
  if(body?.action==='sync-menu')return {audience:'staff',chatActionsVerified:true,areaCount:6};
  if(body?.action==='confirm-link')current={...bound};
  if(body?.action==='cancel-link')current={...unbound};
  return {...current};
 };
 const panel=factory({host,api,me:{role,schoolId:'school-a',capabilities:{lineAccount:capability}},returnTo,navigate:url=>navigation.push(url),onChanged:async change=>{changes.push(change.action);await onChanged(change)}});
 const button=text=>nodes(host).find(n=>n.tag==='button'&&n.ownText===text);
 return {host,panel,calls,navigation,changes,storage,button,click:async text=>{const node=button(text);assert.ok(node,'button '+text);return node.handlers.click()},setConfirmed:value=>confirmed=value,googleConfig:()=>googleConfig,setLine:value=>current=value};
}
test('personal binding construction does no work and authorized entry reads only its own account',async()=>{
 for(const role of ['admin','parent','privateTeacher']){
  const h=fixture({role});assert.equal(h.calls.length,0);await h.panel.load();
  assert.deepEqual(h.calls,[{path:'/api/line/school-account',method:'GET',body:undefined}]);
  assert.match(h.host.textContent,/已連結 測試家長/);assert.doesNotMatch(h.host.textContent,/收費|帳戶範本/);
 }
});
test('an unsupported role or missing account capability cannot start account requests or mutations',async()=>{
 for(const options of [{role:'teacherUnknown'},{capability:false}]){const h=fixture(options);await h.panel.load();assert.equal(h.calls.length,0);assert.match(h.host.textContent,/尚未開啟|已授權的身分/);assert.equal(h.button('使用 LINE 授權並綁定'),undefined)}
});
test('OAuth starts only on action and requests the fixed notification-center destination when selected',async()=>{
 for(const returnTo of ['account','notification-center']){
  const h=fixture({line:unbound,returnTo});await h.panel.load();await h.click('使用 LINE 授權並綁定');
  const call=h.calls.find(x=>x.method==='POST');assert.equal(call.path,'/api/line/tenant-login/school-a/start');
  assert.deepEqual(call.body,returnTo==='notification-center'?{mode:'link',returnTo:'notification-center'}:{mode:'link'});
  assert.deepEqual(h.navigation,['https://access.line.me/oauth2/v2.1/authorize?state=test']);
 }
});
test('an invalid authorization URL never navigates away from the verified application',async()=>{
 const h=fixture({line:unbound,apiOverride:path=>path.includes('/tenant-login/')?{url:'https://evil.test/'}:undefined});await h.panel.load();await h.click('使用 LINE 授權並綁定');assert.equal(h.navigation.length,0);assert.match(h.host.textContent,/授權網址不正確/);
});
test('the pending Gmail and LINE pair is shown as text and linked only by explicit confirmation',async()=>{
 const h=fixture({line:{...unbound,pendingLink:{confirmationId:'confirmation',googleEmail:'<img src=x>',lineDisplayName:'測試 LINE'}}});await h.panel.load(new URLSearchParams('line_link=confirm'));
 assert.match(h.host.textContent,/<img src=x>/);assert.equal(nodes(h.host).some(n=>n.tag==='img'),false);assert.equal(h.calls.some(c=>c.method!=='GET'),false);
 await h.click('確認綁定');assert.deepEqual(h.calls.find(c=>c.method==='POST').body,{action:'confirm-link',confirmationId:'confirmation'});assert.deepEqual(h.changes,['confirm']);assert.match(h.host.textContent,/已完成此校 Gmail 與 LINE 綁定/);
});
test('canceling a displayed pair uses the cancel action and never confirms it',async()=>{
 const h=fixture({line:{...unbound,pendingLink:{confirmationId:'confirmation',googleEmail:'parent@example.test'}}});await h.panel.load();await h.click('取消');
 assert.deepEqual(h.calls.find(c=>c.method==='POST').body,{action:'cancel-link',confirmationId:'confirmation'});assert.match(h.host.textContent,/已取消/);assert.deepEqual(h.changes,['cancel']);
});
test('unlinking requires confirmation and a successful readback before displaying completion',async()=>{
 const h=fixture();await h.panel.load();h.setConfirmed(false);await h.click('解除 LINE 綁定');assert.equal(h.calls.some(c=>c.method==='DELETE'),false);
 h.setConfirmed(true);await h.click('解除 LINE 綁定');assert.equal(h.calls.filter(c=>c.method==='DELETE').length,1);assert.equal(h.calls.at(-1).method,'GET');assert.match(h.host.textContent,/已解除此校/);assert.ok(h.button('使用 LINE 授權並綁定'));
});
test('syncing the personal menu retains staff response semantics without changing binding',async()=>{
 const h=fixture();await h.panel.load();await h.click('同步我的 LINE 選單');assert.deepEqual(h.calls.at(-1).body,{action:'sync-menu'});assert.match(h.host.textContent,/幹部六宮格/);assert.deepEqual(h.changes,['sync']);
});
test('an in-flight mutation cannot be submitted twice and late scope changes clear private identity text',async()=>{
 let resolve;const waiting=new Promise(r=>resolve=r);const h=fixture({apiOverride:async(_path,options)=>{if(options?.method==='DELETE')return waiting}});
 await h.panel.load();const action=h.click('解除 LINE 綁定');assert.equal(h.panel.isBusy(),true);await h.click('解除 LINE 綁定');assert.equal(h.calls.filter(c=>c.method==='DELETE').length,1);
 h.storage.set('school_context_id','school-b');resolve({configured:true,bound:false});await action;assert.doesNotMatch(h.host.textContent,/測試家長/);assert.match(h.host.textContent,/身分已變更/);assert.equal(h.changes.length,0);
});
test('destroying a panel prevents a late load from restoring personal data',async()=>{
 let resolve;const h=fixture({apiOverride:()=>new Promise(r=>resolve=r)});const read=h.panel.load();h.panel.destroy();resolve(bound);await read;assert.equal(h.host.textContent,'');
});
test('LINE-authenticated Google linking displays a preview before confirming the pair',async()=>{
 const h=fixture({line:{...unbound,authProvider:'line'},google:true});await h.panel.load();await new Promise(setImmediate);
 assert.ok(h.googleConfig());assert.equal(h.calls.some(c=>c.method==='POST'),false);
 h.googleConfig().callback({credential:'verified-google-credential'});await new Promise(setImmediate);
 const credential=h.calls.find(c=>c.body?.credential);assert.equal(credential.path,'/api/line/school-account');assert.match(h.host.textContent,/parent@example.test/);assert.ok(h.button('確認綁定'));assert.doesNotMatch(h.host.textContent,/verified-google-credential/);
});
test('callback errors are shown locally and successful binding is not mislabeled if the caller refresh fails',async()=>{
 const callback=fixture();await callback.panel.load(new URLSearchParams('line_error=conflict'));assert.match(callback.host.textContent,/已有其他綁定/);assert.equal(callback.calls.length,1);
 const h=fixture({onChanged:async()=>{throw Error('unavailable')}});await h.panel.load();await h.click('解除 LINE 綁定');assert.match(h.host.textContent,/已解除此校 LINE 綁定.*頁面更新未完成/);assert.doesNotMatch(h.host.textContent,/操作未完成/);
});

test('an initial read failure can be retried without leaving the inline panel',async()=>{
 let first=true;const h=fixture({apiOverride:async(_path,options)=>{if(!options?.method&&first){first=false;throw Error('暫時無法讀取')}}});
 await h.panel.load();assert.match(h.host.textContent,/暫時無法讀取/);assert.ok(h.button('重新讀取綁定狀態'));
 await h.click('重新讀取綁定狀態');assert.match(h.host.textContent,/已連結 測試家長/);assert.equal(h.calls.length,2);
});
test('the actual standalone account entry reuses this panel without loading financial data',async()=>{
 const elements=Object.fromEntries(['siteName','roleTitle','roleIntro','status','lineBinding'].map(id=>{const node=new Element();node.connected=true;return [id,node]}));
 const calls=[];
 const scope={document:{documentElement:{hasAttribute:()=>true},getElementById:id=>elements[id]||null,createElement:tag=>new Element(tag),addEventListener(){}},window:{},location:{hash:'',search:'',pathname:'/line-account.html'},history:{replaceState(){}},sessionStorage:{getItem:()=>''},URLSearchParams,URL,navigator:{userAgent:'Test'},console,
  fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url==='/api/me'?{role:'parent',schoolId:'school-a',capabilities:{lineAccount:true,feeCollections:true}}:bound}}};
 const feeSource=readFileSync(new URL('../app/fee-collections.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('if(!legacyLineEntry)load();','this.standaloneLoad=load;');
 runInNewContext(source+'\n'+feeSource,scope);await scope.standaloneLoad();
 assert.deepEqual(calls,['/api/me','/api/line/school-account']);assert.match(elements.lineBinding.textContent,/已連結 測試家長/);assert.equal(elements.status.hidden,true);assert.equal(elements.roleTitle.textContent,'LINE 通知設定');
});
