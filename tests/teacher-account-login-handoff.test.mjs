import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const app=read('app/app-v3.js'),guard=read('app/webview-guard.js');
const entrySource=app.slice(app.indexOf('function teacherLineAccountEntry(){'),app.indexOf('async function restoreLineStaffSession(){'));
const loginSource=app.slice(app.indexOf('function googleAccountReturnState(){'),app.indexOf('function roleText(){'));
const lineLoginSource=app.slice(app.indexOf('async function renderLineLogin(){'),app.indexOf('let parentLineBindingRequest='));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function loginFixture({search='',embedded=false,pending=[],userAgent='Chrome'}={}){
 const storage=new Map(pending),nodes=Object.fromEntries(['app','googleBtn','tenantLineSignIn','teacherLineSignIn','teacherLineSignInError'].map(id=>[id,{innerHTML:'',textContent:'',clientWidth:280,isConnected:true}]));
 const requests=[],initializations=[],buttons=[],intervals=[],profiles=[],logins=[],navigation=[];
 const location=new URL('https://school.example.invalid/'+search),state={token:'',me:null};
 location.assign=url=>navigation.push(url);
 const context={state,URL,URLSearchParams,location,navigator:{userAgent},document:{getElementById:id=>nodes[id]||null},$:id=>nodes[id],esc,
  sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  history:{replaceState:(_state,_title,target)=>{location.href=new URL(target,location).href}},
  setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval:id=>{intervals[id-1]=null},
  window:{__lineEmbedded:embedded,google:{accounts:{id:{initialize:options=>initializations.push(options),renderButton:(node,options)=>buttons.push({node,options})}}}},
  fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url==='/api/config'?{googleClientId:'google-client'}:{items:[]}}},
  loadProfile:async profile=>profiles.push(profile),paidActivityEntry:()=>null};
 context.google=context.window.google;
 runInNewContext(entrySource+'\n'+lineLoginSource+'\n'+loginSource,context);
 return {context,state,storage,nodes,requests,initializations,buttons,intervals,profiles,logins,navigation,login:()=>context.renderLogin(),tick:()=>{for(const fn of [...intervals])if(fn)fn()}};
}

test('a teacher recovery screen offers explicit LINE login alongside first-time Gmail pairing and only clears old intents before valid login navigation',async()=>{
 const h=loginFixture({search:'?teacherLineAccount=school-a&line_error=authorization',embedded:true,pending:[['teacher_line_account_return','school-a'],['parent_line_account_return','school-b'],['line_staff_entry','old-staff-menu']]});
 await h.login();assert.match(h.nodes.tenantLineSignIn.innerHTML,/首次連結.*Gmail/);assert.match(h.nodes.tenantLineSignIn.innerHTML,/已完成綁定，使用 LINE 登入/);assert.equal(h.requests.length,0);
 let release;h.context.fetch=(url,options)=>{h.requests.push({url,options});return new Promise(resolve=>{release=resolve})};
 const scope=JSON.stringify(h.state),action=h.nodes.teacherLineSignIn.onclick();await h.nodes.teacherLineSignIn.onclick();assert.equal(h.requests.length,1);assert.equal(h.nodes.teacherLineSignIn.disabled,true);
 const request=h.requests[0];assert.equal(request.url,'/api/line/tenant-login/school-a/start');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.cache,'no-store');assert.deepEqual(JSON.parse(request.options.body),{mode:'login'});assert.equal(request.options.headers['X-Google-ID-Token'],undefined);assert.equal(h.storage.get('teacher_line_account_return'),'school-a');
 const url='https://access.line.me/oauth2/v2.1/authorize?state=normal-login';release({ok:true,json:async()=>({url})});await action;
 assert.deepEqual(h.navigation,[url]);for(const key of ['teacher_line_account_return','parent_line_account_return','line_staff_entry'])assert.equal(h.storage.has(key),false);
 assert.equal(JSON.stringify(h.state),scope);assert.equal(h.storage.has('google_id_token'),false);await h.nodes.teacherLineSignIn.onclick();assert.equal(h.requests.length,1);
});

