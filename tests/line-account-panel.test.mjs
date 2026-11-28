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
function fixture({line=bound,role='admin',capability=true,returnTo='account',onChanged=async()=>{},apiOverride,google=false,token='token-a',roleContext='schoolAdmin'}={}){
 const host=new Element();host.connected=true;const calls=[],navigation=[],changes=[],storage=new Map([['school_context_id','school-a'],['role_context',roleContext],['google_id_token',token]]);let current={...line},confirmed=true,googleConfig;
 const me={role,authProvider:line.authProvider,identityId:'teacher-sub',email:'teacher@example.test',schoolId:'school-a',capabilities:{lineAccount:capability}};
 const events={},documentEvents={};
 const document={head:new Element('head'),visibilityState:'visible',createElement:tag=>new Element(tag),addEventListener:(type,fn)=>documentEvents[type]=fn,removeEventListener:(type,fn)=>{if(documentEvents[type]===fn)delete documentEvents[type]}};document.head.connected=true;
 const window={addEventListener:(type,fn)=>events[type]=fn,removeEventListener:(type,fn)=>{if(events[type]===fn)delete events[type]},confirm:()=>confirmed,...(google?{google:{accounts:{id:{initialize:config=>{googleConfig=config},renderButton:node=>node.append(new Element('google-button'))}}}}:{})};
 const factory=runInNewContext(source+';createLineAccountPanel',{window,document,sessionStorage:{getItem:key=>storage.get(key)||''},location:{assign:url=>navigation.push(url)},navigator:{userAgent:'Test Chrome'},URL,Set,Promise});
 const api=async(path,options)=>{
  const body=options?.body?JSON.parse(options.body):undefined;calls.push({path,method:options?.method||'GET',body,...(path==='/api/me'?{options}:{})});
  if(apiOverride){const response=await apiOverride(path,options,body);if(response!==undefined)return response}
  if(path==='/api/config')return {googleClientId:'google-client'};
  if(path==='/api/me')return {...me,authProvider:'google'};
  if(path.includes('/tenant-login/'))return {url:'https://access.line.me/oauth2/v2.1/authorize?state=test'};
  if(!options?.method||options.method==='GET')return {...current};
  if(options.method==='DELETE'){current={...unbound};return {configured:true,bound:false}}
  if(body?.credential){current={...current,pendingLink:{confirmationId:'confirm-id',googleEmail:'parent@example.test',lineDisplayName:'LINE 家長'}};return {...current}}
  if(body?.action==='sync-menu')return {audience:'staff',chatActionsVerified:true,areaCount:6};
  if(body?.action==='confirm-link')current={...bound};
  if(body?.action==='cancel-link')current={...unbound};
  return {...current};
 };
 const panel=factory({host,api,me,returnTo,navigate:url=>navigation.push(url),onChanged:async change=>{changes.push(change.action);await onChanged(change)}});
 const button=text=>nodes(host).find(n=>n.tag==='button'&&n.ownText===text);
 return {host,panel,me,calls,navigation,changes,storage,events,documentEvents,document,button,click:async text=>{const node=button(text);assert.ok(node,'button '+text);return node.handlers.click()},setConfirmed:value=>confirmed=value,googleConfig:()=>googleConfig,setLine:value=>current=value};
}
test('personal binding construction does no work and authorized entry reads only its own account',async()=>{
 for(const role of ['admin','parent','privateTeacher']){
  const h=fixture({role});assert.equal(h.calls.length,0);await h.panel.load();
  assert.deepEqual(h.calls,[{path:'/api/line/school-account',method:'GET',body:undefined}]);
  assert.match(h.host.textContent,/已連結 測試家長/);assert.doesNotMatch(h.host.textContent,/收費|帳戶範本/);
 }
});
test('same-school Gmail account binding is shared across roles while school rights remain separate',async()=>{
 for(const role of ['admin','parent','privateTeacher']){
  const h=fixture({role});await h.panel.load();
  assert.match(h.host.textContent,/同一學校、同一個 Gmail 的 LINE 綁定可在管理員、老師與家長身分間共用/);
  assert.match(h.host.textContent,/不需各自重綁.*權限仍依學校名冊與核准的學生關係判定/);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'GET');assert.equal(h.changes.length,0);
 }
});
test('an unsupported role or missing account capability cannot start account requests or mutations',async()=>{
 for(const options of [{role:'teacherUnknown'},{capability:false}]){const h=fixture(options);await h.panel.load();assert.equal(h.calls.length,0);assert.match(h.host.textContent,/尚未開啟|已授權的身分/);assert.equal(h.button('使用 LINE 授權並綁定'),undefined)}
});
test('OAuth starts only on action and requests the fixed notification-center destination when selected',async()=>{
 for(const returnTo of ['account','notification-center','teacher-account','parent-account']){
  const h=fixture({line:unbound,returnTo,role:returnTo==='teacher-account'?'teacher':returnTo==='parent-account'?'parent':'admin'});await h.panel.load();await h.click('使用 LINE 授權並綁定');
  const call=h.calls.find(x=>x.method==='POST');assert.equal(call.path,'/api/line/tenant-login/school-a/start');
  assert.deepEqual(call.body,returnTo!=='account'?{mode:'link',returnTo}:{mode:'link'});
  assert.deepEqual(h.navigation,['https://access.line.me/oauth2/v2.1/authorize?state=test']);
 }
});
test('an invalid authorization URL never navigates away from the verified application',async()=>{
 for(const url of ['https://evil.test/','https://user:password@access.line.me/oauth2/v2.1/authorize','https://user@access.line.me/oauth2/v2.1/authorize']){
  const h=fixture({line:unbound,apiOverride:path=>path.includes('/tenant-login/')?{url}:undefined});await h.panel.load();await h.click('使用 LINE 授權並綁定');assert.equal(h.navigation.length,0);assert.match(h.host.textContent,/授權網址不正確/);
 }
});
test('bound accounts show the saved official friendship result and time separately from account linking',async()=>{
 for(const [friendStatus,label] of [['friend','已確認為好友'],['not_friend','需確認好友狀態'],['unknown','尚未取得確認結果']]){
  const h=fixture({line:{...bound,friendStatus,friendCheckedAt:Date.parse('2026-11-25T01:20:00Z')}});await h.panel.load();
  assert.match(h.host.textContent,/已連結 測試家長/);assert.ok(h.host.textContent.includes('本校官方帳號好友：'+label));assert.match(h.host.textContent,/最後確認時間：2026/);
  assert.match(h.host.textContent,/帳號綁定與平台身分核准是不同項目/);assert.ok(h.button('重新確認好友'));assert.equal(h.calls.every(call=>call.method==='GET'),true);
 }
 const empty=fixture({line:{...bound,friendStatus:'unknown',friendCheckedAt:null}});await empty.panel.load();assert.match(empty.host.textContent,/尚無好友確認時間/);
});
test('friendship recheck starts only for a bound account and preserves Gmail role returns without relinking',async()=>{
 for(const returnTo of ['account','notification-center','teacher-account','parent-account']){
  const h=fixture({line:bound,returnTo,role:returnTo==='teacher-account'?'teacher':returnTo==='parent-account'?'parent':'admin'});await h.panel.load();const before=[...h.storage];await h.click('重新確認好友');
  assert.deepEqual(h.calls.map(call=>call.method),['teacher-account','parent-account','notification-center'].includes(returnTo)?['GET','POST','GET']:['GET','POST']);assert.equal(h.calls[1].path,'/api/line/tenant-login/school-a/start');
  assert.deepEqual(h.calls[1].body,returnTo==='account'?{mode:'friendship'}:{mode:'friendship',returnTo});assert.deepEqual([...h.storage],before);
  assert.equal(h.button('確認綁定'),undefined);assert.deepEqual(h.changes,[]);assert.equal(h.navigation.length,1);
 }
 for(const line of [unbound,{...unbound,pendingLink:{confirmationId:'pending'}}]){const h=fixture({line});await h.panel.load();assert.equal(h.button('重新確認好友'),undefined)}
});
test('a LINE-origin friendship recheck never requests a Gmail role return or changes its original identity',async()=>{
 const h=fixture({line:{...bound,authProvider:'line'},returnTo:'parent-account',role:'parent',token:'line-session',roleContext:'parent'});await h.panel.load();
 const identity=[...h.storage];await h.click('重新確認好友');assert.deepEqual(h.calls.at(-1).body,{mode:'friendship'});assert.deepEqual([...h.storage],identity);assert.equal(h.button('解除 LINE 綁定'),undefined);
});
test('a checked callback only displays the authenticated GET friendship result and cannot promote a stored nonfriend',async()=>{
 for(const friendStatus of ['friend','not_friend','unknown']){
  const h=fixture({line:{...bound,friendStatus}});await h.panel.load(new URLSearchParams('line_friend=checked'));
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'GET');assert.equal(h.button('確認綁定'),undefined);
  assert.match(h.host.textContent,friendStatus==='friend'?/您是本校官方帳號好友/:friendStatus==='not_friend'?/目前未確認為本校官方帳號好友/:/尚未取得可確認的好友結果/);
  if(friendStatus!=='friend')assert.doesNotMatch(h.host.textContent,/您是本校官方帳號好友|本校官方帳號好友：已確認為好友/);
 }
});
test('friendship mismatch and unavailable callbacks preserve the existing pair without requiring confirmation',async()=>{
 for(const result of ['mismatch','unavailable']){
  const h=fixture({line:{...bound,friendStatus:'friend'}});await h.panel.load(new URLSearchParams('line_friend='+result));
  assert.match(h.host.textContent,result==='mismatch'?/與原綁定帳號不同/:/未能取得官方帳號好友狀態/);assert.match(h.host.textContent,/已連結 測試家長/);assert.ok(h.button('重新確認好友'));assert.equal(h.button('確認綁定'),undefined);
  await h.click('更新綁定狀態');assert.equal(h.calls.every(call=>call.method==='GET'),true);assert.deepEqual(h.changes,[]);
 }
 const invalid=fixture();await invalid.panel.load(new URLSearchParams('line_friend=friend'));assert.doesNotMatch(invalid.host.textContent,/已更新好友確認紀錄/);
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
test('bound teachers can retry automatic menu sync without receiving an additional role grant',async()=>{
 for(const role of ['teacher','sectionTeacher','ensembleTeacher','comprehensiveTeacher','privateTeacher']){
  const h=fixture({role});await h.panel.load();assert.match(h.host.textContent,/依同校身分自動判定/);assert.match(h.host.textContent,/尚未綁定平台為預設三宮格/);assert.match(h.host.textContent,/已核准家長啟用 Facebook 後為五格/);assert.match(h.host.textContent,/老師為六宮格/);
  assert.equal(h.calls.some(call=>call.method!=='GET'),false);
  await h.click('同步我的 LINE 選單');assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.deepEqual(h.calls.at(-1).body,{action:'sync-menu'});
 }
});
test('confirmation keeps binding success separate from automatic menu sync success or a retryable pending result',async()=>{
 for(const menuSync of [{status:'synced',audience:'staff'},{status:'synced',audience:'parent',areaCount:5},{status:'synced',audience:'default'},{status:'pending',message:'選單服務暫時忙碌，可稍後重試。'}]){
  let h;h=fixture({line:{...unbound,pendingLink:{confirmationId:'confirmation',googleEmail:'admin@example.test'}},apiOverride:(_path,_options,body)=>{
   if(body?.action==='confirm-link'){h.setLine(bound);return {...bound,menuSync}}
  }});
  await h.panel.load();await h.click('確認綁定');
  assert.match(h.host.textContent,/已完成此校 Gmail 與 LINE 綁定/);assert.ok(h.button('同步我的 LINE 選單'));assert.ok(h.button('解除 LINE 綁定'));
  assert.doesNotMatch(h.host.textContent,/操作未完成|重新授權|重新綁定/);
  if(menuSync.status==='pending')assert.match(h.host.textContent,/帳號綁定已完成，選單尚未同步。選單服務暫時忙碌/);
  else assert.match(h.host.textContent,menuSync.audience==='parent'?/依核准家長身分自動啟用五格選單/:menuSync.audience==='staff'?/依同校幹部與老師名冊自動套用六宮格/:/目前使用預設三宮格；學生資料須完成家長／學生核准後開放/);
 }
});
test('parents and unassigned accounts have no manual sync step and entry or status viewing remains read-only',async()=>{
 for(const role of ['parent','unassigned']){
  const h=fixture({role});await h.panel.load();
  assert.equal(h.button('同步我的 LINE 選單'),undefined);
  assert.match(h.host.textContent,/自動啟用家長選單，不需另外同步/);
  assert.doesNotMatch(h.host.textContent,/可重試同步|手動更新|更新綁定狀態/);
  await h.click('查看綁定狀態');
  assert.equal(h.calls.length,2);assert.equal(h.calls.every(call=>call.method==='GET'),true);
 }
});

test('parent confirmation automatically reports five entries and never asks for a sync click when menu delivery is pending',async()=>{
 for(const status of ['synced','pending']){
  let h;h=fixture({role:'parent',line:{...unbound,pendingLink:{confirmationId:'confirmation',googleEmail:'parent@example.test'}},apiOverride:(_path,_options,body)=>{
   if(body?.action==='confirm-link'){h.setLine(bound);return {...bound,menuSync:{status,audience:'parent',areaCount:5,message:'請按同步我的 LINE 選單後重新綁定'}}}
  }});
  await h.panel.load(new URLSearchParams('line_link=confirm'));assert.ok(h.button('確認綁定'));
  await h.click('確認綁定');
  assert.match(h.host.textContent,/已完成此校 Gmail 與 LINE 綁定/);
  assert.equal(h.button('同步我的 LINE 選單'),undefined);assert.ok(h.button('解除 LINE 綁定'));
  assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
  assert.doesNotMatch(h.host.textContent,/重新綁定|請按同步|更新綁定狀態/);
  assert.match(h.host.textContent,status==='synced'?/自動啟用五格選單/:/家長選單由系統自動處理.*學校管理員/);
 }
});

test('a legacy parent template is not described as five entries without the server count',async()=>{
 for(const areaCount of [undefined,4]){
  let h;h=fixture({role:'parent',line:{...unbound,pendingLink:{confirmationId:'confirmation',googleEmail:'parent@example.test'}},apiOverride:(_path,_options,body)=>{
   if(body?.action==='confirm-link'){h.setLine(bound);return {...bound,menuSync:{status:'synced',audience:'parent',areaCount}}}
  }});
  await h.panel.load();await h.click('確認綁定');
  assert.match(h.host.textContent,/依核准家長身分自動套用家長選單/);
  assert.doesNotMatch(h.host.textContent,/自動啟用五格選單/);assert.equal(h.button('同步我的 LINE 選單'),undefined);
 }
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

test('returning to the page after an initiated authorization automatically reads the pending pair without confirming it',async()=>{
 const h=fixture({line:unbound});await h.panel.load();h.events.focus();await new Promise(setImmediate);assert.equal(h.calls.length,1);
 await h.click('使用 LINE 授權並綁定');
 h.setLine({...unbound,pendingLink:{confirmationId:'returned-pair',googleEmail:'parent@example.test',lineDisplayName:'授權後 LINE'}});
 h.events.focus();await new Promise(setImmediate);
 assert.equal(h.calls.filter(call=>call.method==='GET').length,2);assert.match(h.host.textContent,/授權後 LINE/);assert.ok(h.button('確認綁定'));
 assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(h.calls.some(call=>call.body?.action==='confirm-link'),false);
 h.events.focus();await new Promise(setImmediate);assert.equal(h.calls.filter(call=>call.method==='GET').length,2,'a resolved return must not keep refreshing');
});

test('authorization return refresh skips hidden panels and is removed or rejected after identity changes',async()=>{
 const h=fixture({line:unbound});await h.panel.load();await h.click('使用 LINE 授權並綁定');
 h.document.visibilityState='hidden';h.documentEvents.visibilitychange();await new Promise(setImmediate);assert.equal(h.calls.length,2);
 h.document.visibilityState='visible';h.storage.set('school_context_id','school-b');h.documentEvents.visibilitychange();await new Promise(setImmediate);
 assert.equal(h.calls.length,2);assert.match(h.host.textContent,/身分已變更/);
 h.panel.destroy();assert.equal(h.events.focus,undefined);assert.equal(h.documentEvents.visibilitychange,undefined);
});

test('status refresh preserves the real failed authorization, including when an older binding still exists',async()=>{
 for(const line of [unbound,bound])for(const error of ['verification','configuration','authorization','conflict']){
  const h=fixture({line});await h.panel.load(new URLSearchParams('line_error='+error));
  const first=h.host.textContent;assert.match(first,error==='configuration'?/登入設定未通過/:error==='authorization'?/授權已逾時/:error==='conflict'?/已有其他綁定/:/授權未完成/);
  await h.click('更新綁定狀態');assert.equal(h.host.textContent,first);assert.equal(h.calls.every(call=>call.method==='GET'),true);assert.doesNotMatch(h.host.textContent,/已完成此校 Gmail 與 LINE 綁定/);
 }
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

test('the embedded teacher account reads the pending Gmail pair, confirms explicitly and returns OAuth through the teacher workspace',async()=>{
 const elements=Object.fromEntries(['siteName','roleTitle','roleIntro','status','lineBinding'].map(id=>{const node=new Element();node.connected=true;return [id,node]}));
 const calls=[],messages=[],navigation=[],storage=new Map([['school_context_id','school-a'],['role_context','teacher'],['google_id_token','teacher-google-token']]);
 let account={...unbound,pendingLink:{confirmationId:'teacher-confirm',googleEmail:'teacher@example.test',lineDisplayName:'Wen'}};
 const profile={authProvider:'google',role:'teacher',schoolId:'school-a',identityId:'teacher-sub',email:'teacher@example.test',capabilities:{lineAccount:true}};
 const scope={document:{body:{classList:{add(){}}},documentElement:{hasAttribute:()=>true},getElementById:id=>elements[id]||null,createElement:tag=>new Element(tag),addEventListener(){}},
  window:{addEventListener(){},parent:{postMessage:(data,origin)=>messages.push({data,origin}),location:{assign:url=>navigation.push(url)}}},
  location:{origin:'https://school-a.example.test',hash:'',search:'?embedded=teacher&schoolId=school-a&line_link=confirm',pathname:'/line-account.html'},history:{replaceState(){}},
  sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},URLSearchParams,URL,navigator:{userAgent:'Test'},console,
  fetch:async(url,options)=>{const body=options.body&&JSON.parse(options.body);calls.push({url,method:options.method||'GET',body});
   if(body?.action==='confirm-link'){account={...bound,lineDisplayName:'Wen'};return {ok:true,json:async()=>({...account,menuSync:{status:'synced',audience:'staff',areaCount:6}})}}
   return {ok:true,json:async()=>url==='/api/me'?profile:url.includes('/tenant-login/')?{url:'https://access.line.me/oauth2/v2.1/authorize?state=teacher'}:account};
  }};
 const feeSource=readFileSync(new URL('../app/fee-collections.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('if(!legacyLineEntry)load();','this.standaloneLoad=load;');
 runInNewContext(source+'\n'+feeSource,scope);await scope.standaloneLoad();
 assert.deepEqual(calls.map(call=>call.url),['/api/me','/api/line/school-account']);assert.equal(calls.every(call=>call.method==='GET'),true);
 assert.match(elements.lineBinding.textContent,/teacher@example.test/);assert.match(elements.lineBinding.textContent,/Wen/);assert.doesNotMatch(elements.lineBinding.textContent,/學生姓名|學號|送出綁定申請/);
 await nodes(elements.lineBinding).find(node=>node.ownText==='確認綁定').handlers.click();
 assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(calls.find(call=>call.method==='POST').body.action,'confirm-link');
 assert.match(elements.lineBinding.textContent,/已完成此校 Gmail 與 LINE 綁定/);assert.equal(messages[0].data.type,'teacher-line-account-changed');
 assert.equal(messages[0].origin,scope.location.origin);assert.equal(calls.some(call=>/projects|templates/.test(call.url)),false);
 account=unbound;await scope.standaloneLoad();await nodes(elements.lineBinding).find(node=>node.ownText==='使用 LINE 授權並綁定').handlers.click();
 assert.deepEqual(calls.findLast(call=>call.url.includes('/tenant-login/')).body,{mode:'link',returnTo:'teacher-account'});assert.equal(calls.at(-1).url,'/api/me');assert.equal(storage.get('teacher_line_account_return'),'school-a');assert.equal(navigation.length,1);
});

function standaloneFixture({parentReturn=false}={}){
 const elements=Object.fromEntries(['siteName','roleTitle','roleIntro','status','lineBinding'].map(id=>{const node=new Element();node.connected=true;return [id,node]}));
 const events={},calls=[],navigation=[],storage=new Map([['school_context_id','school-a'],['role_context','parent'],['google_id_token','token-a']]);
 let account={...unbound},profile={authProvider:'google',role:'parent',schoolId:'school-a',identityId:'parent-sub',email:'parent@example.test',systemName:'甲校',capabilities:{lineAccount:true}},override;
 const scope={document:{documentElement:{hasAttribute:()=>true},visibilityState:'visible',getElementById:id=>elements[id]||null,createElement:tag=>new Element(tag),addEventListener(){}},window:{addEventListener:(type,fn)=>events[type]=fn,removeEventListener:(type,fn)=>{if(events[type]===fn)delete events[type]}},location:{hash:'',search:parentReturn?'?parentLineAccount=school-a&line_link=confirm':'',pathname:'/line-account.html',assign:url=>navigation.push(url)},history:{replaceState(){}},sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},URLSearchParams,URL,navigator:{userAgent:'Test'},console,
  fetch:async(url,options)=>{calls.push({url,method:options?.method||'GET'});const custom=await override?.(url,options);return {ok:true,json:async()=>custom??(url==='/api/me'?profile:account)}}};
 const feeSource=readFileSync(new URL('../app/fee-collections.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('if(!legacyLineEntry)load();','this.standaloneLoad=load;');
 runInNewContext(source+'\n'+feeSource,scope);
 return {scope,elements,events,calls,storage,navigation,setLine:value=>account=value,setProfile:value=>profile=value,setOverride:value=>override=value};
}

test('an approved Gmail parent return needs only explicit LINE confirmation and automatically applies five entries',async()=>{
 const h=standaloneFixture({parentReturn:true});
 h.setLine({...unbound,pendingLink:{confirmationId:'parent-pair',googleEmail:'parent@example.test',lineDisplayName:'家長 LINE'}});
 h.setOverride(async(_url,options)=>{
  if(options.body&&JSON.parse(options.body).action==='confirm-link'){
   h.setLine(bound);return {...bound,menuSync:{status:'synced',audience:'parent',areaCount:5}};
  }
 });
 await h.scope.standaloneLoad();
 assert.deepEqual(h.calls.map(call=>call.url),['/api/me','/api/line/school-account']);assert.equal(h.calls.every(call=>call.method==='GET'),true);
 assert.match(h.elements.lineBinding.textContent,/parent@example.test/);assert.match(h.elements.lineBinding.textContent,/確認綁定/);
 assert.equal(nodes(h.elements.lineBinding).some(node=>node.tag==='input'),false);
 assert.equal(h.storage.has('parent_line_account_return'),false);
 await nodes(h.elements.lineBinding).find(node=>node.ownText==='確認綁定').handlers.click();
 assert.match(h.elements.lineBinding.textContent,/已沿用原 Gmail 核准的學生關係/);assert.match(h.elements.lineBinding.textContent,/自動啟用五格選單/);
 assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
 assert.equal(h.calls.some(call=>/student-registration|student-master|parent-links/.test(call.url)),false);
 assert.equal(nodes(h.elements.lineBinding).some(node=>node.ownText==='同步我的 LINE 選單'),false);
});

test('the parent account return refuses a stale LINE or unapproved Gmail identity before reading any account or student details',async()=>{
 for(const profile of [{authProvider:'line',role:'unassigned',schoolId:'school-a'},{authProvider:'google',role:'unassigned',schoolId:'school-a'},{authProvider:'google',role:'parent',schoolId:'school-b'}]){
  const h=standaloneFixture({parentReturn:true});h.setProfile(profile);await h.scope.standaloneLoad();
  assert.deepEqual(h.calls.map(call=>call.url),['/api/me']);assert.match(h.elements.status.textContent,/原 Gmail/);
  assert.match(h.elements.status.textContent,/不需重新填寫學生資料/);assert.equal(h.elements.lineBinding.textContent,'');
  assert.equal(h.storage.get('parent_line_account_return'),'school-a');
 }
});

test('a Gmail parent starts the dedicated parent OAuth path without requesting student identifiers',async()=>{
 const h=standaloneFixture({parentReturn:true});await h.scope.standaloneLoad();
 assert.match(h.elements.lineBinding.textContent,/不需再輸入學生姓名或學號/);
 h.setOverride(async(url,options)=>{if(!url.includes('/tenant-login/'))return;assert.deepEqual(JSON.parse(options.body),{mode:'link',returnTo:'parent-account'});return {url:'https://access.line.me/oauth2/v2.1/authorize?state=parent'}});
 await nodes(h.elements.lineBinding).find(node=>node.ownText==='使用 LINE 授權並綁定').handlers.click();
 assert.equal(h.navigation.length,1);assert.equal(h.storage.get('parent_line_account_return'),'school-a');
 assert.equal(h.calls.at(-2).url,'/api/line/tenant-login/school-a/start');
 assert.equal(h.calls.at(-1).url,'/api/me');
});

test('the real LINE-origin account page rechecks friendship without writing Gmail return hints or changing its session',async()=>{
 const h=standaloneFixture();h.scope.location.search='?schoolId=school-a&line_friend=checked';h.storage.set('google_id_token','line-session');
 h.setProfile({authProvider:'line',role:'parent',schoolId:'school-a',systemName:'甲校',capabilities:{lineAccount:true}});h.setLine({...bound,authProvider:'line',friendStatus:'friend',friendCheckedAt:Date.parse('2026-11-25T01:20:00Z')});
 const before=[...h.storage];await h.scope.standaloneLoad();assert.match(h.elements.lineBinding.textContent,/您是本校官方帳號好友/);assert.equal(h.calls.every(call=>call.method==='GET'),true);
 h.setOverride(async(url,options)=>{if(url.includes('/tenant-login/')){assert.deepEqual(JSON.parse(options.body),{mode:'friendship'});return {url:'https://access.line.me/oauth2/v2.1/authorize?state=friend'}}});
 await nodes(h.elements.lineBinding).find(node=>node.ownText==='重新確認好友').handlers.click();
 assert.deepEqual([...h.storage],before);assert.equal(h.storage.has('parent_line_account_return'),false);assert.equal(h.storage.has('teacher_line_account_return'),false);assert.equal(h.navigation.length,1);
 assert.equal(h.calls.some(call=>/student-registration|student-master|parent-links/.test(call.url)),false);
});

test('the standalone account page automatically fetches a returned pending pair after BFCache restore without linking it',async()=>{
 const h=standaloneFixture();await h.scope.standaloneLoad();assert.match(h.elements.lineBinding.textContent,/使用 LINE 授權並綁定/);
 h.events.pagehide();assert.equal(h.elements.lineBinding.textContent,'');
 h.setLine({...unbound,pendingLink:{confirmationId:'latest-pair',googleEmail:'parent@example.test',lineDisplayName:'返回後的 LINE'}});
 h.events.pageshow({persisted:true});await new Promise(setImmediate);
 assert.deepEqual(h.calls.map(call=>call.url),['/api/me','/api/line/school-account','/api/me','/api/line/school-account']);
 assert.match(h.elements.lineBinding.textContent,/返回後的 LINE/);assert.match(h.elements.lineBinding.textContent,/確認綁定/);assert.equal(h.calls.every(call=>call.method==='GET'),true);
});

test('a stale standalone profile response cannot overwrite the restored account in a new school',async()=>{
 const h=standaloneFixture();let resolve;const old=new Promise(done=>resolve=done);let first=true;
 h.setOverride(async url=>{if(url==='/api/me'&&first){first=false;return old}});
 const pending=h.scope.standaloneLoad();h.events.pagehide();h.storage.set('school_context_id','school-b');h.storage.set('google_id_token','token-b');
 h.setProfile({role:'parent',schoolId:'school-b',systemName:'乙校',capabilities:{lineAccount:true}});h.setLine({...bound,lineDisplayName:'乙校 LINE'});
 h.events.pageshow({persisted:true});await new Promise(setImmediate);
 assert.equal(h.elements.siteName.textContent,'乙校');assert.match(h.elements.lineBinding.textContent,/乙校 LINE/);
 resolve({role:'parent',schoolId:'school-a',systemName:'過期甲校',capabilities:{lineAccount:true}});await pending;
 assert.equal(h.elements.siteName.textContent,'乙校');assert.doesNotMatch(h.elements.lineBinding.textContent,/過期甲校/);assert.equal(h.calls.filter(call=>call.url==='/api/line/school-account').length,1);
});

test('teacher Gmail link and friendship starts prove the exact saved cookie before navigating',async()=>{
 for(const line of [unbound,bound]){
  const h=fixture({line,role:'teacher',returnTo:'teacher-account',roleContext:'teacher'});await h.panel.load();
  await h.click(line.bound?'重新確認好友':'使用 LINE 授權並綁定');
  assert.equal(h.navigation.length,1);const check=h.calls.find(call=>call.path==='/api/me');assert.ok(check);assert.equal(check.method,'GET');assert.equal(check.options.credentials,'same-origin');assert.equal(check.options.cache,'no-store');
  assert.deepEqual({...check.options.headers},{'X-Google-ID-Token':'cookie-session','X-School-Id':'school-a','X-Role-Context':'teacher'});
  assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.match(h.host.textContent,/首次綁定返回後/);
 }
});

test('teacher panel preflight failures preserve visible binding and never switch account or navigate',async()=>{
 const teacher={authProvider:'google',role:'teacher',schoolId:'school-a',identityId:'teacher-sub',email:'teacher@example.test'};
 const variants=[null,{...teacher,authProvider:'line'},{...teacher,identityId:'other-sub'},{...teacher,email:'other@example.test'},{...teacher,schoolId:'school-b'},{...teacher,role:'parent'},{...teacher,role:'contextDenied'},()=>{throw Error('401 SECRET')},()=>{throw Error('network SECRET')}];
 for(const profile of variants){
  const h=fixture({line:unbound,role:'teacher',returnTo:'teacher-account',roleContext:'teacher',apiOverride:path=>path==='/api/me'?(typeof profile==='function'?profile():profile):undefined});await h.panel.load();const before=[...h.storage];
  await h.click('使用 LINE 授權並綁定');assert.equal(h.navigation.length,0);assert.deepEqual([...h.storage],before);assert.equal(h.changes.length,0);
  assert.match(h.host.textContent,/未能保留這個 Gmail/);assert.match(h.host.textContent,/同一個 Safari 或 Chrome/);assert.match(h.host.textContent,/連結自己的 LINE/);assert.doesNotMatch(h.host.textContent,/SECRET/);assert.ok(h.button('使用 LINE 授權並綁定'));
 }
});

test('teacher panel rejects a late cookie proof after context change, profile change or destruction',async()=>{
 for(const change of [h=>h.storage.set('school_context_id','school-b'),h=>h.storage.set('google_id_token','new-token'),h=>h.me.identityId='another-sub',h=>h.me.email='another@example.test',h=>h.me.role='parent',h=>h.panel.destroy()]){
  let release;const h=fixture({line:unbound,role:'teacher',returnTo:'teacher-account',roleContext:'teacher',apiOverride:path=>path==='/api/me'?new Promise(resolve=>release=resolve):undefined});
  await h.panel.load();const action=h.click('使用 LINE 授權並綁定');await new Promise(setImmediate);assert.equal(typeof release,'function');change(h);release({authProvider:'google',role:'teacher',schoolId:'school-a',identityId:'teacher-sub',email:'teacher@example.test'});await action;
  assert.equal(h.navigation.length,0);assert.equal(h.changes.length,0);
 }
});

test('verified browser preflight does not alter unrelated entry or LINE-origin friendship',async()=>{
 for(const options of [{line:unbound,role:'parent',returnTo:'account'},{line:unbound,role:'admin',returnTo:'account'},{line:{...bound,authProvider:'line'},role:'teacher',returnTo:'teacher-account'}]){
  const h=fixture(options);await h.panel.load();await h.click(options.line.bound?'重新確認好友':'使用 LINE 授權並綁定');assert.equal(h.navigation.length,1);assert.equal(h.calls.some(call=>call.path==='/api/me'),false);
 }
});

test('the Gmail parent browser check keeps the approved role and blocks a different identity before navigating',async()=>{
 const h=fixture({line:unbound,role:'parent',returnTo:'parent-account',roleContext:'parent'});
 await h.panel.load();await h.click('使用 LINE 授權並綁定');
 assert.equal(h.calls.at(-1).options.headers['X-Role-Context'],'parent');assert.equal(h.calls.at(-1).options.headers['X-Google-ID-Token'],'cookie-session');assert.equal(h.navigation.length,1);assert.deepEqual(h.changes,[]);
 const denied=fixture({line:unbound,role:'parent',returnTo:'parent-account',roleContext:'parent',apiOverride:path=>path==='/api/me'?{role:'parent',authProvider:'google',schoolId:'school-a',identityId:'another-sub'}:undefined});
 await denied.panel.load();await denied.click('使用 LINE 授權並綁定');
 assert.equal(denied.navigation.length,0);assert.match(denied.host.textContent,/未能保留這個 Gmail/);assert.deepEqual(denied.changes,[]);
});

test('admin Gmail binding requires verified same-school browser proof before starting navigation',async()=>{
 const h=fixture({role:'admin',line:unbound,returnTo:'notification-center'});
 await h.panel.load();await h.click('使用 LINE 授權並綁定');
 assert.equal(h.navigation.length,1);const proof=h.calls.at(-1);assert.equal(proof.path,'/api/me');assert.equal(proof.options.requireBrowserGoogleSession,true);assert.equal(proof.options.headers['X-Role-Context'],'schoolAdmin');
 const bad=fixture({role:'admin',line:unbound,returnTo:'notification-center',apiOverride:path=>path==='/api/me'?{role:'admin',authProvider:'google',schoolId:'wrong-school'}:undefined});
 await bad.panel.load();await bad.click('使用 LINE 授權並綁定');assert.equal(bad.navigation.length,0);assert.match(bad.host.textContent,/未能保留這個 Gmail/);
});
