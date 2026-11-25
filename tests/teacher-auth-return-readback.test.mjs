import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {teacherCourseAccess} from '../api/src/lib/teacherAccountType.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const strip=source=>source.replace(/^import\s+[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
const app=read('app/app-v3.js'),guard=read('app/webview-guard.js');
const cookieTeacher={sub:'cookie-teacher-sub',email:'cookie-teacher@example.test',email_verified:true,name:'Cookie 老師'};
const popupTeacher={sub:'popup-teacher-sub',email:'popup-teacher@example.test',email_verified:true,name:'新登入老師'};
const otherIdentity={sub:'other-sub',email:'other@example.test',email_verified:true,name:'其他帳號'};

function serverFixture({cookieToken='correct-google-cookie'}={}){
 const verified=[],requests=[],directoryReads=[];let lineReads=0;
 const account={googleSub:cookieTeacher.sub,googleEmail:cookieTeacher.email,botUserId:'bot-a',lineUserId:'U'+'a'.repeat(32),parentEmail:'paired-teacher@line.invalid',displayName:'wen'};
 const tenants=new Map(['school-a','school-b'].map(school=>[school,{rowKey:school,status:'active',schoolName:school}]));
 const payloads=new Map([['correct-google-cookie',cookieTeacher],['fresh-popup-token',popupTeacher],['another-valid-raw',otherIdentity]]);
 const context={createHash,teacherCourseAccess,process:{env:{GOOGLE_CLIENT_ID:'configured-google-audience'}},console:{warn(){},error(){}},
  OAuth2Client:class {async verifyIdToken({idToken,audience}){verified.push(idToken);assert.equal(audience,'configured-google-audience');const payload=payloads.get(idToken);if(!payload)throw Error('expired or unverified Google credential');return {getPayload:()=>payload}}},
  tenantIdValue:value=>String(value||'').trim(),defaultTenantId:()=> 'school-a',ensureDefaultTenant:async()=>tenants.get('school-a'),ensureBootstrapGlobalAdmin:async()=>{},
  getTenantDirectory:async school=>tenants.get(school)||null,listTenantDirectory:async()=>[...tenants.values()],listTenantRolesByEmail:async()=>[],financeAssigned:async()=>false,
  getTeacherDirectory:async(email,school)=>{directoryReads.push({email,school});return school==='school-a'&&[cookieTeacher.email,popupTeacher.email].includes(email)?{status:'active',teacherName:email===cookieTeacher.email?'已建檔 Cookie 老師':'已建檔 Popup 老師'}:null},
  getTeacherProfile:async()=>({ensembleGroups:'["A"]'}),activeTeacherSupport:async()=>null,listStudentMaster:async()=>[],listUserStudentMappings:async()=>[],getMappedStudentsByEmail:async()=>[],
  tenantLineSession:async()=>{lineReads++;return {schoolId:'school-a',account}},tenantLineParentStudents:async()=>[],
  resolveTenantLineChannel:async()=>({loginConfigured:true,botUserId:'bot-a'}),getTenantGoogleLink:async(school,sub)=>school==='school-a'&&sub===cookieTeacher.sub?{...account}:null,
  tenantFeeEnabled:()=>false,saveUserIdentity:async()=>{},recordTeacherLogin:async()=>({created:false,result:'success'}),touchTeacherLastLogin:async()=>{}};
 const handlers={};context.app={http:(name,route)=>handlers[name]=route.handler};
 runInNewContext(strip(read('api/src/lib/auth.js'))+'\n'+strip(read('api/src/functions/me.js'))+';this.authorize=getAccess;',context);
 const cookie='orchestra_google_id_token='+cookieToken+'; __Host-school-line-session=confirmed-paired-line-session';
 async function invoke(url,options={}){
  const target=new URL(url,'https://school.example.test'),headers=new Headers({...options.headers,cookie}),request={headers,query:target.searchParams};requests.push({path:target.pathname,headers,method:options.method||'GET'});
  let response;
  if(target.pathname==='/api/me')response=await handlers.me(request);
  else if(target.pathname==='/api/students'){const access=await context.authorize(request);response={status:access.authenticated?200:401,jsonBody:access.students||[]}}
  else throw Error('unexpected request '+target.pathname);
  return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>response.jsonBody};
 }
 return {verified,requests,directoryReads,lineReads:()=>lineReads,invoke};
}