test('teacher LINE login rejects invalid authorization URLs, keeps pairing recovery available and permits a failed request to retry',async()=>{
 for(const url of ['https://evil.invalid/','http://access.line.me/oauth2/v2.1/authorize','https://access.line.me/other','https://user@access.line.me/oauth2/v2.1/authorize','https://user:password@access.line.me/oauth2/v2.1/authorize','/oauth2/v2.1/authorize']){
  const h=loginFixture({search:'?teacherLineAccount=school-a',embedded:true,pending:[['teacher_line_account_return','school-a']]});await h.login();h.context.fetch=async()=>({ok:true,json:async()=>({url})});await h.nodes.teacherLineSignIn.onclick();
  assert.equal(h.navigation.length,0);assert.match(h.nodes.teacherLineSignInError.textContent,/LINE 登入網址不正確/);assert.equal(h.nodes.teacherLineSignIn.disabled,false);assert.equal(h.storage.get('teacher_line_account_return'),'school-a');
 }
 const h=loginFixture({search:'?teacherLineAccount=school-a',embedded:true});await h.login();let attempt=0;h.context.fetch=async()=>{if(!attempt++)throw Error('暫時離線');return {ok:true,json:async()=>({url:'https://access.line.me/oauth2/v2.1/authorize?state=retry'})}};
 await h.nodes.teacherLineSignIn.onclick();assert.match(h.nodes.teacherLineSignInError.textContent,/暫時離線/);assert.equal(h.nodes.teacherLineSignIn.disabled,false);await h.nodes.teacherLineSignIn.onclick();assert.equal(h.navigation.length,1);
});

test('a late teacher LINE login response cannot clear return hints, replace errors or navigate an obsolete login screen',async()=>{
 for(const change of [h=>{h.state.token='new-token';h.state.me={role:'teacher',schoolId:'school-b',email:'new@example.invalid'}},h=>h.storage.set('google_id_token','new-token'),h=>h.storage.set('school_context_id','school-b'),h=>{h.context.location.search='?teacherLineAccount=school-b'},h=>{h.nodes.tenantLineSignIn.isConnected=false},h=>{h.nodes.teacherLineSignIn={disabled:false,onclick:null}}]){
  const h=loginFixture({search:'?teacherLineAccount=school-a',embedded:true,pending:[['teacher_line_account_return','school-a'],['line_staff_entry','old-staff-menu']]});await h.login();let release;h.context.fetch=()=>new Promise(resolve=>{release=resolve});const action=h.nodes.teacherLineSignIn.onclick();change(h);
  const next=JSON.stringify(h.state);h.nodes.teacherLineSignInError.textContent='新畫面狀態';release({ok:true,json:async()=>({url:'https://access.line.me/oauth2/v2.1/authorize?state=old'})});await action;
  assert.equal(h.navigation.length,0);assert.equal(h.storage.get('teacher_line_account_return'),'school-a');assert.equal(h.storage.get('line_staff_entry'),'old-staff-menu');assert.equal(h.nodes.teacherLineSignInError.textContent,'新畫面狀態');assert.equal(JSON.stringify(h.state),next);
 }
});

test('GIS places only a fixed teacher or parent return hint in renderButton state, independently of session storage',async()=>{
 for(const [search,expected] of [['?teacherLineAccount=school-a','teacher-account:school-a'],['?parentLineAccount=school-b','parent-account:school-b'],['?teacherLineAccount=school-a&returnTo=https://evil.invalid&studentId=other','teacher-account:school-a']]){
  const h=loginFixture({search});await h.login();h.tick();assert.equal(h.buttons.length,1);assert.equal(h.buttons[0].options.state,expected);
  assert.equal(h.initializations.length,1);assert.equal(Object.hasOwn(h.initializations[0],'state'),false,'the official clicked-button state belongs to renderButton');
  assert.equal(h.initializations[0].client_id,'google-client');assert.equal(h.requests.some(call=>call.options?.method==='POST'),false);assert.equal(h.storage.size,0);
 }
 for(const search of ['', '?teacherLineAccount=https://evil.invalid','?teacherLineAccount=../school-a','?state=teacher-account:school-a','?adminLineAccount=school-a&line_friend=checked']){
  const h=loginFixture({search});await h.login();h.tick();assert.equal(h.buttons.length,1);assert.equal(Object.hasOwn(h.buttons[0].options,'state'),false);
 }
});

