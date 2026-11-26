import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const keys=['google_id_token','school_context_id','role_context','teacher_line_account_return','parent_line_account_return','line_staff_entry'];
const tick=()=>new Promise(setImmediate);
async function settle(){await tick();await tick();}

function fixture({search='',storageFailure=false,replaceFailure=false,handler=async()=>({ok:true,status:204})}={}){
  const storage=new Map(keys.map(key=>[key,'old-'+key]));
  storage.set('practice_draft','preserve-practice');storage.set('registration_draft','preserve-registration');
  const calls=[],navigation=[],logs=[],listeners=[];
  const status={textContent:'',innerHTML:'',hidden:false},retry={disabled:false,hidden:false,
    addEventListener:(name,callback)=>{if(name==='click')listeners.push(callback)}};
  const location=new URL('https://school.example.test/login-reset.html'+search);
  location.replace=url=>{if(control.replaceFailure)throw Error('navigation unavailable');navigation.push(url)};
  const control={storageFailure,replaceFailure,handler};
  const context={URL,URLSearchParams,location,
    document:{getElementById:id=>id==='loginResetStatus'?status:id==='loginResetRetry'?retry:null},
    sessionStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>{if(control.storageFailure)throw Error('storage unavailable');storage.delete(key)},
      clear:()=>{throw Error('login recovery must not clear unrelated drafts')}},
    fetch:async(url,options)=>{const call={url,options};calls.push(call);return control.handler(call,calls.length)},
    console:{log:(...args)=>logs.push(args),warn:(...args)=>logs.push(args),error:(...args)=>logs.push(args)}};
  context.window=context;
  runInNewContext(read('app/login-reset.js'),context);
  const click=async()=>{
    if(retry.disabled)return;
    if(typeof retry.onclick==='function')await retry.onclick();
    for(const callback of listeners)await callback({preventDefault(){}});
  };
  return {storage,calls,navigation,logs,status,retry,control,click};
}

test('the standalone reset clears only known login hints, revokes both sessions, and retains unrelated parent drafts',async()=>{
  const h=fixture({search:'?schoolId=sacred-heart'});await settle();
  for(const key of keys)assert.equal(h.storage.has(key),false,key+' is not allowed to keep the failed return alive');
  assert.equal(h.storage.get('practice_draft'),'preserve-practice');assert.equal(h.storage.get('registration_draft'),'preserve-registration');
  assert.deepEqual(h.calls.map(call=>call.url).sort(),['/api/google-logout','/api/line/session/logout']);
  for(const {options} of h.calls){
    assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
    assert.equal(new Headers(options.headers).get('x-google-id-token'),null);assert.equal(new Headers(options.headers).get('authorization'),null);
    assert.equal(options.body,undefined);
  }
  assert.deepEqual(h.navigation,['/?schoolId=sacred-heart']);
  assert.doesNotMatch(JSON.stringify([h.calls,h.navigation,h.logs]),/old-google_id_token|old-line_staff_entry|preserve-practice/);
});

test('recovery waits for both logout results and deduplicates retry clicks while either result is still pending',async()=>{
  const releases=[];
  const h=fixture({handler:()=>new Promise(resolve=>releases.push(resolve))});await settle();
  assert.equal(h.calls.length,2);assert.equal(h.retry.disabled,true);assert.deepEqual(h.navigation,[]);
  releases[0]({ok:true,status:204});await settle();assert.deepEqual(h.navigation,[]);
  await h.click();await h.click();assert.equal(h.calls.length,2);
  releases[1]({ok:true,status:204});await settle();assert.deepEqual(h.navigation,['/']);
});

