import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../app/line-announcement.js',import.meta.url),'utf8');
function harness({role='admin',optionsError=false,search='?tab=settings'}={}){
 const calls=[],settingsLoads=[],active=[],events={},nodes={};
 for(const id of ['lineSendPanel','lineSettingsPanel','lineSendTab','lineSettingsTab','lineSettingsAuthStatus'])nodes[id]={hidden:id==='lineSettingsPanel',disabled:id==='lineSettingsTab',textContent:'',dataset:{lineCenterTab:id==='lineSendTab'?'send':'settings'},attrs:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this[k]=fn}};
 const status={textContent:''};let busy=false;
 const scope={centerAdminReady:false,centerTab:'send',groupSettings:{isBusy:()=>busy,setActive:value=>active.push(value),load:async()=>settingsLoads.push(calls.length)},$:id=>nodes[id],document:{querySelectorAll:()=>[nodes.lineSendTab,nodes.lineSettingsTab]},window:{addEventListener:(type,fn)=>events[type]=fn},location:{search},URLSearchParams,status,
  centerApi:async path=>{calls.push(path);return {role}},loadOptions:async()=>{if(optionsError)throw Error('尚未啟用公告功能')}};
 const code=source.slice(source.indexOf('async function selectCenterTab('),source.indexOf('function clearPreview()'));
 runInNewContext(code+';this.initialize=initializeCenter;this.select=selectCenterTab',scope);
 return {scope,nodes,status,calls,active,settingsLoads,events,setBusy:value=>busy=value};
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
