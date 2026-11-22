import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../app/line-notification-settings.js',import.meta.url),'utf8');
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.dataset={};this.style={};this.hidden=false;this.disabled=false;this.textContent=''}
 append(...items){this.children.push(...items)}replaceChildren(...items){this.children=[...items]}
 addEventListener(type,fn){this.handlers[type]=fn}setAttribute(){}
 set innerHTML(_value){throw Error('Untrusted labels must use textContent')}
}
const descendants=node=>[node,...node.children.flatMap(child=>typeof child==='object'?descendants(child):[])];
const text=node=>descendants(node).map(n=>n.textContent).join(' ');
const bound={lineServiceConfigured:true,lineNotificationMode:'important_and_daily',lineTargetBound:true,lineTargetLabel:'幹部群組 <img onerror=alert(1)>',lineTargetBoundAt:'2026-11-22T12:00:00Z',lineAbsenceTargetBound:true,lineAbsenceTargetLabel:'學校老師群',lineAbsenceTargetBoundAt:'2026-11-22T11:00:00Z',webhookPath:'/api/line/webhook/sacred-heart'};
function harness(initial=bound){
 const host=new Node('div'),calls=[],changes=[],timers=new Map(),storage={school_context_id:'sacred-heart',role_context:'schoolAdmin',google_id_token:'cookie-session'};
 let settings={...initial},clock=Date.parse('2026-11-23T01:00:00Z'),accepted=true,timerId=0,nextResponse,confirmations=[];
 const create=runInNewContext(source.replace('export function createLineNotificationSettings','function createLineNotificationSettings')+';createLineNotificationSettings',{
  document:{createElement:tag=>new Node(tag),visibilityState:'visible'},sessionStorage:{getItem:key=>storage[key]||''},location:{origin:'https://lab.test'},URL,window:{confirm:()=>accepted},setTimeout,clearTimeout
 });
 const instance=create({host,api:async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,method:options.method||'GET',body});if(nextResponse){const value=await nextResponse(options,body);nextResponse=null;return value}
   if(options.method==='PATCH')settings.lineNotificationMode=body.lineNotificationMode;
   if(body?.action==='create_binding_code')return {...settings,bindingCode:'123456',bindingCodeExpiresAt:new Date(clock+15*60*1000).toISOString()};
   if(body?.action==='create_absence_binding_code')return {...settings,absenceBindingCode:'654321',absenceBindingCodeExpiresAt:new Date(clock+15*60*1000).toISOString()};
   if(body?.action==='unbind')settings.lineTargetBound=false;
   if(body?.action==='unbind_absence')settings.lineAbsenceTargetBound=false;
   return {...settings};},onChanged:async value=>changes.push(value),confirm:message=>{confirmations.push(message);return accepted},now:()=>clock,setTimer:fn=>{const id=++timerId;timers.set(id,fn);return id},clearTimer:id=>timers.delete(id)});
 const group=key=>descendants(host).find(n=>n.dataset.lineSettingsGroup===key);
 const button=(label,key)=>descendants(key?group(key):host).find(n=>n.tag==='button'&&n.textContent===label);
 return {instance,host,calls,changes,timers,storage,group,button,confirmations,setConfirm:value=>{accepted=value},setSettings:value=>{settings={...settings,...value}},setNow:value=>{clock=value},setResponse:fn=>{nextResponse=fn},async tick(){const [id,fn]=timers.entries().next().value||[];assert.ok(fn,'poll scheduled');timers.delete(id);await fn()}};
}
test('constructing and opening settings never writes or rebinds already-linked groups',async()=>{
 const h=harness();assert.equal(h.calls.length,0);await h.instance.load();
 assert.deepEqual(h.calls,[{path:'/api/line/settings',method:'GET',body:null}]);assert.equal(h.changes.length,0);assert.equal(h.timers.size,0);
 assert.match(text(h.host),/已綁定：幹部群組 <img onerror=alert\(1\)>/);assert.match(text(h.host),/已綁定：學校老師群/);
 assert.equal(h.button('產生群組綁定碼'),undefined);assert.match(text(h.host),/https:\/\/lab.test\/api\/line\/webhook\/sacred-heart/);
});
test('general group codes use the original six-digit binding command and survive GET polling until completion',async()=>{
 const h=harness({...bound,lineTargetBound:false,lineTargetBoundAt:''});await h.instance.load();await h.button('產生群組綁定碼','cadres').handlers.click();
 assert.deepEqual(h.calls.at(-1),{path:'/api/line/settings',method:'POST',body:{action:'create_binding_code'}});assert.match(text(h.group('cadres')),/#綁定通知 123456/);assert.equal(h.timers.size,1);
 await h.tick();assert.equal(h.calls.at(-1).method,'GET');assert.match(text(h.group('cadres')),/#綁定通知 123456/);
 h.setSettings({lineTargetBound:true,lineTargetLabel:'新幹部群',lineTargetBoundAt:'2026-11-23T01:02:00Z'});await h.tick();
 assert.doesNotMatch(text(h.host),/#綁定通知 123456/);assert.match(text(h.host),/已綁定：新幹部群/);assert.equal(h.timers.size,0);assert.equal(h.changes.at(-1).reason,'binding');
});
test('school absence binding uses its own action and expires without sending or unbinding anything',async()=>{
 const h=harness({...bound,lineAbsenceTargetBound:false});await h.instance.load();await h.button('產生群組綁定碼','school').handlers.click();
 assert.equal(h.calls.at(-1).body.action,'create_absence_binding_code');assert.match(text(h.group('school')),/#綁定通知 654321/);assert.doesNotMatch(text(h.group('cadres')),/654321/);
 h.setNow(Date.parse('2026-11-23T01:16:00Z'));await h.tick();assert.doesNotMatch(text(h.host),/#綁定通知/);assert.equal(h.timers.size,0);
 assert.deepEqual(h.calls.filter(c=>c.method!=='GET').map(c=>c.body.action),['create_absence_binding_code']);
});
test('test notifications and unbinding require explicit confirmation for the correct group',async()=>{
 const h=harness();await h.instance.load();h.setConfirm(false);
 await h.button('發送測試通知','school').handlers.click();await h.button('解除綁定','cadres').handlers.click();assert.equal(h.calls.length,1);
 h.setConfirm(true);await h.button('發送測試通知','school').handlers.click();assert.equal(h.calls.at(-1).body.action,'test_absence');assert.match(h.confirmations.at(-1),/學校老師群/);
 await h.button('解除綁定','cadres').handlers.click();assert.equal(h.calls.at(-1).body.action,'unbind');assert.match(text(h.host),/尚未綁定/);assert.match(text(h.group('school')),/已綁定：學校老師群/);
});
test('mode changes retain all four existing choices and use the same PATCH contract',async()=>{
 const h=harness();await h.instance.load();const select=descendants(h.host).find(n=>n.id==='centerLineNotificationMode');
 assert.deepEqual(select.children.map(n=>n.value),['important_and_daily','instant_only','daily_only','off']);select.value='daily_only';await select.handlers.change();
 assert.deepEqual(h.calls.at(-1),{path:'/api/line/settings',method:'PATCH',body:{lineNotificationMode:'daily_only'}});assert.equal(h.changes.at(-1).reason,'mode');
});
test('closing the settings tab stops pending-code polling and school changes reject old controls',async()=>{
 const h=harness({...bound,lineTargetBound:false});await h.instance.load();await h.button('產生群組綁定碼','cadres').handlers.click();const oldTest=h.button('發送測試通知','school');
 h.instance.setActive(false);assert.equal(h.timers.size,0);const count=h.calls.length;await oldTest.handlers.click();assert.equal(h.calls.length,count);
 h.instance.setActive(true);h.storage.school_context_id='school-b';await oldTest.handlers.click();assert.equal(h.calls.length,count);
 await h.instance.load();assert.doesNotMatch(text(h.host),/#綁定通知 123456/);assert.equal(h.calls.at(-1).method,'GET');h.instance.destroy();assert.equal(h.timers.size,0);assert.equal(h.host.children.length,0);
});
test('an in-flight response from another school cannot show old labels or trigger notification options refresh',async()=>{
 const h=harness();let resolve;h.setResponse(()=>new Promise(r=>{resolve=r}));const loading=h.instance.load();h.storage.school_context_id='school-b';resolve({...bound,lineTargetLabel:'old-school-private-label'});await loading;
 assert.doesNotMatch(text(h.host),/old-school-private-label/);assert.equal(h.changes.length,0);assert.equal(h.timers.size,0);
});
test('replacement code keeps the existing group active until the new binding completes',async()=>{
 const h=harness();await h.instance.load();await h.button('產生新的群組綁定碼','cadres').handlers.click();
 assert.match(text(h.group('cadres')),/已綁定：幹部群組/);assert.match(text(h.group('cadres')),/#綁定通知 123456/);await h.tick();assert.match(text(h.group('cadres')),/#綁定通知 123456/);
 h.setSettings({lineTargetLabel:'替代群組',lineTargetBoundAt:'2026-11-23T01:03:00Z'});await h.tick();assert.match(text(h.group('cadres')),/已綁定：替代群組/);assert.doesNotMatch(text(h.group('cadres')),/#綁定通知/);
});
test('busy state covers a pending settings mutation and prevents a second action',async()=>{
 const h=harness();assert.equal(h.instance.isBusy(),false);await h.instance.load();let finish;
 h.setResponse(()=>new Promise(resolve=>{finish=resolve}));
 const sending=h.button('發送測試通知','school').handlers.click();assert.equal(h.instance.isBusy(),true);
 const count=h.calls.length;await h.button('解除綁定','cadres').handlers.click();assert.equal(h.calls.length,count);
 finish({...bound,absenceTestSent:true});await sending;assert.equal(h.instance.isBusy(),false);
 assert.match(text(h.host),/學生缺席即時通知群組/);assert.match(text(h.host),/分部課、合奏課、綜合課與訓練／加練/);
});
