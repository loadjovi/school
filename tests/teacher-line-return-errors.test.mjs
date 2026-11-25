import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app/app-v3.js',import.meta.url),'utf8');
const entries=app.slice(app.indexOf('function teacherLineAccountEntry(){'),app.indexOf('async function restoreLineStaffSession(){'));
function fixture(fetch){
 const storage=new Map([['google_id_token','cookie-session']]),state={token:'cookie-session',me:null};
 const context={state,URLSearchParams,location:{pathname:'/',search:'?teacherLineAccount=school-a',hash:''},history:{replaceState(){}},
  sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},fetch};
 runInNewContext(entries+';this.restore=restoreTeacherLineAccountSession;',context);
 return {state,storage,restore:()=>context.restore('school-a')};
}

test('teacher recovery distinguishes expired Gmail, rejected requests and service failures without claiming a failed LINE binding',async()=>{
 for(const [status,expected] of [[401,/登入已失效/],[403,/未獲允許/],[429,/服務暫時無法回應/],[500,/服務暫時無法回應/],[503,/服務暫時無法回應/],[404,/暫時無法確認/]]){
  let bodyReads=0;const h=fixture(async()=>({ok:false,status,json:async()=>{bodyReads++;return {error:'private backend details'}}}));
  await assert.rejects(h.restore(),error=>{
   assert.match(error.message,expected);assert.match(error.message,new RegExp('TCH-HTTP-'+status));
   assert.doesNotMatch(error.message,/private backend|綁定尚未完成|綁定失敗/);
   if(status>=500||status===429)assert.doesNotMatch(error.message,/重新登入/);
   return true;
  });
  assert.equal(bodyReads,0);assert.equal(h.state.me,null);assert.equal(h.state.token,'cookie-session');
 }
});

test('network and malformed-response errors expose a safe check code rather than raw exception or credential content',async()=>{
 const cases=[
  {fetch:async()=>{throw Error('network detail token=SECRET')},code:'TCH-NETWORK'},
  {fetch:async()=>({ok:true,status:200,json:async()=>{throw Error('invalid JSON token=SECRET')}}),code:'TCH-RESPONSE'},
  {fetch:async()=>({ok:true,status:200,json:async()=>null}),code:'TCH-RESPONSE'}
 ];
 for(const item of cases){
  const h=fixture(item.fetch);await assert.rejects(h.restore(),error=>{assert.match(error.message,new RegExp(item.code));assert.doesNotMatch(error.message,/SECRET|token=|invalid JSON/);return true});
  assert.equal(h.state.me,null);assert.equal(h.state.token,'cookie-session');
 }
});

test('a successful HTTP response still distinguishes the wrong provider, school and nonteacher role without assigning teacher access',async()=>{
 const teacher={authProvider:'google',schoolId:'school-a',role:'teacher'};
 for(const [profile,code] of [[{...teacher,authProvider:'line'},'TCH-PROVIDER'],[{...teacher,schoolId:'school-b'},'TCH-SCHOOL'],[{...teacher,role:'unassigned'},'TCH-ROLE'],[{...teacher,role:'parent'},'TCH-ROLE']]){
  const h=fixture(async()=>({ok:true,status:200,json:async()=>profile}));
  await assert.rejects(h.restore(),error=>{assert.match(error.message,new RegExp(code));assert.match(error.message,/Gmail/);return true});
  assert.equal(h.state.me,null);assert.equal(h.state.token,'cookie-session');
 }
});
