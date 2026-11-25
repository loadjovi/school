import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app/app-v3.js',import.meta.url),'utf8');
const entries=app.slice(app.indexOf('function teacherLineAccountEntry(){'),app.indexOf('async function restoreLineStaffSession(){'));
const bootstrap=app.slice(app.indexOf('async function boot(){'),app.indexOf('const schoolViewScript='));
const admin={authProvider:'google',role:'admin',schoolId:'school-a',email:'admin@example.invalid',contexts:[{type:'schoolAdmin',schoolId:'school-a'},{type:'globalAdmin'}]};
function fixture({search='?adminLineAccount=school-a&line_friend=checked',pathname='/',token='',profile=admin,status=200,pending=false}={}){
 const requests=[],profiles=[],logins=[],storage=new Map(pending?[['teacher_line_account_return','school-b'],['parent_line_account_return','school-b'],['line_staff_entry','old-staff-screen']]:[]),state={token,me:null};
 const context={state,URLSearchParams,location:{pathname,search,hash:''},window:{},history:{replaceState(){throw Error('callback must stay available for the workspace')}},
  sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  fetch:async(url,options)=>{requests.push({url,options,storage:[...storage]});return {ok:status===200,status,json:async()=>profile}},
  loadProfile:async value=>profiles.push(value),renderLogin:message=>logins.push(message),restoreLineStaffSession:async()=>undefined,paidActivityEntry:()=>null};
 runInNewContext(entries+'\n'+bootstrap+';this.start=boot;',context);
 return {context,state,storage,requests,profiles,logins,boot:()=>context.start()};
}

test('a fresh administrator friendship callback restores only a verified same-school Gmail identity and preserves Global contexts',async()=>{
 for(const result of ['checked','unavailable','mismatch'])for(const token of ['','line-session','cookie-session','google-token']){
  const h=fixture({search:'?adminLineAccount=school-a&line_friend='+result,token,pending:true});await h.boot();
  assert.equal(h.requests.length,1);const {url,options,storage}=h.requests[0];assert.equal(url,'/api/me');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
  assert.equal(options.headers['X-School-Id'],'school-a');assert.equal(options.headers['X-Role-Context'],'schoolAdmin');assert.equal(options.headers['X-Google-ID-Token'],token==='google-token'?token:undefined);
  assert.equal(storage.some(([key])=>key==='role_context'),false,'the role is not restored before server verification');
  assert.equal(h.profiles.length,1);assert.equal(h.profiles[0],admin);assert.equal(h.profiles[0].contexts,admin.contexts);assert.equal(h.logins.length,0);
  assert.equal(h.state.token,token==='google-token'?token:'cookie-session');assert.equal(h.storage.get('role_context'),'schoolAdmin');assert.equal(h.storage.get('school_context_id'),'school-a');
  assert.equal(h.storage.has('teacher_line_account_return'),false);assert.equal(h.storage.has('parent_line_account_return'),false);assert.equal(h.storage.has('line_staff_entry'),false);assert.equal(h.context.location.search,'?adminLineAccount=school-a&line_friend='+result);
 }
});

test('a forged administrator callback never upgrades LINE, another role, another school or an unverified session',async()=>{
 for(const options of [{profile:{...admin,authProvider:'line'}},{profile:{...admin,role:'parent'}},{profile:{...admin,role:'teacher'}},{profile:{...admin,role:'globalAdmin',schoolId:null}},{profile:{...admin,schoolId:'school-b'}},{status:401},{status:403},{status:503}]){
  const h=fixture({token:'line-session',...options});await h.boot();assert.equal(h.requests.length,1);assert.equal(h.profiles.length,0);assert.equal(h.logins.length,1);assert.match(h.logins[0],/管理員 Gmail/);
  assert.equal(h.state.me,null);assert.equal(h.state.token,'line-session');assert.equal(h.storage.size,0);
 }
});

test('administrator friendship return parameters cannot select an arbitrary path, duplicate school or unexpected result',async()=>{
 for(const options of [{search:'?adminLineAccount=https://evil.invalid&line_friend=checked'},{search:'?adminLineAccount=school-a&adminLineAccount=school-b&line_friend=checked'},{search:'?adminLineAccount=school-a&line_friend=checked&line_friend=mismatch'},{search:'?adminLineAccount=school-a&line_friend=friend'},{pathname:'/line-account.html'}]){
  const h=fixture(options);assert.equal(h.context.adminFriendAccountEntry(),'');await h.boot();assert.equal(h.requests.length,0);assert.equal(h.profiles.length,0);assert.equal(h.storage.size,0);
 }
});

test('a Gmail retry verifies the intended administrator identity before loading the workspace and never opens student registration',async()=>{
 const callback=app.slice(app.indexOf('callback:async res=>{state.token=res.credential;'),app.indexOf('google.accounts.id.renderButton($("googleBtn")'));
 const body=callback.slice('callback:'.length,callback.lastIndexOf('});')),calls=[],state={};
 const retry=runInNewContext('('+body+')',{state,sessionStorage:{setItem(){}},adminFriendAccountEntry:()=> 'school-a',teacherLineAccountEntry:()=> '',parentLineAccountEntry:()=> '',restoreAdminFriendAccountSession:async sid=>{calls.push(sid);throw Error('請使用此校管理員 Gmail')},loadProfile:()=>calls.push('student-registration'),renderLogin:message=>calls.push(message)});
 await retry({credential:'new-google-token'});assert.deepEqual(calls,['school-a','請使用此校管理員 Gmail']);assert.equal(state.me,null);
});
