import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('app/school-service-frame.js'),origin='https://school.example.invalid';
function child({service='line',framed=true,frameId,querySchool='school-a',sessionSchool='school-a',parentOrigin=origin,embedded=true,extra={}}={}){
 const messages=[],classes=new Set(),listeners={},windowListeners={},frames=[];let observed,contentHeight=850;
 const query=new URLSearchParams({embedded:embedded?'school':'',workspaceService:service,workspaceSchool:querySchool,...extra});
 const main={getBoundingClientRect:()=>({bottom:contentHeight})};
 const document={readyState:'loading',documentElement:{classList:{add:value=>classes.add(value)},dataset:{},scrollHeight:99999},body:{getBoundingClientRect:()=>({bottom:contentHeight})},querySelector:selector=>selector==='main'?main:null,addEventListener:(type,fn)=>{listeners[type]=fn}};
 const window={frameElement:framed?{id:frameId||({line:'awLineServiceFrame',fees:'awFeesServiceFrame'})[service]}:null,scrollY:0,requestAnimationFrame:callback=>frames.push(callback),addEventListener:(type,fn)=>{windowListeners[type]=fn}};
 window.parent=framed?{location:{origin:parentOrigin},postMessage:(data,target)=>messages.push({data,target})}:window;
 const location={origin,search:'?'+query,href:origin+(service==='fees'?'/fee-collections.html':'/line-announcement.html')+'?'+query};
 runInNewContext(source,{window,document,location,URL,URLSearchParams,sessionStorage:{getItem:()=>sessionSchool},ResizeObserver:class{constructor(callback){observed=callback}observe(){}}});
 const ready=()=>listeners.DOMContentLoaded?.();
 const flush=()=>{while(frames.length)frames.shift()()};
 const click=(href,options={})=>{
  const link=href?{href,id:options.id||({line:'backLink',fees:'feePlatformBack'})[service],target:options.target||'',hasAttribute:name=>name==='download'&&!!options.download}:null;
  const {id,target,download,...eventOptions}=options;
  const event={button:0,prevented:false,preventDefault(){this.prevented=true},target:{closest:()=>link},...eventOptions};listeners.click?.(event);return event;
 };
 return {messages,classes,document,window,ready,flush,click,resize:()=>observed?.(),windowEvent:type=>windowListeners[type]?.(),height:value=>{contentHeight=value}};
}

test('LINE and fee tools return through their verified parent workspace without native root navigation',()=>{
 for(const service of ['line','fees']){
  const h=child({service});assert.equal(h.classes.has('school-service-embedded'),true);assert.equal(h.document.documentElement.dataset.workspaceService,service);
  const event=h.click(origin+'/');assert.equal(event.prevented,true);assert.equal(h.messages.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.messages[0])),{data:{type:'school-service-return',service,schoolId:'school-a'},target:origin});
  assert.equal(h.click(origin+'/index.html',{id:'cachedBack'}).prevented,true);
 }
});

test('direct pages and untrusted frame/query combinations keep their original standalone navigation',()=>{
 for(const config of [{framed:false},{frameId:'unrelatedFrame'},{service:'unknown'},{embedded:false},{querySchool:'school-b'},{sessionSchool:''},{querySchool:'School-A',sessionSchool:'School-A'},{parentOrigin:'https://other.example.invalid'}]){
  const h=child(config);h.ready();h.flush();assert.equal(h.classes.size,0);assert.equal(h.click(origin+'/').prevented,false);assert.equal(h.messages.length,0);
 }
});

test('downloads, modified clicks, new tabs, external destinations and ordinary tool links remain native',()=>{
 const h=child();
 for(const options of [{download:true},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{button:2},{target:'_blank'},{defaultPrevented:true}])assert.equal(h.click(origin+'/',options).prevented,false);
 for(const href of [null,'https://other.example.invalid/',origin+'/line-account.html',origin+'/uniform-event-admin.html?activity=calendarActivity:one&activitySchool=school-a'])assert.equal(h.click(href,{id:'otherToolLink'}).prevented,false);
 assert.equal(h.messages.length,0);
 assert.equal(h.click(origin+'/',{target:'_top'}).prevented,true,'a legacy top-target back link still returns through the parent');
});

