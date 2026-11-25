import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../app/parent-line-friend-prompt.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app/app-v3.js',import.meta.url),'utf8');
const keySource=app.slice(app.indexOf('function parentLineBindingKey(){'),app.indexOf('async function refreshParentLineBindingStatus(){'));
const settle=()=>new Promise(setImmediate);
const oauthUrl='https://access.line.me/oauth2/v2.1/authorize?state=verified-state';
class Element{
 constructor(document,tag){this.document=document;this.tag=tag;this.children=[];this.parentNode=null;this.ownText='';this.listeners={};this.attributes={};this.open=false;this.disabled=false}
 get isConnected(){return this===this.document.body||this.parentNode?.isConnected===true}
 set textContent(value){this.ownText=String(value);this.children=[]}get textContent(){return this.ownText+this.children.map(node=>node.textContent).join('')}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node)}}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null}
 setAttribute(name,value){this.attributes[name]=String(value)}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
 async fire(type){for(const fn of this.listeners[type]||[])await fn({type,target:this})}
 showModal(){this.open=true;if(this.className==='parent-line-friend-dialog')this.document.promptShows++}
 close(){if(!this.open)return;this.open=false;const emit=()=>{this.document.dispatch('close',{type:'close',target:this});for(const fn of this.listeners.close||[])fn({type:'close',target:this})};if(this.document.queuedClose)this.document.closeQueue.push(emit);else emit()}
}
const walk=node=>[node,...node.children.flatMap(walk)];
function fixture({friendStatus='not_friend',lineBound=true,bound=true,role='parent',capability=true,authProvider='google',epoch=1,page='home',bindingPending=false,ready=true,bootstrap=false,otherCount=0,apiOverride,storageValues=[],queuedClose=false}={}){
 const storage=new Map([['google_id_token',authProvider==='line'?'line-session':'google-token'],['school_context_id','school-a'],['role_context','parent'],...storageValues]);
 const requests=[],navigation=[],events={},documentEvents={},renders=[];
 const document={promptShows:0,queuedClose,closeQueue:[],createElement:tag=>new Element(document,tag),addEventListener(type,fn,capture){(documentEvents[type]??=[]).push({fn,capture})},dispatch(type,event){for(const {fn} of documentEvents[type]||[])fn(event)},querySelectorAll:selector=>selector==='dialog[open]'?walk(document.body).filter(node=>node.tag==='dialog'&&node.open):[]};
 document.body=new Element(document,'body');
 const state={token:storage.get('google_id_token'),parentLineFriendPromptEpoch:epoch,page,me:{identityId:'parent-a',email:'parent@example.test',schoolId:'school-a',authProvider,role,capabilities:{lineAccount:capability}},students:[{studentId:'student-a',name:'原核准學生'}],parentLineBinding:null};
 const window={__roleModulesReady:ready,__roleLoaderActive:!ready,__roleModuleBootstrap:bootstrap,addEventListener(type,fn){(events[type]??=[]).push(fn)}};
 const context={state,window,document,URL,Promise,Set,sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},location:{assign:url=>navigation.push(url)},render(){renders.push(state.page)},api:async(path,options)=>{requests.push({path,method:options?.method||'GET',body:options?.body?JSON.parse(options.body):undefined});context.apiRequestEpoch++;return apiOverride?apiOverride(path,options):{url:oauthUrl}},apiRequestEpoch:0};
 runInNewContext(keySource,context);
 const binding=changes=>({key:context.parentLineBindingKey(),bound,lineBound,friendStatus,authProvider,friendCheckedAt:1806000000000,...changes});
 if(!bindingPending)state.parentLineBinding=binding();
 const other=[];
 for(let index=0;index<otherCount;index++){const node=document.createElement('dialog');node.className='parent-task-dialog';document.body.append(node);node.showModal();other.push(node)}
 runInNewContext(source,context);
 const dialog=()=>walk(document.body).find(node=>node.className==='parent-line-friend-dialog'&&node.open);
 const button=label=>dialog()&&walk(dialog()).find(node=>node.tag==='button'&&node.textContent===label);
 return {context,state,window,document,storage,requests,navigation,renders,other,binding,dialog,button,flushCloses:()=>{while(document.closeQueue.length)document.closeQueue.shift()()},ready:()=>{window.__roleModulesReady=true;window.__roleLoaderActive=false;window.__roleModuleBootstrap=false;context.render()},event:type=>{for(const fn of events[type]||[])fn({type,persisted:true})},click:label=>{const node=button(label);assert.ok(node,'button '+label);return node.fire('click')},evaluate:()=>runInNewContext(source,context)};
}

