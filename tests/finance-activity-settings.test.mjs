import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../app/finance-activity-settings.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.textContent=''}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=children}
 setAttribute(name,value){this.attributes[name]=value}
 addEventListener(name,handler){this.handlers[name]=handler}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const exports=runInNewContext(source.replace(/^export /gm,'')+';({financeActivityPayload,createFinanceActivitySettings})',{document:{createElement:tag=>new Element(tag)}});
const trip={module:'fieldTrip',id:'trip-1',title:'校外交流',location:'文化中心',startAt:'2027-01-03T04:00:00Z',endAt:'2027-01-04T04:00:00Z',openAt:'2026-12-01T00:00:00Z',closeAt:'2026-12-15T00:00:00Z',enabled:true,targetGroups:'A,B',studentFee:300,firstAdultFee:100,extraAdultFee:100,extraChildFee:0,paymentMode:'PAY_LATER',feeStatus:'DRAFT',paymentOpen:false,collectionOpen:false,updatedAt:'old',activityLineNotifications:{sent:2}};
const bank={id:'bank-a',label:'團費帳戶',active:true,bankName:'郵局',bankCode:'700',accountHolder:'弦樂團',accountNumber:'12345678901234'};

function harness({configs=[plain(trip)],accounts=[bank],bound=null}={}){
 const host=new Element('section'),calls=[],saved=[];let invalidReadback=false,failPost=false,hold=null;
 const state={configs:plain(configs),accounts:plain(accounts),bound:bound&&plain(bound)};
 const api=async(path,options={})=>{
  const method=options.method||'GET',body=options.body&&JSON.parse(options.body);calls.push({path,method,...(body?{body}:{})});
  if(hold)await hold;
  if(path==='uniform-events/config'){
   if(method==='GET')return {items:plain(state.configs)};
   if(failPost)throw Error('API unavailable');
   const index=state.configs.findIndex(item=>item.id===body.id&&item.module===body.module);state.configs[index]=plain(body);return {item:plain(body)};
  }
  if(path==='uniform-events/payment-account-templates')return {items:plain(state.accounts)};
  if(/-payment-account/.test(path)){
   if(method==='POST'){const {activityId,...value}=body;state.bound=value;return {saved:true}}
   return {item:state.bound?{...plain(state.bound),...(invalidReadback?{accountNumber:'999999999'}:{})}:null};
  }
  throw Error('Unexpected '+path);
 };
 const ui=exports.createFinanceActivitySettings({host,api,onSaved:async result=>{saved.push(plain(result))}});
 const byId=id=>descendants(host).find(node=>node.id===id);
 const field=name=>descendants(host).find(node=>node.name===name);
 return {host,calls,saved,state,ui,byId,field,submit:()=>byId('financeActivityForm').handlers.submit({preventDefault(){}}),edit:(name,value)=>{field(name).value=value},setAccount:value=>{byId('financeActivityAccount').value=value},setInvalidReadback:value=>{invalidReadback=value},setFailPost:value=>{failPost=value},setHold:value=>{hold=value}};
}

