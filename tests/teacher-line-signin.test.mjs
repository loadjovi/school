import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {teacherCourseAccess} from '../api/src/lib/teacherAccountType.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const strip=source=>source.replace(/^import\s+[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
const app=read('app/app-v3.js'),guard=read('app/webview-guard.js');
const authSource=strip(read('api/src/lib/auth.js')),meSource=strip(read('api/src/functions/me.js'));
const teacherEmail='teacher@example.test',googleSub='canonical-teacher-sub';
const teacherRoles=new Set(['teacher','sectionTeacher','ensembleTeacher','comprehensiveTeacher','privateTeacher']);

function serverFixture({paired=true,active=true,canonical=true,channelMatches=true,sessionSchool='school-a',googleCookie=false}={}){
 const verified=[],directoryReads=[],requests=[];
 const account={botUserId:'bot-a',lineUserId:'U'+'a'.repeat(32),parentEmail:'teacher-line@line.invalid',displayName:'wen',...(paired?{googleSub,googleEmail:teacherEmail}:{})};
 const link={...account,...(!canonical?{lineUserId:'U'+'b'.repeat(32)}:{})};
 const tenants=new Map(['school-a','school-b'].map(school=>[school,{rowKey:school,status:'active',schoolName:school}]));
 const context={createHash,teacherCourseAccess,process:{env:{GOOGLE_CLIENT_ID:'configured-google-audience'}},console:{warn(){},error(){}},
  OAuth2Client:class {async verifyIdToken({idToken,audience}){verified.push(idToken);assert.equal(audience,'configured-google-audience');if(idToken!=='valid-teacher-cookie')throw Error('unverified Google credential');return {getPayload:()=>({sub:googleSub,email:teacherEmail,email_verified:true,name:'Google 老師名稱'})}}},
  tenantIdValue:value=>String(value||'').trim(),defaultTenantId:()=> 'school-a',ensureDefaultTenant:async()=>tenants.get('school-a'),ensureBootstrapGlobalAdmin:async()=>{},
  getTenantDirectory:async school=>tenants.get(school)||null,listTenantDirectory:async()=>[...tenants.values()],listTenantRolesByEmail:async()=>[],financeAssigned:async()=>false,
  getTeacherDirectory:async(email,school)=>{directoryReads.push({email,school});return email===teacherEmail&&school==='school-a'?{status:active?'active':'inactive',teacherName:'名冊老師姓名'}:null},
  getTeacherProfile:async()=>({ensembleGroups:'["A"]'}),activeTeacherSupport:async()=>null,
  listStudentMaster:async()=>[],listUserStudentMappings:async()=>[],getMappedStudentsByEmail:async()=>[],
  tenantLineSession:async()=>({schoolId:sessionSchool,account}),tenantLineParentStudents:async()=>[],
  resolveTenantLineChannel:async()=>({loginConfigured:true,botUserId:channelMatches?'bot-a':'different-bot'}),getTenantGoogleLink:async(school,sub)=>school===sessionSchool&&sub===googleSub?link:null,
  tenantFeeEnabled:()=>false,saveUserIdentity:async()=>{},recordTeacherLogin:async()=>({created:false,result:'success'}),touchTeacherLastLogin:async()=>{}};
 const handlers={};context.app={http:(name,entry)=>handlers[name]=entry.handler};
 runInNewContext(authSource+'\n'+meSource+';this.authorize=getAccess;',context);
 const cookie='__Host-school-line-session=verified-line-session'+(googleCookie?'; orchestra_google_id_token=valid-teacher-cookie':'');
 async function invoke(url,options={}){
  const target=new URL(url,'https://school.example.test'),headers=new Headers({...options.headers,cookie});const request={headers,query:target.searchParams};
  requests.push({path:target.pathname,headers});
  let response;
  if(target.pathname==='/api/me')response=await handlers.me(request);
  else if(target.pathname==='/api/students'){
   const access=await context.authorize(request);response={status:access.authenticated?200:401,jsonBody:access.students||[]};
  }else if(target.pathname==='/api/school-access-self')response={status:200,jsonBody:{allowed:false}};
  else if(target.pathname==='/api/school-options')response={status:200,jsonBody:{items:[]}};
  else throw Error('unexpected API '+target.pathname);
  return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>response.jsonBody};
 }
 return {context,account,link,verified,directoryReads,requests,invoke};
}

