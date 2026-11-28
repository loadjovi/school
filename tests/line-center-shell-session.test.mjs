import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const workspace=readFileSync(new URL('../app/school-admin-workspace.js',import.meta.url),'utf8');
const center=readFileSync(new URL('../app/line-announcement.js',import.meta.url),'utf8');
const school='sacred-heart',origin='https://school.test',path='/line-announcement.html';
function fixture({token='cookie-session',provider='google',role='admin',frameSchool=school}={}){
 const window={},state={me:{schoolId:school,role,authProvider:provider},token},storage=new Map([['school_context_id',school],['role_context','schoolAdmin']]);
 const frameWindow={location:new URL(path+'?embedded=school&workspaceService=line&workspaceSchool='+frameSchool,origin)};
 const frame={contentWindow:frameWindow,dataset:{workspaceScope:'account|'+school}},calls=[];
 const scope={window,state,sessionStorage:{getItem:k=>storage.get(k)||null},workspaceServices:{line:{frameId:'frame',path}},scopeKey:()=>'account|'+state.me.schoolId,schoolServiceAllowed:()=>state.me.role==='admin',URL,location:{origin},
 document:{getElementById:()=>frame},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({role:'admin',schoolId:school})}}};
 runInNewContext(workspace.slice(workspace.indexOf(' window.schoolLineWorkspaceRequest='),workspace.indexOf(' function serviceEntryUrl(')),scope);
 return {window,state,storage,frameWindow,calls,scope,request:(p,o)=>window.schoolLineWorkspaceRequest(frameWindow,p,o)};
}
test('the embedded screen sends shell credentials with the selected school and does not accept caller headers',async()=>{
 for(const token of ['cookie-session','line-session','verified-test-token']){
  const h=fixture({token});
  assert.equal((await h.request('/api/me',{headers:{'X-Google-ID-Token':'wrong','X-School-Id':'other-school'}})).role,'admin');
  assert.equal(h.calls[0].url,'/api/me?includeStudentProfiles=1');
  assert.equal(h.calls[0].options.headers['X-Google-ID-Token'],token);
  assert.equal(h.calls[0].options.headers['X-Role-Context'],'schoolAdmin');
  assert.equal(h.calls[0].options.headers['X-School-Id'],school);
  assert.equal(h.calls[0].options.credentials,'same-origin');
 }
});
test('no foreign frame, school, role, or unapproved endpoint reaches the network',async()=>{
 for(const h of [fixture({role:'parent'}),fixture({frameSchool:'other-school'})]){
  await assert.rejects(h.request('/api/me'),{status:403});assert.equal(h.calls.length,0);
 }
 const h=fixture();
 await assert.rejects(h.window.schoolLineWorkspaceRequest({},'/api/me'),{status:403});
 for(const p of ['/api/students','/api/line/tenant-login/other-school/start','https://school.test/api/me'])
  await assert.rejects(h.request(p,{method:'POST',body:'{}'}),{status:403});
 await assert.rejects(h.request('/api/me',{method:'POST',body:'{}'}),{status:403});assert.equal(h.calls.length,0);
});
test('no session fallback on 401 and no response from a changed school/account context',async()=>{
 const missing=fixture({token:''});await assert.rejects(missing.request('/api/me'),{status:401});assert.equal(missing.calls.length,0);
 const failed=fixture();failed.scope.fetch=async()=>({ok:false,status:401,json:async()=>({})});await assert.rejects(failed.request('/api/me'),{status:401});
 const stale=fixture();stale.scope.fetch=async()=>({ok:true,json:async()=>{stale.state.token='changed';return {role:'admin'}}});
 await assert.rejects(stale.request('/api/me'),{status:403});
});
test('the center uses its same-origin shell only when embedded, not in an external or standalone window',async()=>{
 const body=center.slice(center.indexOf('function schoolLineWorkspaceTransport(){'),center.indexOf('async function request(body)'));
 const window={parent:{location:{origin},schoolLineWorkspaceRequest:(who,p)=>{assert.equal(who,window);return p}}};
 const f=runInNewContext(body+';schoolLineWorkspaceTransport',{window,location:{origin},embeddedCenterSchool:()=>school});
 assert.equal(f()('/api/me'),'/api/me');window.parent.location.origin='https://other.test';assert.equal(f(),null);window.parent=window;assert.equal(f(),null);
});

test('only the authenticated Gmail admin can read the browser cookie proof, never other routes or LINE sessions',async()=>{
 const h=fixture({token:'verified-test-token'});
 await h.request('/api/me',{requireBrowserGoogleSession:true});
 assert.equal(h.calls[0].options.headers['X-Google-ID-Token'],'cookie-session');
 await h.request('/api/line/school-account',{requireBrowserGoogleSession:true});
 assert.equal(h.calls[1].options.headers['X-Google-ID-Token'],'verified-test-token');
 const line=fixture({token:'line-session',provider:'line'});
 await assert.rejects(line.request('/api/me',{requireBrowserGoogleSession:true}),{status:403});assert.equal(line.calls.length,0);
});