test('finance activity factory performs no reads, writes or DOM work before authorized load',()=>{
 const h=harness();assert.equal(h.calls.length,0);assert.equal(h.host.children.length,0);
});
test('existing paid activities alone are available; loading never creates a new activity',async()=>{
 const h=harness({configs:[trip,{module:'calendarActivity',id:'free',title:'演出'},{module:'regularUniform',id:'default'}]});await h.ui.load();
 assert.equal(h.byId('financeActivitySelect').children.length,1);assert.match(h.byId('financeActivitySelect').children[0].textContent,/校外交流/);
 assert.ok(h.calls.every(call=>call.method==='GET'));assert.equal(h.field('studentFee').value,'300');
 const empty=harness({configs:[]});await empty.ui.load();assert.ok(descendants(empty.host).some(node=>/尚無付費活動/.test(node.textContent)));assert.ok(!empty.byId('financeActivityForm'));
});
test('financial payload preserves dates, audience and metadata and enforces original dinner/field-trip state transitions',()=>{
 const fees={studentFee:350,firstAdultFee:100,extraAdultFee:100,extraChildFee:0};
 const payload=plain(exports.financeActivityPayload(trip,fees,true));
 assert.equal(payload.startAt,trip.startAt);assert.equal(payload.openAt,trip.openAt);assert.equal(payload.targetGroups,'A,B');assert.equal(payload.collectionOpen,true);assert.equal(payload.paymentOpen,true);assert.equal(payload.feeStatus,'PUBLISHED');assert.equal(payload.studentFee,350);assert.ok(!('updatedAt' in payload));assert.ok(!('activityLineNotifications' in payload));
 assert.throws(()=>exports.financeActivityPayload({...trip,enabled:false},fees,true),/開放家長報名/);
 const dinner=plain(exports.financeActivityPayload({...trip,module:'yearEndDinner',enabled:false},fees,true));assert.equal(dinner.enabled,true);assert.equal(dinner.paymentOpen,true);assert.equal(dinner.paymentMode,'PAY_NOW');
 assert.equal(exports.financeActivityPayload(dinner,fees,false).enabled,false);
 for(const value of [-1,1.5,NaN,Infinity,'100'])assert.throws(()=>exports.financeActivityPayload(trip,{...fees,studentFee:value},false),/整數/);
});
test('opening collection binds the selected account and verifies it before saving, preserving concurrently edited activity metadata',async()=>{
 const h=harness();await h.ui.load();h.state.configs[0].title='更新後名稱';h.state.configs[0].location='新地點';h.setAccount('bank-a');h.edit('studentFee','450');h.edit('paymentOpen','true');await h.submit();
 const writes=h.calls.filter(call=>call.method==='POST');assert.equal(writes.length,2);assert.match(writes[0].path,/field-trip-payment-account/);assert.equal(writes[0].body.activityId,'trip-1');assert.equal(writes[1].path,'uniform-events/config');
 const configIndex=h.calls.indexOf(writes[1]),bankIndex=h.calls.indexOf(writes[0]);assert.ok(h.calls.slice(bankIndex+1,configIndex).some(call=>call.method==='GET'&&/-payment-account/.test(call.path)));
 assert.equal(writes[1].body.title,'更新後名稱');assert.equal(writes[1].body.location,'新地點');assert.equal(writes[1].body.openAt,trip.openAt);assert.equal(writes[1].body.studentFee,450);assert.equal(writes[1].body.collectionOpen,true);assert.equal(h.saved.length,1);assert.match(h.byId('financeActivityStatus').textContent,/已儲存/);
});
test('opening without an account or entering invalid fees cannot mutate any data',async()=>{
 for(const scenario of ['missing-account','invalid-fee','unpublished-trip']){
  const h=harness();await h.ui.load();h.edit('paymentOpen','true');
  if(scenario!=='missing-account')h.setAccount('bank-a');
  if(scenario==='invalid-fee')h.edit('studentFee','');
  if(scenario==='unpublished-trip')h.state.configs[0].enabled=false;
  await h.submit();assert.equal(h.calls.filter(call=>call.method==='POST').length,0);assert.equal(h.saved.length,0);assert.match(h.byId('financeActivityStatus').textContent,/儲存未完成/);
 }
});
test('a concurrent fee change or account replacement stops the save before writes',async()=>{
 for(const scenario of ['fees','bank']){
  const h=harness({bound:bank});await h.ui.load();h.edit('studentFee','450');
  if(scenario==='fees')h.state.configs[0].studentFee=600;else h.state.bound.accountNumber='987654321';
  await h.submit();assert.equal(h.calls.filter(call=>call.method==='POST').length,0);assert.match(h.byId('financeActivityStatus').textContent,/已.*(?:更新|變更)/);
 }
});
test('bank readback mismatch stops config publishing and a rejected config save retains the draft',async()=>{
 const mismatch=harness({bound:bank});await mismatch.ui.load();mismatch.setAccount('bank-a');mismatch.edit('paymentOpen','true');mismatch.setInvalidReadback(true);await mismatch.submit();assert.equal(mismatch.calls.filter(call=>call.method==='POST').length,0);
 const failed=harness({bound:bank});await failed.ui.load();failed.edit('studentFee','520');failed.setFailPost(true);await failed.submit();assert.equal(failed.field('studentFee').value,'520');assert.equal(failed.byId('financeActivityForm').children.find(node=>node.tag==='button').disabled,false);assert.equal(failed.saved.length,0);
});
test('repeated submissions during a save issue one config mutation and never a second bank binding',async()=>{
 const h=harness({bound:bank});await h.ui.load();h.edit('studentFee','520');let release;h.setHold(new Promise(resolve=>{release=resolve}));const pending=h.submit();await h.submit();release();await pending;
 assert.equal(h.calls.filter(call=>call.method==='POST'&&call.path==='uniform-events/config').length,1);assert.equal(h.calls.filter(call=>call.method==='POST'&&/-payment-account/.test(call.path)).length,0);assert.equal(h.saved.length,1);
});
