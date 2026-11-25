import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../app/line-announcement.js',import.meta.url),'utf8');
function harness({role='admin',optionsError=false,search='?tab=settings'}={}){
 const calls=[],settingsLoads=[],accountLoads=[],active=[],events={},nodes={},panels=[];
 for(const id of ['lineSendPanel','lineSettingsPanel','lineSendTab','lineSettingsTab','lineSettingsAuthStatus','lineAccountPanel','lineAccountTab'])nodes[id]={hidden:['lineSettingsPanel','lineAccountPanel'].includes(id),disabled:['lineSettingsTab','lineAccountTab'].includes(id),textContent:'',dataset:{lineCenterTab:id==='lineSendTab'?'send':id==='lineAccountTab'?'account':'settings'},attrs:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this[k]=fn}};
 const status={textContent:''};let busy=false;
 const scope={centerAdminReady:false,centerTab:'send',accountPanel:null,accountReturnHandled:false,centerVersion:0,loadingVersion:0,createLineAccountPanel:()=>{const panel={destroyed:false,isBusy:()=>busy,load:async params=>{accountLoads.push(params?.get('line_link')||params?.get('line_friend')||'load');return {configured:true,bound:false}},destroy(){this.destroyed=true}};panels.push(panel);return panel},history:{replaceState(){}},groupSettings:{isBusy:()=>busy,setActive:value=>active.push(value),load:async()=>settingsLoads.push(calls.length)},$:id=>nodes[id],document:{querySelectorAll:()=>[nodes.lineSendTab,nodes.lineSettingsTab,nodes.lineAccountTab]},window:{addEventListener:(type,fn)=>events[type]=fn},location:{search},URLSearchParams,status,
  centerApi:async path=>{calls.push(path);return {role}},loadOptions:async()=>{if(optionsError)throw Error('尚未啟用公告功能')}};
 const code=source.slice(source.indexOf('async function selectCenterTab('),source.indexOf('function clearPreview()'));
 runInNewContext(code+';this.initialize=initializeCenter;this.select=selectCenterTab',scope);
 return {scope,nodes,status,calls,active,settingsLoads,accountLoads,events,panels,setBusy:value=>busy=value};
}
test('settings are accessible after administrator verification even when announcement loading fails',async()=>{
 const h=harness({optionsError:true});await h.scope.initialize();
 assert.deepEqual(h.calls,['/api/me']);assert.deepEqual(h.settingsLoads,[1]);
 assert.equal(h.nodes.lineSettingsTab.disabled,false);assert.equal(h.nodes.lineSettingsPanel.hidden,false);assert.equal(h.nodes.lineSendPanel.hidden,true);
 assert.match(h.status.textContent,/尚未啟用公告/);
});
test('direct settings link never reads settings for a nonadministrator',async()=>{
 const h=harness({role:'parent'});await h.scope.initialize();
 assert.equal(h.settingsLoads.length,0);assert.equal(h.nodes.lineSettingsTab.disabled,true);assert.equal(h.nodes.lineSettingsPanel.hidden,true);
 assert.match(h.nodes.lineSettingsAuthStatus.textContent,/僅限本校管理員/);
});
test('notification center defaults to sending, switches panels locally, and stops setting polls when leaving',async()=>{
 const h=harness({search:''});await h.scope.initialize();assert.equal(h.settingsLoads.length,0);
 await h.scope.select('settings');assert.equal(h.settingsLoads.length,1);assert.equal(h.nodes.lineSettingsTab.attrs['aria-selected'],'true');
 await h.scope.select('send');assert.equal(h.nodes.lineSettingsPanel.hidden,true);assert.equal(h.nodes.lineSendPanel.hidden,false);assert.equal(h.active.at(-1),false);
 h.events.pagehide();assert.equal(h.active.at(-1),false);
});
test('tab changes wait for an in-flight binding or mode update to finish',async()=>{
 const h=harness();await h.scope.initialize();h.setBusy(true);await h.scope.select('send');
 assert.equal(h.nodes.lineSendPanel.hidden,true);assert.equal(h.nodes.lineSettingsPanel.hidden,false);
 h.setBusy(false);await h.scope.select('send');assert.equal(h.nodes.lineSendPanel.hidden,false);
});

test('the personal LINE account panel is handled locally and a binding return opens that panel',async()=>{
 const h=harness({search:'?tab=account&line_link=confirm'});await h.scope.initialize();
 assert.equal(h.nodes.lineAccountTab.disabled,false);assert.equal(h.nodes.lineAccountPanel.hidden,false);
 assert.equal(h.nodes.lineSendPanel.hidden,true);assert.deepEqual(h.accountLoads,['confirm']);
 await h.scope.select('send');assert.equal(h.nodes.lineAccountPanel.hidden,true);
});
test('nonadministrators cannot load the personal account tab through the administrator notification center',async()=>{
 const h=harness({role:'parent',search:'?tab=account'});await h.scope.initialize();
 assert.equal(h.accountLoads.length,0);assert.equal(h.nodes.lineAccountTab.disabled,true);assert.equal(h.nodes.lineAccountPanel.hidden,true);
});
test('a friendship check return opens and reads only the local account tab once',async()=>{
 for(const result of ['checked','unavailable','mismatch']){
  const h=harness({search:'?line_friend='+result});await h.scope.initialize();assert.equal(h.nodes.lineAccountPanel.hidden,false);assert.deepEqual(h.accountLoads,[result]);
  assert.equal(h.settingsLoads.length,0);await h.scope.select('send');await h.scope.select('account');assert.deepEqual(h.accountLoads,[result,'load']);
 }
});

test('a notification-center page restored from browser cache rechecks identity and automatically recreates and reads its account panel',async()=>{
 const h=harness({search:'?tab=account'});await h.scope.initialize();assert.equal(h.panels.length,1);assert.equal(h.accountLoads.length,1);
 h.events.pagehide();assert.equal(h.panels[0].destroyed,true);assert.equal(h.scope.centerAdminReady,false);assert.equal(h.nodes.lineAccountTab.disabled,true);
 h.events.pageshow({persisted:false});await new Promise(setImmediate);assert.equal(h.calls.length,1);
 h.events.pageshow({persisted:true});await new Promise(setImmediate);
 assert.equal(h.calls.length,2);assert.equal(h.panels.length,2);assert.equal(h.accountLoads.length,2);assert.equal(h.nodes.lineAccountPanel.hidden,false);assert.equal(h.nodes.lineAccountTab.disabled,false);
});

test('a cached notification center cannot restore an account panel after the returned identity loses its administrator role',async()=>{
 const h=harness({search:'?tab=account'});await h.scope.initialize();h.events.pagehide();
 h.scope.centerApi=async path=>{h.calls.push(path);return {role:'parent'}};
 h.events.pageshow({persisted:true});await new Promise(setImmediate);
 assert.equal(h.panels.length,1);assert.equal(h.accountLoads.length,1);assert.equal(h.scope.centerAdminReady,false);assert.equal(h.nodes.lineAccountTab.disabled,true);assert.match(h.nodes.lineSettingsAuthStatus.textContent,/僅限本校管理員/);
});