test('only a bound parent on home with a recorded not-friend result sees the optional reminder, without automatic API calls',async()=>{
 for(const [friendStatus,expected] of [['friend',false],['unknown',false],['not_friend',true]]){
  const h=fixture({friendStatus});await settle();assert.equal(Boolean(h.dialog()),expected);assert.equal(h.requests.length,0);
  if(expected){assert.match(h.dialog().textContent,/依上次確認結果/);assert.match(h.dialog().textContent,/加入好友或解除封鎖/);assert.match(h.dialog().textContent,/學生資料不需重新綁定/);assert.ok(h.button('稍後再說'));}
 }
 for(const options of [{lineBound:false},{lineBound:undefined},{role:'admin'},{role:'privateTeacher'},{role:'unassigned'},{capability:false},{page:'practice'},{page:'record'}]){
  const h=fixture(options);if(Object.hasOwn(options,'lineBound')&&options.lineBound===undefined)h.state.parentLineBinding.lineBound=undefined;
  await settle();assert.equal(h.dialog(),undefined);assert.equal(h.requests.length,0);
 }
 const away=fixture({page:'record'});await settle();away.state.page='home';away.context.render();assert.ok(away.dialog());
});

test('a reminder waits for role modules and bootstrap completion without starting reads or redrawing the app',async()=>{
 for(const options of [{ready:false},{bootstrap:true}]){
  const h=fixture(options);await settle();assert.equal(h.dialog(),undefined);assert.equal(h.renders.length,0);assert.equal(h.requests.length,0);
  h.ready();assert.ok(h.dialog());assert.equal(h.renders.length,1);assert.equal(h.requests.length,0);
 }
});

test('the real initial student reads complete before the reminder can POST, and a later failed OAuth start cannot strand the home summary',async()=>{
 const h=fixture({bindingPending:true}),calls=[];h.state.student=h.state.students[0];h.state.summary=null;h.state.practice=[];
 let releaseSummary,releasePractice;
 const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
 h.context.fetch=async(url,options)=>{
  calls.push({url,method:options.method||'GET'});
  if(url.startsWith('/api/summary?'))return new Promise(resolve=>{releaseSummary=()=>resolve(response({today:'2026-11-25',practiceMinutes:15}))});
  if(url.startsWith('/api/practice?'))return new Promise(resolve=>{releasePractice=()=>resolve(response({items:[{practiceId:'practice-a',minutes:15}]}))});
  if(url==='/api/line/school-account')return response({configured:true,bound:true,friendStatus:'not_friend'});
  if(url==='/api/line/tenant-login/school-a/start')return response({error:'LINE 暫時忙碌'},503);
  throw Error('unexpected request '+url);
 };
 const apiSource=app.slice(app.indexOf('const pendingApiGets=new Map();'),app.indexOf('function logout('));
 const refreshSource=app.split('\n').find(line=>line.startsWith('async function refreshStudent(){'));
 runInNewContext(apiSource+'\n'+refreshSource,h.context);
 const studentRead=h.context.refreshStudent();
 const account=await h.context.api('/api/line/school-account');h.state.parentLineBinding=h.binding({lineBound:account.configured&&account.bound,friendStatus:account.friendStatus});
 h.context.render();await settle();assert.equal(h.dialog(),undefined);assert.equal(h.button('加入好友並確認'),undefined);assert.equal(h.state.summary,null);assert.equal(calls.length,3);assert.equal(calls.every(call=>call.method==='GET'),true);
 releaseSummary();releasePractice();await studentRead;h.context.render();
 assert.ok(h.dialog());assert.equal(h.state.summary.practiceMinutes,15);assert.equal(h.state.practice[0].practiceId,'practice-a');const summary=h.state.summary,scope=h.context.apiReadScope();
 await h.click('加入好友並確認');assert.notEqual(h.context.apiReadScope(),scope,'the actual API write epoch advances on the failed POST');
 assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(h.state.summary,summary);assert.equal(h.state.summary.today,'2026-11-25');assert.equal(h.state.practice.length,1);assert.ok(h.dialog());assert.match(h.dialog().textContent,/請稍後重試/);assert.equal(h.navigation.length,0);
});

