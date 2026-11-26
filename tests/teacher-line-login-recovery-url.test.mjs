import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app/app-v3.js',import.meta.url),'utf8');
const entries=app.slice(app.indexOf('function teacherLineAccountEntry(){'),app.indexOf('async function restoreLineStaffSession(){'));
const login=app.slice(app.indexOf('async function renderLineLogin(){'),app.indexOf('let parentLineBindingRequest='));
const authorize='https://access.line.me/oauth2/v2.1/authorize?state=fresh-plain-login';
const original='https://school.example.test/?teacherLineAccount=school-a&parentLineAccount=school-b&line_error=authorization&line_link=confirm&schoolId=school-a';
const intentKeys=['teacher_line_account_return','parent_line_account_return','line_staff_entry'];

function fixture(){
  const storage=new Map([['google_id_token','expired-google-token'],['school_context_id','school-a'],['role_context','teacher'],
    ['teacher_line_account_return','school-a'],['parent_line_account_return','school-b'],['line_staff_entry','old-staff-target']]);
  const nodes=Object.fromEntries(['tenantLineSignIn','teacherLineSignIn','teacherLineSignInError'].map(id=>[id,{innerHTML:'',textContent:'',isConnected:true,disabled:false}]));
  const requests=[],events=[],navigations=[],location=new URL(original),state={token:'expired-google-token',me:null};
  const context={state,location,URL,URLSearchParams,$:id=>nodes[id]||null,document:{getElementById:id=>nodes[id]||null},
    sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    history:{replaceState:(_state,_title,target)=>{location.href=new URL(target,location).href;events.push({kind:'replace',url:location.href});}},
    window:{__lineEmbedded:true},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({url:authorize})};},
    esc:value=>String(value)};
  location.assign=url=>{events.push({kind:'assign',url});navigations.push({url,from:location.href,
    teacherEntry:context.teacherLineAccountEntry(),intents:intentKeys.filter(key=>storage.has(key)),profile:state.me});};
  runInNewContext(entries+'\n'+login,context);
  return {context,state,storage,nodes,requests,events,navigations,location,
    render:()=>context.renderLineLogin(),click:()=>nodes.teacherLineSignIn.onclick()};
}

test('a validated explicit LINE retry replaces the stale teacher-return URL before leaving for authorization',async()=>{
  const h=fixture();await h.render();
  assert.equal(h.context.teacherLineAccountEntry(),'school-a');
  const pending=h.click();await h.click();await pending;
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/line/tenant-login/school-a/start');
  const request=h.requests[0].options;
  assert.equal(request.method,'POST');assert.equal(request.credentials,'same-origin');assert.equal(request.cache,'no-store');
  assert.deepEqual(JSON.parse(request.body),{mode:'login'});assert.equal(request.headers['X-Google-ID-Token'],undefined);
  assert.equal(h.navigations.length,1);const navigation=h.navigations[0],clean=new URL(navigation.from);
  assert.equal(navigation.url,authorize);assert.equal(clean.origin,'https://school.example.test');assert.equal(clean.pathname,'/');
  assert.equal(clean.searchParams.get('schoolId'),'school-a');
  for(const name of ['teacherLineAccount','parentLineAccount','line_error','line_link'])assert.equal(clean.searchParams.has(name),false,name+' must not revive the obsolete Gmail-only return on Safari Back');
  assert.equal(navigation.teacherEntry,'');assert.deepEqual(navigation.intents,[]);assert.equal(navigation.profile,null);
  assert.equal(h.events.at(-1).kind,'assign');assert.ok(h.events.slice(0,-1).some(event=>event.kind==='replace'&&event.url===navigation.from));
  assert.equal(h.requests.some(call=>/student-registration|school-account|\/api\/me/.test(call.url)),false);
});

test('invalid authorization URLs and failed starts leave both the recovery URL and pairing hints available for retry',async t=>{
  const cases=[
    ...['https://evil.example/','http://access.line.me/oauth2/v2.1/authorize','https://access.line.me/other',
      'https://user:password@access.line.me/oauth2/v2.1/authorize','/oauth2/v2.1/authorize'].map(url=>({name:url,reply:()=>({ok:true,json:async()=>({url})})})),
    {name:'HTTP 503',reply:()=>({ok:false,json:async()=>({error:'暫時無法登入'})})},
    {name:'network failure',reply:()=>{throw Error('離線，請重試');}},
    {name:'invalid JSON',reply:()=>({ok:true,json:async()=>{throw Error('回應無法讀取');}})}
  ];
  for(const item of cases)await t.test(item.name,async()=>{
    const h=fixture();await h.render();h.context.fetch=async()=>item.reply();const before=[...h.storage];await h.click();
    assert.equal(h.location.href,original);assert.deepEqual([...h.storage],before);assert.deepEqual(h.events,[]);assert.deepEqual(h.navigations,[]);
    assert.equal(h.nodes.teacherLineSignIn.disabled,false);assert.ok(h.nodes.teacherLineSignInError.textContent);assert.equal(h.context.teacherLineAccountEntry(),'school-a');
  });
});

test('late LINE retry responses cannot rewrite the URL or remove recovery hints belonging to a newer screen or identity',async t=>{
  const changes=[
    ['new credential',h=>{h.state.token='new-google-token';h.storage.set('google_id_token','new-google-token');}],
    ['new teacher identity',h=>{h.state.me={role:'teacher',schoolId:'school-a',email:'new@example.test'};}],
    ['new school',h=>h.storage.set('school_context_id','school-b')],
    ['new role',h=>h.storage.set('role_context','parent')],
    ['new query',h=>{h.location.search='?teacherLineAccount=school-b&line_error=verification';}],
    ['detached screen',h=>{h.nodes.tenantLineSignIn.isConnected=false;}],
    ['replaced button',h=>{h.nodes.teacherLineSignIn={isConnected:true,disabled:false};}]
  ];
  for(const [name,change] of changes)await t.test(name,async()=>{
    const h=fixture();await h.render();let release;
    h.context.fetch=()=>new Promise(resolve=>{release=resolve;});const pending=h.click();change(h);
    const latestUrl=h.location.href,latestStorage=[...h.storage],latestState=JSON.stringify(h.state);
    h.nodes.teacherLineSignInError.textContent='較新的登入畫面';release({ok:true,json:async()=>({url:authorize})});await pending;
    assert.equal(h.location.href,latestUrl);assert.deepEqual([...h.storage],latestStorage);assert.equal(JSON.stringify(h.state),latestState);
    assert.deepEqual(h.events,[]);assert.deepEqual(h.navigations,[]);assert.equal(h.nodes.teacherLineSignInError.textContent,'較新的登入畫面');
  });
});