test('a rejected or unavailable logout cannot claim recovery success, and an explicit retry can recover',async t=>{
  for(const failed of ['google','line','network'])await t.test(failed,async()=>{
    const h=fixture({search:'?schoolId=school-a',handler:async({url})=>{
      if(failed==='network'){
        if(url==='/api/google-logout')throw Error('private provider detail token=SECRET');
        return {ok:true,status:204};
      }
      return {ok:!url.includes(failed==='google'?'google':'line/session'),status:url.includes(failed==='google'?'google':'line/session')?503:204};
    }});await settle();
    assert.equal(h.calls.length,2);assert.deepEqual(h.navigation,[]);assert.equal(h.retry.disabled,false);
    assert.match(h.status.textContent,/重試|重新|未完成|無法|失敗|稍後/);
    assert.doesNotMatch(h.status.textContent,/SECRET|token=|private provider/);
    h.control.handler=async()=>({ok:true,status:204});await h.click();await settle();
    assert.equal(h.calls.length,4);assert.deepEqual(h.navigation,['/?schoolId=school-a']);
  });
});

test('storage failure keeps recovery on the safe page and retry can clear the old return hints before navigation',async()=>{
  const h=fixture({search:'?schoolId=school-a',storageFailure:true});await settle();
  assert.deepEqual(h.navigation,[]);assert.equal(h.retry.disabled,false);assert.match(h.status.textContent,/重試|重新|未完成|無法|失敗|瀏覽器/);
  h.control.storageFailure=false;await h.click();await settle();
  for(const key of keys)assert.equal(h.storage.has(key),false);
  assert.deepEqual(h.navigation,['/?schoolId=school-a']);assert.equal(h.storage.get('registration_draft'),'preserve-registration');
});

test('a failed browser navigation remains retryable instead of leaving the restart action permanently locked',async()=>{
  const h=fixture({search:'?schoolId=school-a',replaceFailure:true});await settle();
  assert.equal(h.calls.length,2);assert.deepEqual(h.navigation,[]);assert.equal(h.retry.disabled,false);
  h.control.replaceFailure=false;await h.click();await settle();
  assert.equal(h.calls.length,4);assert.deepEqual(h.navigation,['/?schoolId=school-a']);
});

test('only one valid school hint survives reset; return URLs, tokens, role hints and fragments cannot control navigation',async t=>{
  const cases=[
    ['?schoolId=school-a&returnTo=https://evil.example.test/&teacherLineAccount=school-b&google_id_token=SECRET#private','/?schoolId=school-a'],
    ['?schoolId=01','/?schoolId=01'],
    ['?schoolId=school-a&schoolId=school-a','/'],
    ['?schoolId=school-a&schoolId=school-b','/'],
    ['?schoolId=School-A','/'],['?schoolId=../school-a','/'],['?schoolId=https://evil.example.test','/'],
    ['?schoolId=-school','/'],['?schoolId=school--a','/'],['?schoolId=a','/'],
    ['?schoolId='+('a'.repeat(61)),'/'],['?returnTo=//evil.example.test&role_context=teacher','/']
  ];
  for(const [search,target] of cases)await t.test(search,async()=>{
    const h=fixture({search});await settle();assert.deepEqual(h.navigation,[target]);
    assert.equal(new URL(h.navigation[0],'https://school.example.test').origin,'https://school.example.test');
    assert.doesNotMatch(h.navigation[0],/SECRET|teacherLineAccount|role_context|returnTo|#/);
    assert.equal(h.calls.length,2);assert.equal(h.calls.every(call=>['/api/google-logout','/api/line/session/logout'].includes(call.url)),true);
  });
});

test('the reset page is a mobile-friendly public recovery page with no student form or automatic authorization',()=>{
  const html=read('app/login-reset.html');
  assert.match(html,/<meta[^>]+name=["']viewport["']/i);assert.match(html,/id=["']loginResetStatus["'][^>]*role=["']status["']|role=["']status["'][^>]*id=["']loginResetStatus["']/i);
  assert.match(html,/id=["']loginResetRetry["']/);assert.match(html,/login-reset\.js/);
  assert.doesNotMatch(html,/id=["']rName["']|id=["']rConsent["']|送出綁定申請|accounts\.google\.com|access\.line\.me/);
});