function browserFixture({server=serverFixture(),token='expired-explicit-raw',search='?google_redirect=1&teacherLineAccount=school-a&line_link=confirm',teacherHint=true}={}){
 const storage=new Map([['google_id_token',token],['school_context_id','school-a'],['role_context','teacher'],...(teacherHint?[['teacher_line_account_return','school-a']]:[])]);
 const location=new URL('https://school.example.test/'+search),histories=[],errors=[],renders=[],state={token:null,me:null,students:[],student:null,page:'home'};
 const context={state,URL,URLSearchParams,window:{getLineStaffEntry:()=>null},console:{warn(){}},location,
  sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  history:{replaceState:(_state,_title,target)=>{histories.push(target);location.href=new URL(target,location).href}},
  fetch:server.invoke,render:()=>renders.push(state.page),renderLogin:message=>errors.push(message),logout(){state.token='';state.me=null},loadAdmin:async()=>{throw Error('teacher return must not load administrator data')}};
 const prefix=guard.slice(guard.indexOf('  const current=new URL(location.href);'),guard.indexOf('  const staffMenuRoutes='));runInNewContext(prefix,context);
 state.token=storage.get('google_id_token')||'';
 const api=app.slice(app.indexOf('const pendingApiGets=new Map();'),app.indexOf('function logout('));
 const entries=app.slice(app.indexOf('function teacherLineAccountEntry(){'),app.indexOf('const schoolViewScript='));
 const profile=app.slice(app.indexOf('async function loadProfile(profile){'),app.indexOf('async function loadAdmin(){'));
 runInNewContext(api+'\n'+entries+'\n'+profile+';this.start=boot;',context);
 return {context,state,storage,location,server,histories,errors,renders,boot:()=>context.start()};
}

test('a Google-origin teacher callback selects its fresh cookie instead of an expired or unrelated raw token left in the return tab',async()=>{
 for(const token of ['expired-explicit-raw','another-valid-raw']){
  const h=browserFixture({token});assert.equal(h.storage.get('google_id_token'),'cookie-session');assert.equal(h.state.token,'cookie-session');assert.equal(h.location.searchParams.has('google_redirect'),false);assert.equal(h.location.searchParams.get('teacherLineAccount'),'school-a');assert.equal(h.location.searchParams.get('line_link'),'confirm');
  await h.boot();
  assert.equal(h.state.me.authProvider,'google');assert.equal(h.state.me.identityId,cookieTeacher.sub);assert.equal(h.state.me.email,cookieTeacher.email);assert.equal(h.state.me.role,'ensembleTeacher');assert.equal(h.state.page,'teacherHome');assert.equal(h.state.me.capabilities.teacherSettings,true);assert.deepEqual(h.errors,[]);
  assert.equal(h.storage.get('google_id_token'),'cookie-session');assert.equal(h.storage.get('role_context'),'teacher');assert.deepEqual(h.server.requests.map(call=>call.path),['/api/me','/api/students']);
  assert.equal(h.server.requests[0].headers.get('x-google-id-token'),null);assert.equal(h.server.requests[0].headers.get('x-school-id'),'school-a');assert.equal(h.server.requests[0].headers.get('x-role-context'),'teacher');
  assert.ok(h.server.verified.length>0);assert.equal(h.server.verified.every(value=>value==='correct-google-cookie'),true);assert.equal(h.server.lineReads(),0);assert.equal(h.renders.at(-1),'teacherHome');
 }
});

test('without a callback cookie-selection flag an expired explicit token fails closed instead of falling back to the correct cookie or paired LINE identity',async()=>{
 const h=browserFixture({search:'?teacherLineAccount=school-a&line_link=confirm'});assert.equal(h.storage.get('google_id_token'),'expired-explicit-raw');await h.boot();
 assert.equal(h.state.me,null);assert.notEqual(h.state.page,'teacherHome');assert.equal(h.errors.length,1);assert.match(h.errors[0],/Gmail/);assert.deepEqual(h.server.verified,['expired-explicit-raw']);assert.equal(h.server.lineReads(),0);assert.equal(h.server.directoryReads.length,0);
 assert.equal(h.server.requests.length,1);assert.equal(h.server.requests[0].headers.get('x-google-id-token'),'expired-explicit-raw');assert.equal(h.server.requests[0].method,'GET');
});