function browserFixture({server=serverFixture(),search='?line_session=school-a',pending='teacher',token='cookie-session',roleContext='teacher'}={}){
 const storage=new Map([['google_id_token',token],['school_context_id','school-a'],['role_context',roleContext],...(pending==='both'?[['teacher_line_account_return','school-a'],['parent_line_account_return','school-a']]:pending?[[pending+'_line_account_return','school-a']]:[])]);
 const location=new URL('https://school.example.test/'+search),histories=[],logins=[],renders=[],views=[],state={token:null,me:null,students:[],student:null,summary:null,practice:[],page:'home'};
 const context={state,URL,URLSearchParams,esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])),console:{warn(){}},window:{getLineStaffEntry:()=>null},
  sessionStorage:{getItem:key=>storage.get(key)||'',setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},location,
  history:{replaceState:(_state,_title,target)=>{histories.push(target);location.href=new URL(target,location).href}},
  fetch:server.invoke,render:()=>{renders.push(state.page);if(state.page==='home'&&state.me)views.push(context.home())},renderLogin:message=>logins.push(message),logout(){state.token='';state.me=null},
  loadAdmin:async()=>{throw Error('LINE teacher must not open administrator data')},loadSchoolViewModule:async()=>{throw Error('LINE teacher must not become school viewer')}};
 const prefix=guard.slice(guard.indexOf('  const current=new URL(location.href);'),guard.indexOf('  const staffMenuRoutes='));
 runInNewContext(prefix,context);state.token=storage.get('google_id_token')||'';
 const api=app.slice(app.indexOf('const pendingApiGets=new Map();'),app.indexOf('function logout('));
 const entries=app.slice(app.indexOf('function teacherLineAccountEntry(){'),app.indexOf('const schoolViewScript='));
 const profile=app.slice(app.indexOf('async function loadProfile(profile){'),app.indexOf('async function loadAdmin(){'));
 const home=app.slice(app.indexOf('function lineAccountRecoveryPanel(){'),app.indexOf('function calcMinutes('));
 runInNewContext(api+'\n'+entries+'\n'+profile+'\n'+home+';this.start=boot;',context);
 return {server,context,state,storage,location,histories,logins,renders,view:()=>views.at(-1)||'',boot:()=>context.start()};
}

test('fresh LINE callbacks discard stale Gmail return intent and enter the canonical active teacher home without a Google cookie',async()=>{
 for(const pending of ['teacher','parent','both'])for(const search of ['?line_session=school-a','?line_session=school-a&teacherLineAccount=school-b&parentLineAccount=school-c','?google_redirect=1&line_session=school-a&teacherLineAccount=school-b&parentLineAccount=school-c']){
  const h=browserFixture({pending,search});assert.equal(h.storage.get('google_id_token'),'line-session');assert.equal(h.storage.get('role_context'),undefined);
  assert.equal(h.storage.has('teacher_line_account_return'),false);assert.equal(h.storage.has('parent_line_account_return'),false);
  assert.equal(h.context.teacherLineAccountEntry(),'');assert.equal(h.context.parentLineAccountEntry(),'');
  await h.boot();
  assert.equal(h.state.me.authProvider,'line');assert.equal(h.state.me.email,teacherEmail);assert.equal(h.state.me.displayName,'名冊老師姓名');assert.equal(h.state.me.role,'ensembleTeacher');assert.equal(h.state.me.capabilities.teacherSettings,true);assert.equal(h.state.page,'teacherHome');assert.deepEqual(h.logins,[]);
  assert.equal(h.storage.get('google_id_token'),'line-session');assert.equal(h.storage.get('role_context'),undefined);assert.deepEqual(h.server.verified,[]);
  assert.deepEqual(h.server.requests.map(call=>call.path),['/api/me','/api/students']);assert.equal(h.server.requests[0].headers.get('x-google-id-token'),'line-session');assert.equal(h.server.requests[0].headers.get('x-role-context'),null);
  assert.equal(h.location.search,'');assert.equal(h.renders.at(-1),'teacherHome');
 }
});

