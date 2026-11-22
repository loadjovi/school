import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../app/admin-operations.js',import.meta.url),'utf8');
function harness(){
 const calls=[],window={},state={me:{role:'admin'},page:'other'};
 const scope={state,window,document:{addEventListener(){},querySelector:()=>null},render(){},setTimeout(){},esc:value=>String(value??''),toast(){},api:async(path,options)=>{calls.push({path,options});return path.includes('mode=settings')?{emailNotificationsEnabled:true,emailServiceConfigured:true}:{items:[]}}};
 const code=source.replace('  const baseRender=render;','  window.testHooks={settingsHtml,ensureLoads};\n  const baseRender=render;');
 runInNewContext(code,scope);
 return {window,state,calls};
}
test('platform settings retains Email setup and removes duplicate LINE group controls',()=>{
 const h=harness();h.state.adminOps.settings={emailNotificationsEnabled:true,emailServiceConfigured:true};
 const html=h.window.testHooks.settingsHtml();
 assert.match(html,/系統通知設定/);assert.match(html,/個別課流程 Email 通知/);assert.match(html,/toggleAdminEmail/);assert.match(html,/Azure Email 服務/);
 assert.doesNotMatch(html,/LINE|Webhook|lineNotificationMode|群組綁定/);
});
test('opening general admin operations loads ordinary settings and follow-up without loading LINE settings',async()=>{
 const h=harness();h.window.testHooks.ensureLoads();await new Promise(resolve=>setImmediate(resolve));
 assert.ok(h.calls.some(call=>call.path==='/api/daily-followup?mode=settings'));
 assert.ok(h.calls.some(call=>call.path.startsWith('/api/daily-followup?date=')));
 assert.equal(h.calls.some(call=>call.path.startsWith('/api/line/')),false);
});
test('old platform-level LINE mutation globals are gone while Email and follow-up actions remain',()=>{
 const h=harness();
 for(const key of ['changeLineNotificationMode','createLineBindingCode','testLineNotification','unbindLineNotification','createLineAbsenceBindingCode','testLineAbsenceNotification','unbindLineAbsenceNotification','retryLineSettings'])assert.equal(h.window[key],undefined,key);
 for(const key of ['toggleAdminEmail','refreshAdminFollowup','changeAdminFollowupDate','retryAdminSettings','resendAdminPrivateLessonEmail'])assert.equal(typeof h.window[key],'function',key);
});
test('the Email switch still updates only the original Email settings endpoint',async()=>{
 const h=harness();await h.window.toggleAdminEmail(false);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/daily-followup?mode=settings');
 assert.equal(h.calls[0].options.method,'PATCH');assert.deepEqual(JSON.parse(h.calls[0].options.body),{emailNotificationsEnabled:false});
});