test('a reported summary load error allows the optional reminder instead of waiting forever',async()=>{
 const h=fixture();h.state.student=h.state.students[0];h.state.summary=null;h.state.summaryLoadError='';await settle();
 assert.equal(h.dialog(),undefined);assert.equal(h.requests.length,0);assert.equal(h.document.promptShows,0);
 h.state.summaryLoadError='暫時無法讀取學習紀錄';h.context.render();assert.ok(h.dialog());assert.equal(h.requests.length,0);assert.equal(h.document.promptShows,1);
});

test('later, native Escape, BFCache and same-login profile resets do not reopen the reminder; a new login epoch may show it once',async()=>{
 for(const dismiss of ['later','escape','reset']){
  const h=fixture();await settle();const original=h.state.parentLineBinding,students=JSON.stringify(h.state.students);
  if(dismiss==='later')await h.click('稍後再說');else if(dismiss==='escape')await h.dialog().fire('cancel');else h.window.parentLineFriendPrompt.reset();
  assert.equal(h.dialog(),undefined);
  for(let index=0;index<4;index++)h.context.render();h.event('pageshow');h.window.parentLineFriendPrompt.reset();h.window.parentLineFriendPrompt.refresh();await settle();
  assert.equal(h.document.promptShows,1);assert.equal(h.requests.length,0);assert.equal(h.state.parentLineBinding,original);assert.equal(JSON.stringify(h.state.students),students);
  h.state.parentLineFriendPromptEpoch++;h.window.parentLineFriendPrompt.reset();h.window.parentLineFriendPrompt.refresh();assert.ok(h.dialog());assert.equal(h.document.promptShows,2);
  h.event('pagehide');h.event('pageshow');await settle();assert.equal(h.dialog(),undefined);assert.equal(h.document.promptShows,2);
 }
});

test('already open activity dialogs have priority, and their capture close events release the queued reminder only when all are closed',async()=>{
 const h=fixture({otherCount:2});await settle();assert.equal(h.dialog(),undefined);assert.equal(h.document.promptShows,0);
 h.other[0].close();await settle();assert.equal(h.dialog(),undefined);
 h.other[1].close();await settle();assert.ok(h.dialog());assert.equal(h.document.promptShows,1);assert.equal(h.requests.length,0);
 assert.equal(h.document.querySelectorAll('dialog[open]').length,1);
 h.evaluate();h.context.render();assert.equal(h.document.promptShows,1,'loading a module again does not install another reminder');
});

test('native queued close events stay observable by another modal queue before the reminder node is removed',async()=>{
 for(const action of ['later','escape','reset']){
  const h=fixture({queuedClose:true});await settle();const original=h.dialog(),activity=h.document.createElement('dialog');activity.className='parent-task-dialog';h.document.body.append(activity);
  let captured=0;h.document.addEventListener('close',event=>{if(event.target===original){captured++;assert.equal(original.isConnected,true);activity.showModal()}},true);
  if(action==='later')await h.click('稍後再說');else if(action==='escape')await original.fire('cancel');else h.window.parentLineFriendPrompt.reset();
  assert.equal(original.open,false);assert.equal(original.isConnected,true);assert.equal(captured,0);h.flushCloses();await settle();
  assert.equal(captured,1);assert.equal(original.isConnected,false);assert.equal(activity.open,true);assert.equal(h.document.querySelectorAll('dialog[open]').length,1);assert.equal(h.requests.length,0);
  activity.close();h.flushCloses();await settle();assert.equal(h.dialog(),undefined);assert.equal(h.document.promptShows,1);
 }
});