test('the existing iOS redirect wrapper keeps its fixed login URI and does not consume or rewrite button state',async()=>{
 const h=loginFixture({search:'?teacherLineAccount=school-a',userAgent:'iPhone Safari'}),native=h.context.window.google.accounts.id.initialize;
 let appLoads=0;h.context.loadApp=()=>appLoads++;
 const start=guard.indexOf('  function installIOSRedirectMode(){'),end=guard.indexOf('  document.addEventListener("click"',start);
 runInNewContext(guard.slice(start,end)+';installIOSRedirectMode();',h.context);h.tick();assert.equal(appLoads,1);assert.notEqual(h.context.window.google.accounts.id.initialize,native);
 await h.login();h.tick();assert.equal(h.initializations.length,1);assert.equal(h.initializations[0].ux_mode,'redirect');assert.equal(h.initializations[0].login_uri,'https://school.example.invalid/api/google-login');
 assert.equal(Object.hasOwn(h.initializations[0],'callback'),false);assert.equal(h.buttons[0].options.state,'teacher-account:school-a');
 assert.equal(new URL(h.initializations[0].login_uri).search,'');
});

test('LINE webview teacher recovery offers an external browser URL with the verified-screen hint instead of initializing Google inside LINE',async()=>{
 const h=loginFixture({search:'?teacherLineAccount=school-a&line_error=verification&returnTo=https://evil.invalid&studentId=other',embedded:true,userAgent:'iPhone Line/14.0'});
 await h.login();assert.equal(h.initializations.length,0);assert.equal(h.buttons.length,0);assert.equal(h.requests.length,0);
 const html=h.nodes.googleBtn.innerHTML,href=html.match(/href="([^"]+)"/);assert.ok(href,'an actionable external browser link is displayed');
 const target=new URL(href[1].replaceAll('&amp;','&'),'https://school.example.invalid');
 assert.equal(target.origin,'https://school.example.invalid');assert.equal(target.pathname,'/');assert.equal(target.searchParams.get('teacherLineAccount'),'school-a');assert.equal(target.searchParams.get('openExternalBrowser'),'1');assert.equal(target.searchParams.get('line_error'),'verification');
 assert.equal(target.searchParams.has('returnTo'),false);assert.equal(target.searchParams.has('studentId'),false);assert.doesNotMatch(h.nodes.app.innerHTML,/id="rName"|id="rConsent"|送出綁定申請/);
});

test('the actual GIS button state survives Google POST into a fresh teacher tab and still requires same-school Google teacher verification',async()=>{
 const h=loginFixture({search:'?teacherLineAccount=school-a'});await h.login();h.tick();const state=h.buttons[0].options.state;
 const handlers={},serverSource=read('api/src/functions/googleLogin.js').replace(/^import .*;\r?\n/gm,'');
 runInNewContext(serverSource,{URLSearchParams,app:{http:(name,route)=>handlers[name]=route.handler},verifyGoogleToken:async credential=>credential==='verified-google-token'?{sub:'teacher-sub',email:'teacher@example.invalid'}:null});
 const fields=new URLSearchParams({credential:'verified-google-token',g_csrf_token:'browser-csrf',state});
 const redirect=await handlers.googleLogin({text:async()=>fields.toString(),headers:new Headers({cookie:'g_csrf_token=browser-csrf'})});assert.equal(redirect.status,302);
 for(const profile of [{authProvider:'google',role:'teacher',schoolId:'school-a',email:'teacher@example.invalid'},{authProvider:'google',role:'parent',schoolId:'school-a'},{authProvider:'line',role:'unassigned',schoolId:'school-a'},{authProvider:'google',role:'teacher',schoolId:'school-b'}]){
  const fresh=loginFixture({search:new URL(redirect.headers.Location,'https://school.example.invalid').search}),requests=[],loaded=[],errors=[];
  assert.equal(fresh.storage.size,0,'the new browser tab starts without the old intent or token');
  const prefix=guard.slice(guard.indexOf('  const current=new URL(location.href);'),guard.indexOf('  const staffMenuRoutes='));runInNewContext(prefix,fresh.context);
  fresh.state.token=fresh.storage.get('google_id_token')||'';fresh.context.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>profile}};
  fresh.context.loadProfile=async value=>loaded.push(value);fresh.context.renderLogin=message=>errors.push(message);
  const boot=app.slice(app.indexOf('async function boot(){'),app.indexOf('const schoolViewScript='));runInNewContext(boot+';this.start=boot;',fresh.context);await fresh.context.start();
  assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/me');assert.equal(requests[0].options.headers['X-School-Id'],'school-a');assert.equal(requests[0].options.headers['X-Role-Context'],'teacher');
  const permitted=profile.authProvider==='google'&&profile.role==='teacher'&&profile.schoolId==='school-a';assert.equal(loaded.length,permitted?1:0);assert.equal(errors.length,permitted?0:1);
  if(!permitted)assert.match(errors[0],/Gmail/);assert.equal(requests.some(call=>/student-registration|student-master/.test(call.url)),false);
 }
});