test('without the flag a different valid explicit account is checked as itself and cannot borrow the cookie teacher role',async()=>{
 const h=browserFixture({token:'another-valid-raw',search:'?teacherLineAccount=school-a&line_link=confirm'});await h.boot();
 assert.equal(h.state.me,null);assert.equal(h.errors.length,1);assert.match(h.errors[0],/Gmail/);assert.equal(h.server.verified.every(value=>value==='another-valid-raw'),true);assert.equal(h.server.verified.includes('correct-google-cookie'),false);assert.equal(h.server.lineReads(),0);assert.notEqual(h.state.page,'teacherHome');
});

test('a newly verified popup credential remains authoritative over a saved Google cookie during teacher recovery',async()=>{
 for(const cookieToken of ['correct-google-cookie','another-valid-raw','expired-cookie']){
  const server=serverFixture({cookieToken}),h=browserFixture({server,search:'?teacherLineAccount=school-a&line_link=confirm'});
  const callbackBlock=app.slice(app.indexOf('callback:async res=>{state.token=res.credential;'),app.indexOf('google.accounts.id.renderButton($("googleBtn")'));
  const callbackBody=callbackBlock.slice('callback:'.length,callbackBlock.lastIndexOf('});'));
  const retry=runInNewContext('('+callbackBody+')',h.context);await retry({credential:'fresh-popup-token'});
  assert.equal(h.state.token,'fresh-popup-token');assert.equal(h.storage.get('google_id_token'),'fresh-popup-token');assert.equal(h.state.me.authProvider,'google');assert.equal(h.state.me.identityId,popupTeacher.sub);assert.equal(h.state.me.email,popupTeacher.email);assert.equal(h.state.page,'teacherHome');assert.deepEqual(h.errors,[]);
  assert.equal(server.verified.every(value=>value==='fresh-popup-token'),true);assert.equal(server.lineReads(),0);assert.equal(server.requests[0].headers.get('x-google-id-token'),'fresh-popup-token');
 }
});

test('the callback flag selects a credential source only and cannot authorize another cookie identity or another school',async()=>{
 for(const options of [{server:serverFixture({cookieToken:'another-valid-raw'})},{server:serverFixture({cookieToken:'expired-cookie'})},{search:'?google_redirect=1&teacherLineAccount=school-b&line_link=confirm'}]){
  const h=browserFixture(options);await h.boot();assert.equal(h.state.me,null);assert.equal(h.errors.length,1);assert.match(h.errors[0],/Gmail/);assert.notEqual(h.state.page,'teacherHome');
  assert.equal(h.server.requests[0].headers.get('x-google-id-token'),null);assert.equal(h.server.requests.some(call=>call.path==='/api/students'),false);
 }
});

test('after a completed binding clears its return hint a fresh boot uses the canonical LINE teacher instead of demanding Google again',async()=>{
 const h=browserFixture({token:'line-session',search:'',teacherHint:false});assert.equal(h.context.teacherLineAccountEntry(),'');assert.equal(h.context.parentLineAccountEntry(),'');
 await h.boot();
 assert.equal(h.state.me.authProvider,'line');assert.equal(h.state.me.email,cookieTeacher.email);assert.equal(h.state.me.role,'ensembleTeacher');assert.equal(h.state.me.capabilities.teacherSettings,true);assert.equal(h.state.page,'teacherHome');assert.deepEqual(h.errors,[]);
 assert.equal(h.storage.get('google_id_token'),'line-session');assert.equal(h.storage.has('teacher_line_account_return'),false);assert.equal(h.location.search,'');assert.deepEqual(h.server.verified,[]);assert.ok(h.server.lineReads()>0);
 assert.deepEqual(h.server.requests.map(call=>call.path),['/api/me','/api/students']);assert.equal(h.server.requests[0].headers.get('x-google-id-token'),'line-session');assert.equal(h.renders.at(-1),'teacherHome');
});