test('late binding reads may release the reminder, but stale keys from another school or account never do',async()=>{
 const h=fixture({bindingPending:true});await settle();assert.equal(h.dialog(),undefined);assert.equal(h.requests.length,0);
 const old=h.binding();h.state.me.schoolId='school-b';h.storage.set('school_context_id','school-b');h.state.parentLineBinding=old;h.context.render();assert.equal(h.dialog(),undefined);
 h.state.parentLineBinding=h.binding();h.state.me.identityId='parent-b';h.state.me.email='second@example.test';h.context.render();assert.equal(h.dialog(),undefined);
 h.state.parentLineBinding=h.binding();h.context.render();assert.ok(h.dialog());assert.equal(h.requests.length,0);
 const queued=fixture({otherCount:1});await settle();queued.state.parentLineBinding.friendStatus='friend';queued.other[0].close();await settle();assert.equal(queued.dialog(),undefined);
});

test('Google authorization preserves the existing session and students and only writes the intended parent return hint after a verified URL',async()=>{
 let release;const h=fixture({storageValues:[['teacher_line_account_return','old-teacher']],apiOverride:()=>new Promise(resolve=>{release=resolve})});await settle();
 const record=JSON.stringify(h.state.parentLineBinding),students=JSON.stringify(h.state.students),token=h.state.token,storedToken=h.storage.get('google_id_token');
 const action=h.click('加入好友並確認');assert.deepEqual(h.requests,[{path:'/api/line/tenant-login/school-a/start',method:'POST',body:{mode:'friendship',returnTo:'parent-account'}}]);
 assert.equal(h.storage.has('parent_line_account_return'),false);assert.equal(h.storage.get('teacher_line_account_return'),'old-teacher');assert.equal(h.button('加入好友並確認').disabled,true);
 release({url:oauthUrl});await action;
 assert.deepEqual(h.navigation,[oauthUrl]);assert.equal(h.storage.get('parent_line_account_return'),'school-a');assert.equal(h.storage.has('teacher_line_account_return'),false);
 assert.equal(h.state.token,token);assert.equal(h.storage.get('google_id_token'),storedToken);assert.equal(JSON.stringify(h.state.parentLineBinding),record);assert.equal(JSON.stringify(h.state.students),students);assert.equal(h.context.apiRequestEpoch,1);
});

test('LINE authorization omits the Google return marker and leaves all session and hint entries untouched',async()=>{
 const h=fixture({authProvider:'line',storageValues:[['teacher_line_account_return','existing-teacher'],['parent_line_account_return','existing-parent']]});await settle();const storage=[...h.storage],record=JSON.stringify(h.state.parentLineBinding),token=h.state.token;
 await h.click('加入好友並確認');assert.deepEqual(h.requests[0].body,{mode:'friendship'});assert.deepEqual([...h.storage],storage);assert.equal(h.state.token,token);assert.equal(JSON.stringify(h.state.parentLineBinding),record);assert.deepEqual(h.navigation,[oauthUrl]);
});

test('stale school, account, token, epoch, provider and friendship changes before clicking cannot authorize or navigate',async()=>{
 for(const change of [h=>{h.state.me.schoolId='school-b';h.storage.set('school_context_id','school-b')},h=>{h.state.me.identityId='another-parent'},h=>{h.state.token='new-token'},h=>{h.state.parentLineFriendPromptEpoch++},h=>{h.state.me.authProvider='line'},h=>{h.state.parentLineBinding.authProvider='line'},h=>{h.state.parentLineBinding.friendStatus='friend'},h=>{h.state.parentLineBinding.friendStatus='unknown'},h=>{h.state.parentLineBinding.lineBound=false},h=>{h.storage.set('role_context','schoolAdmin')}]){
  const h=fixture();await settle();const oldButton=h.button('加入好友並確認');change(h);await oldButton.fire('click');assert.equal(h.requests.length,0);assert.equal(h.navigation.length,0);assert.equal(h.dialog(),undefined);
 }
});

