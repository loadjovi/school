import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app/app-v3.js',import.meta.url),'utf8');
const binding=app.slice(app.indexOf('let parentLineBindingRequest='),app.indexOf('function parentServicesAtTop(){'));
function fixture(){
 const requests=[],events={},storage=new Map([['school_context_id','school-a'],['role_context','parent']]);
 const state={token:'google-token',page:'home',parentLineBinding:null,parentLineFriendPromptEpoch:0,me:{role:'parent',schoolId:'school-a',email:'parent@example.invalid',authProvider:'google',capabilities:{lineAccount:true}}};
 let renders=0;
 const context={state,sessionStorage:{getItem:key=>storage.get(key)||''},window:{addEventListener:(type,fn)=>events[type]=fn},
  apiReadScope:()=>JSON.stringify([state.token,state.me?.schoolId,state.me?.email,state.me?.role]),render:()=>renders++,
  api:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))};
 runInNewContext(binding,context);
 return {context,state,requests,events,storage,refresh:()=>context.refreshParentLineBindingStatus(),renders:()=>renders};
}

test('the existing own-account read preserves explicit friendship and provider without making any authorization request',async()=>{
 for(const friendStatus of ['friend','not_friend','unknown',undefined,'true',false]){
  const h=fixture(),record={configured:true,bound:true,googleLinked:true,authProvider:'google',friendStatus,friendCheckedAt:1795569600000},before=JSON.stringify(record);
  const load=h.refresh();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/line/school-account');assert.equal(h.requests[0].options,undefined);
  h.requests[0].resolve(record);await load;assert.equal(h.state.parentLineBinding.bound,true);assert.equal(h.state.parentLineBinding.lineBound,true);
  assert.equal(h.state.parentLineBinding.friendStatus,['friend','not_friend'].includes(friendStatus)?friendStatus:'unknown');
  assert.equal(h.state.parentLineBinding.authProvider,'google');assert.equal(h.state.parentLineBinding.friendCheckedAt,record.friendCheckedAt);
  assert.equal(h.state.parentLineBinding.key,h.context.parentLineBindingKey());assert.equal(JSON.stringify(record),before);
 }
});

test('LINE binding eligibility is separate from Gmail pairing and never inferred from a friendship flag',async()=>{
 for(const [configured,bound,googleLinked] of [[true,true,false],[true,false,true],[false,true,true],[false,false,false]]){
  const h=fixture(),load=h.refresh();h.requests[0].resolve({configured,bound,googleLinked,authProvider:'line',friendStatus:'not_friend'});await load;
  assert.equal(h.state.parentLineBinding.lineBound,configured&&bound);assert.equal(h.state.parentLineBinding.bound,configured&&bound&&googleLinked);assert.equal(h.state.parentLineBinding.authProvider,'line');
 }
 for(const role of ['admin','teacher','unassigned']){const h=fixture();h.state.me.role=role;await h.refresh();assert.equal(h.requests.length,0)}
 const disabled=fixture();disabled.state.me.capabilities.lineAccount=false;await disabled.refresh();assert.equal(disabled.requests.length,0);
});

test('a late own-account result cannot repopulate a logged-out, replaced or different-school parent session',async()=>{
 for(const change of [h=>{h.state.me.schoolId='school-b';h.storage.set('school_context_id','school-b')},h=>{h.state.token='other-token';h.state.me.email='other@example.invalid'},h=>{h.state.me=null;h.state.parentLineBinding=null},h=>{h.state.parentLineBinding=null}]){
  const h=fixture(),load=h.refresh();change(h);h.requests[0].resolve({configured:true,bound:true,googleLinked:true,authProvider:'google',friendStatus:'not_friend'});await load;
  assert.notEqual(h.state.parentLineBinding?.friendStatus,'not_friend');assert.equal(h.renders(),0);
 }
 const h=fixture(),older=h.refresh(),newer=h.refresh();h.requests[1].resolve({configured:true,bound:true,googleLinked:true,authProvider:'google',friendStatus:'friend'});await newer;
 h.requests[0].resolve({configured:true,bound:true,googleLinked:true,authProvider:'google',friendStatus:'not_friend'});await older;assert.equal(h.state.parentLineBinding.friendStatus,'friend');
});

test('failed reads leave friendship unknown and BFCache status refresh keeps the current login epoch',async()=>{
 const h=fixture(),load=h.refresh();h.requests[0].reject(Error('offline'));await load;assert.equal(h.state.parentLineBinding.bound,null);assert.equal(h.state.parentLineBinding.friendStatus,undefined);
 h.events.pageshow({persisted:false});assert.equal(h.requests.length,1);
 h.events.pageshow({persisted:true});assert.equal(h.requests.length,2);h.requests[1].resolve({configured:true,bound:true,googleLinked:true,authProvider:'google',friendStatus:'friend'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.state.parentLineBinding.friendStatus,'friend');assert.equal(h.state.parentLineFriendPromptEpoch,0);
});

test('a refreshed non-home parent status asks the existing reminder to clear stale UI without rendering the page',async()=>{
 const h=fixture();h.state.page='record';let refreshes=0;h.context.window.parentLineFriendPrompt={refresh:()=>refreshes++};
 const load=h.refresh();h.requests[0].resolve({configured:true,bound:true,googleLinked:true,authProvider:'google',friendStatus:'friend'});await load;
 assert.equal(refreshes,1);assert.equal(h.renders(),0);
});

test('logout invalidates the reminder generation before another fixed LINE-session login',()=>{
 const code=app.slice(app.indexOf('function logout('),app.indexOf('function teacherLineAccountEntry(){'));
 const storage=new Map([['google_id_token','line-session'],['school_context_id','school-a'],['role_context','parent']]);
 const state={token:'line-session',me:{role:'parent'},parentLineBinding:{friendStatus:'not_friend'},parentLineFriendPromptEpoch:4};let resets=0;
 const context={state,apiRequestEpoch:0,pendingApiGets:new Map([['old',{}]]),window:{parentLineFriendPrompt:{reset:()=>resets++}},sessionStorage:{removeItem:key=>storage.delete(key)},renderLogin(){}};
 runInNewContext(code,context);context.logout(false);assert.equal(state.parentLineFriendPromptEpoch,5);assert.equal(resets,1);assert.equal(state.parentLineBinding,null);assert.equal(state.me,null);assert.equal(state.token,'');assert.equal(storage.size,0);assert.equal(context.pendingApiGets.size,0);
});