test('an actual first-link teacher callback without line_session remains a Google-only confirmation path',async()=>{
 const denied=browserFixture({search:'?teacherLineAccount=school-a&line_link=confirm',pending:'teacher',token:'line-session'});
 assert.equal(denied.context.teacherLineAccountEntry(),'school-a');assert.equal(denied.storage.has('teacher_line_account_return'),true);await denied.boot();
 assert.equal(denied.state.me,null);assert.equal(denied.state.page,'home');assert.equal(denied.logins.length,1);assert.match(denied.logins[0],/Gmail/);assert.equal(denied.server.requests.length,1);assert.equal(denied.server.requests[0].headers.get('x-role-context'),'teacher');assert.equal(denied.server.requests[0].headers.get('x-google-id-token'),null);assert.equal(denied.location.search.includes('line_link=confirm'),true);
 const allowed=browserFixture({server:serverFixture({googleCookie:true}),search:'?teacherLineAccount=school-a&line_link=confirm',pending:'teacher',token:'line-session'});await allowed.boot();
 assert.equal(allowed.state.me.authProvider,'google');assert.equal(allowed.state.me.email,teacherEmail);assert.equal(allowed.state.page,'teacherHome');assert.equal(allowed.storage.get('google_id_token'),'cookie-session');assert.equal(allowed.storage.get('role_context'),'teacher');assert.deepEqual(allowed.logins,[]);assert.ok(allowed.server.verified.length>0);
});

test('a confirmed LINE login never manufactures teacher privileges for unpaired, revoked or noncanonical accounts',async()=>{
 for(const options of [{paired:false},{active:false},{canonical:false},{channelMatches:false}]){
  const h=browserFixture({server:serverFixture(options),pending:'both'});await h.boot();
  assert.equal(teacherRoles.has(h.state.me?.role),false);assert.notEqual(h.state.page,'teacherHome');assert.equal(h.state.me?.capabilities?.teacherSettings,undefined);assert.deepEqual(h.server.verified,[]);
  assert.equal(h.server.requests.some(call=>/registration|master|directory/.test(call.path)),false);
  if(options.channelMatches!==false){
   assert.equal(h.state.me.authProvider,'line');assert.equal(h.state.me.role,'unassigned');assert.equal(h.state.page,'home');assert.match(h.view(),/連結既有平台帳號/);assert.doesNotMatch(h.view(),/id="rName"|id="rConsent"|送出綁定申請/);
   assert.equal(h.server.requests.some(call=>['/api/students','/api/school-options'].includes(call.path)),false);assert.equal(h.storage.get('role_context'),undefined);
  }
 }
});

test('a foreign-school LINE callback or role request cannot borrow an otherwise valid teacher pairing',async()=>{
 const server=serverFixture(),h=browserFixture({server,search:'?line_session=school-b',pending:'teacher'});await h.boot();
 assert.equal(teacherRoles.has(h.state.me?.role),false);assert.notEqual(h.state.page,'teacherHome');assert.equal(h.state.me?.capabilities?.teacherSettings,undefined);assert.equal(server.directoryReads.length,0);assert.deepEqual(server.verified,[]);
 const result=await server.context.authorize({headers:new Headers({'X-Google-ID-Token':'line-session','X-School-Id':'school-b','X-Role-Context':'teacher'})});
 assert.equal(result.role,'contextDenied');assert.equal(result.capabilities.teacherSettings,undefined);
});

test('an invalid LINE callback marker cannot clear a pending first-link intent or select a new school',()=>{
 for(const marker of ['../school-b','https://evil.invalid','School-A','']){
  const h=browserFixture({search:'?line_session='+encodeURIComponent(marker),pending:'teacher',token:'cookie-session'});
  assert.equal(h.storage.get('google_id_token'),'cookie-session');assert.equal(h.storage.get('school_context_id'),'school-a');assert.equal(h.storage.get('role_context'),'teacher');assert.equal(h.context.teacherLineAccountEntry(),'school-a');assert.equal(h.server.requests.length,0);
 }
});