test('a late OAuth response cannot navigate or set return hints after the user leaves home, changes identity or dismisses the dialog',async()=>{
 for(const change of [h=>{h.state.page='record';h.context.render()},h=>{h.state.me.schoolId='school-b';h.storage.set('school_context_id','school-b')},h=>{h.state.me.identityId='another-parent'},h=>{h.state.parentLineFriendPromptEpoch++;h.window.parentLineFriendPrompt.reset()},h=>{h.state.parentLineBinding.friendStatus='friend'},h=>h.click('稍後再說'),h=>h.dialog().fire('cancel')]){
  let release;const h=fixture({apiOverride:()=>new Promise(resolve=>{release=resolve})});await settle();const action=h.click('加入好友並確認');await change(h);release({url:oauthUrl});await action;
  assert.equal(h.requests.length,1);assert.equal(h.navigation.length,0);assert.equal(h.storage.has('parent_line_account_return'),false);assert.equal(h.dialog(),undefined);
 }
});

test('an old dialog click or late response cannot operate on the new account reminder',async()=>{
 let release;const h=fixture({apiOverride:()=>new Promise(resolve=>{release=resolve})});await settle();const oldButton=h.button('加入好友並確認'),action=oldButton.fire('click');
 h.state.me.identityId='parent-b';h.state.me.email='second@example.test';h.state.parentLineBinding=h.binding();h.context.render();const nextDialog=h.dialog();assert.ok(nextDialog);assert.equal(h.document.promptShows,2);
 await oldButton.fire('click');assert.equal(h.requests.length,1);release({url:oauthUrl});await action;
 assert.equal(h.navigation.length,0);assert.equal(h.dialog(),nextDialog);assert.equal(h.storage.has('parent_line_account_return'),false);
});

test('failed authorization remains retryable in the dialog and concurrent clicks submit only once',async()=>{
 let release,attempt=0;const h=fixture({apiOverride:()=>{attempt++;if(attempt===1)return new Promise((_resolve,reject)=>{release=reject});return {url:oauthUrl}}});await settle();
 const first=h.click('加入好友並確認');await h.click('加入好友並確認');assert.equal(h.requests.length,1);assert.equal(h.button('加入好友並確認').disabled,true);
 release(Error('temporarily unavailable'));await first;assert.ok(h.dialog());assert.match(h.dialog().textContent,/請稍後重試/);assert.equal(h.button('加入好友並確認').disabled,false);assert.equal(h.navigation.length,0);
 await h.click('加入好友並確認');assert.equal(h.requests.length,2);assert.deepEqual(h.navigation,[oauthUrl]);await h.click('加入好友並確認');assert.equal(h.requests.length,2,'navigation in progress cannot be submitted again');
});

test('unexpected OAuth URLs, including credentials on the correct host, never navigate or write Google return hints',async()=>{
 for(const url of ['https://evil.invalid/','http://access.line.me/oauth2/v2.1/authorize','https://access.line.me/other','https://user:password@access.line.me/oauth2/v2.1/authorize','https://user@access.line.me/oauth2/v2.1/authorize','/oauth2/v2.1/authorize',undefined]){
  const h=fixture({apiOverride:()=>({url})});await settle();const record=JSON.stringify(h.state.parentLineBinding);await h.click('加入好友並確認');
  assert.equal(h.navigation.length,0);assert.equal(h.storage.has('parent_line_account_return'),false);assert.equal(h.button('加入好友並確認').disabled,false);assert.match(h.dialog().textContent,/無法開啟 LINE 好友確認/);assert.equal(JSON.stringify(h.state.parentLineBinding),record);
 }
});