test('a late GIS account restore cannot clear a newer successful Gmail login or replace its page and DOM',async()=>{
 for(const kind of ['teacher','parent'])for(const late of ['200','403','reject','json']){
  const marker=kind==='teacher'?'teacherLineAccount':'parentLineAccount',h=loginFixture({search:'?'+marker+'=school-a'});
  await h.login();h.tick();const callback=h.initializations[0].callback,errors=[],loaded=[],navigation=[];
  const originalLogin=h.context.renderLogin;h.context.renderLogin=async message=>{errors.push(message);return originalLogin(message)};
  const accountA={authProvider:'google',role:kind,schoolId:'school-a',identityId:'account-a',email:'a@example.invalid'},accountB={...accountA,identityId:'account-b',email:'b@example.invalid'};
  let finishA;
  h.context.fetch=async(url,options)=>{
   if(url==='/api/config')return {ok:true,json:async()=>({googleClientId:'google-client'})};
   assert.equal(url,'/api/me');const token=options.headers['X-Google-ID-Token'];
   if(token==='google-b')return {ok:true,json:async()=>accountB};
   assert.equal(token,'google-a');
   if(late==='json')return {ok:true,json:()=>new Promise(resolve=>{finishA=()=>resolve(accountA)})};
   return new Promise((resolve,reject)=>{finishA=()=>late==='reject'?reject(Error('old network failure')):resolve({ok:late==='200',status:Number(late),json:async()=>accountA})});
  };
  h.context.loadProfile=async profile=>{loaded.push(profile);h.state.me=profile;h.state.page='teacherHome';h.nodes.app.innerHTML='<main>已登入 B 的教學首頁</main>'};
  h.context.location.replace=url=>navigation.push(url);
  const pendingA=callback({credential:'google-a'});await new Promise(setImmediate);assert.equal(typeof finishA,'function');
  await callback({credential:'google-b'});
  if(kind==='parent'){
   assert.equal(navigation.length,1);assert.equal(new URL(navigation[0],h.context.location).searchParams.get('parentLineAccount'),'school-a');
   // The new page has completed the verified Gmail parent's navigation while
   // the old page's request is still resolving in the original browser realm.
   h.state.me=accountB;h.state.page='home';h.nodes.app.innerHTML='<main>已登入 B 的家長首頁</main>';
  }else assert.deepEqual(loaded,[accountB]);
  const successfulDom=h.nodes.app.innerHTML,successfulPage=h.state.page,successfulStorage=[...h.storage];
  finishA();await pendingA;await new Promise(setImmediate);
  assert.equal(h.state.me,accountB,kind+' '+late+' retains the new authenticated identity');assert.equal(h.state.page,successfulPage);assert.equal(h.nodes.app.innerHTML,successfulDom);
  assert.equal(h.state.token,'google-b');assert.deepEqual([...h.storage],successfulStorage);assert.deepEqual(errors,[]);assert.equal(loaded.includes(accountA),false);assert.equal(h.initializations.length,1);
 }
});