test('saved activity returns carry only the validated same-school activity identity',()=>{
 const h=child({extra:{fromActivity:'calendarActivity:competition',activitySchool:'school-a'}});assert.equal(h.classes.has('school-service-activity-return'),true);
 for(const [path,id] of [['/?adminActivity=calendarActivity%3Acompetition&activitySchool=school-a','backLink'],['/uniform-event-admin.html?activity=fieldTrip%3Aexchange&activitySchool=school-a','returnActivityAfterSend']]){
  assert.equal(h.click(origin+path,{id}).prevented,true);assert.match(h.messages.at(-1).data.activity,/^(calendarActivity:competition|fieldTrip:exchange)$/);assert.equal(h.messages.at(-1).data.schoolId,'school-a');
 }
});

test('foreign or malformed activity returns cannot change the parent destination',()=>{
 const h=child();
 for(const query of [{adminActivity:'calendarActivity:competition',activitySchool:'school-b'},{adminActivity:'https://other.example.invalid',activitySchool:'school-a'},{adminActivity:'calendarActivity:../private',activitySchool:'school-a'},{adminActivity:'calendarActivity:'+('a'.repeat(81)),activitySchool:'school-a'},{adminActivity:'calendarActivity:one'}])assert.equal(h.click(origin+'/?'+new URLSearchParams(query)).prevented,false);
 assert.equal(h.click(origin+'/uniform-event-admin.html?activity=calendarActivity:one&activitySchool=school-b',{id:'returnActivityAfterSend'}).prevented,false);
 assert.equal(h.messages.length,0);
 const fee=child({service:'fees'});assert.equal(fee.click(origin+'/?adminActivity=calendarActivity:one&activitySchool=school-a').prevented,false);assert.equal(fee.messages.length,0);
});

test('height updates coalesce, can shrink after a preview closes, and ignore the iframe viewport height',()=>{
 const h=child();h.ready();h.resize();h.windowEvent('load');assert.equal(h.messages.length,0);h.flush();assert.equal(h.messages.length,1);assert.equal(h.messages[0].data.type,'school-service-height');assert.equal(h.messages[0].data.height,852);
 h.resize();h.windowEvent('resize');h.flush();assert.equal(h.messages.length,1,'same natural height is not posted repeatedly');
 h.height(1600);h.resize();h.resize();h.flush();assert.equal(h.messages.length,2);assert.equal(h.messages[1].data.height,1602);
 h.height(420);h.resize();h.flush();assert.equal(h.messages.length,3);assert.equal(h.messages[2].data.height,422);
 h.height(20);h.resize();h.flush();assert.equal(h.messages[3].data.height,200);
 for(const message of h.messages){assert.equal(message.target,origin);assert.equal(message.data.schoolId,'school-a');assert.equal(message.data.service,'line')}
});

test('a hidden tool retains its measured height until it becomes visible again',()=>{
 const h=child();h.ready();h.flush();const count=h.messages.length;
 h.height(0);h.resize();h.flush();assert.equal(h.messages.length,count);
 h.height(850);h.resize();h.flush();assert.equal(h.messages.length,count);
 h.height(900);h.resize();h.flush();assert.equal(h.messages.at(-1).data.height,902);
});
test('both HTML pages load the scoped bridge while preserving their business modules and standalone links',()=>{
 assert.match(read('app/line-announcement.html'),/href="\/line-account.html" target="_top"/);
 const line=read('app/line-announcement.html'),fees=read('app/fee-collections.html'),css=read('app/school-service-frame.css');
 for(const html of [line,fees]){assert.match(html,/school-service-frame\.js\?v=20261123-service-return" defer/);assert.match(html,/school-service-frame\.css\?v=20261123-service-return/)}
 assert.match(line,/id="backLink" href="\/"/);assert.match(fees,/id="feePlatformBack" class="back" href="\/"/);
 assert.match(line,/type="module" src="\/line-announcement\.js\?v=20261122-simple-group-routing/);assert.match(fees,/type="module" src="\/fee-collections\.js\?v=20261122-single-parent-message/);
 assert.match(css,/html\.school-service-embedded body>header/);assert.match(css,/#functional-uat-banner/);assert.doesNotMatch(css,/#roleTitle/);
});