function homeFixture({provider='line',role='unassigned',schoolId='school-a',student=null}={}){
 const appNode={innerHTML:''},requests=[],state={token:provider==='line'?'line-session':'google-token',page:'home',me:{authProvider:provider,role,schoolId,schoolName:'測試學校',displayName:'wen',email:provider==='line'?'':'parent@example.invalid',capabilities:{}},student,students:student?[student]:[],summary:{},practice:[]};
 const context={state,window:{},URL,URLSearchParams,esc,document:{getElementById:id=>id==='app'?appNode:null},sessionStorage:{getItem:()=>''},location:new URL('https://school.example.invalid/'),shell:html=>'<main>'+html+'</main>',api:async()=>{requests.push('api');throw Error('recovery must not write')},refreshStudent:async()=>{requests.push('refresh')},loadAdmin:async()=>{requests.push('admin')},tenantServicesEntry:()=>'',parentServicesAtTop:()=>false};
 const helper=app.slice(app.indexOf('function lineAccountRecoveryPanel(){'),app.indexOf('function home(){'));
 const home=app.slice(app.indexOf('function home(){'),app.indexOf('function calcMinutes('));
 const registration=app.slice(app.indexOf('function registrationForm(){'),app.indexOf('async function submitRegistration(){'));
 const go=app.split('\n').find(line=>line.startsWith('async function go(')),render=app.split('\n').find(line=>line.startsWith('function render(){'));
 runInNewContext(helper+'\n'+registration+'\n'+home+'\n'+go+'\n'+render,context);
 return {context,state,appNode,requests,render:()=>context.render()};
}

test('an unassigned LINE account sees neutral recovery without a student or guardian form until first-time registration is explicitly selected',async()=>{
 const h=homeFixture(),original=JSON.stringify(h.state.me);h.render();const html=h.appNode.innerHTML;
 assert.match(html,/連結既有平台帳號/);assert.match(html,/已建檔老師.*原 Gmail/);assert.match(html,/首次申請家長資格.*申請綁定學生/);
 assert.doesNotMatch(html,/id="rName"|id="rStudentNo"|id="rConsent"|type="checkbox"|送出綁定申請/);assert.equal(h.requests.length,0);
 const href=html.match(/href="([^"]*teacherLineAccount[^"]*)"/);assert.ok(href);const target=new URL(href[1].replaceAll('&amp;','&'),'https://school.example.invalid');
 assert.equal(target.origin,'https://school.example.invalid');assert.equal(target.searchParams.get('teacherLineAccount'),'school-a');assert.equal(target.searchParams.get('openExternalBrowser'),'1');
 const action=html.match(/onclick="([^"]*go\('register'\)[^"]*)"/);assert.ok(action,'parent registration requires its own explicit click');await runInNewContext('(async()=>{'+action[1]+'})()',h.context);
 assert.equal(h.state.page,'register');assert.match(h.appNode.innerHTML,/id="rName"/);assert.match(h.appNode.innerHTML,/id="rConsent"/);assert.match(h.appNode.innerHTML,/送出綁定申請/);
 assert.equal(JSON.stringify(h.state.me),original);assert.equal(h.requests.length,0);
});

test('unassigned Gmail and approved parent homes retain their existing behavior and a malformed school cannot become a recovery destination',()=>{
 const gmail=homeFixture({provider:'google'});gmail.render();assert.match(gmail.appNode.innerHTML,/id="rName"|id="rConsent"/);assert.doesNotMatch(gmail.appNode.innerHTML,/連結既有平台帳號/);
 const parent=homeFixture({provider:'google',role:'parent',student:{studentId:'student-a',name:'核准學生',groupName:'A',instrument:'小提琴',grade:'四年級'}});parent.render();assert.match(parent.appNode.innerHTML,/核准學生/);assert.doesNotMatch(parent.appNode.innerHTML,/連結既有平台帳號|id="rConsent"/);
 const invalid=homeFixture({schoolId:'https://evil.invalid/<script>'});invalid.render();assert.doesNotMatch(invalid.appNode.innerHTML,/href="[^"]*teacherLineAccount/);assert.doesNotMatch(invalid.appNode.innerHTML,/<script>/);assert.equal(invalid.requests.length,0);
});
