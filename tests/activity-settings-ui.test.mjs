import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../app/uniform-event-admin.js",import.meta.url),"utf8");
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const now=Date.now(),stamp=new Date(now-120000).toISOString();
const dinner={module:"yearEndDinner",id:"dinner",title:"DEMO 期末餐會",enabled:true,paymentOpen:true,feeStatus:"PUBLISHED",firstAdultFee:800,startAt:new Date(now+86400000).toISOString(),openAt:new Date(now-3600000).toISOString(),closeAt:new Date(now+3600000).toISOString(),activityLineNotifications:[{kind:"registration",status:"accepted",lastAttemptAt:stamp,accepted:2,failed:0,unbound:0,deliveryMode:"push"}]};
const calendar={module:"calendarActivity",id:"competition",title:"A 團全國賽",enabled:false,eventDate:"2026-11-30",location:"基隆文化中心"};
const renderSource=source.slice(source.indexOf("function activityLineNoticeHtml("),source.indexOf("function activityRegistrationRows("));

test("saved activities render together when a LINE notification has a real timestamp",()=>{
 const target={innerHTML:"",textContent:""};
 const render=runInNewContext(renderSource+";renderConfigSummary",{
  el:id=>id==="settings"?target:null,esc,configActivityTypes:new Set(["fieldTrip","yearEndDinner","calendarActivity"]),activityTypes:new Set(["fieldTrip","yearEndDinner"]),cachedFamilyRegistrations:[]
 });
 assert.doesNotThrow(()=>render([dinner,calendar]));
 assert.match(target.innerHTML,/已建立活動（2 筆）/);assert.match(target.innerHTML,/DEMO 期末餐會/);assert.match(target.innerHTML,/A 團全國賽/);
 assert.match(target.innerHTML,/受理 2 位/);assert.match(target.innerHTML,/台灣時間/);assert.match(target.innerHTML,/data-line-resend-id='dinner'/);
 assert.doesNotMatch(target.innerHTML,/目前尚無已儲存的活動/);
});

test("invalid notification dates cannot interrupt the rest of the saved activity list",()=>{
 const target={innerHTML:""};
 const render=runInNewContext(renderSource+";renderConfigSummary",{el:()=>target,esc,configActivityTypes:new Set(["yearEndDinner","calendarActivity"]),activityTypes:new Set(["yearEndDinner"]),cachedFamilyRegistrations:[]});
 assert.doesNotThrow(()=>render([{...dinner,activityLineNotifications:[{kind:"registration",status:"accepted",lastAttemptAt:"invalid-time"}]},calendar]));
 assert.match(target.innerHTML,/時間待確認/);assert.match(target.innerHTML,/A 團全國賽/);
});

test("the selected saved activity exposes its own resend action beside the save form",()=>{
 const target={hidden:true,innerHTML:""},module={value:"yearEndDinner"},selected={value:"dinner"};
 const elements={selectedActivityNotice:target,configModule:module,existingActivity:selected};
 const sync=runInNewContext(renderSource+";syncSelectedActivityNotice",{el:id=>elements[id],esc,savedConfigs:[dinner,calendar]});
 sync();assert.equal(target.hidden,false);assert.match(target.innerHTML,/DEMO 期末餐會/);assert.match(target.innerHTML,/data-line-resend-id='dinner'/);
 selected.value="competition";sync();assert.equal(target.hidden,true);assert.equal(target.innerHTML,"");
 module.value="calendarActivity";sync();assert.equal(target.hidden,false);assert.match(target.innerHTML,/暫不公開/);assert.doesNotMatch(target.innerHTML,/data-line-resend-id/);
 selected.value="";sync();assert.equal(target.hidden,true);assert.equal(target.innerHTML,"");
});

test("a hidden saved calendar announcement is described as unpublished and its setting is preserved",()=>{
 const code=source.slice(source.indexOf("function activitySavedMessage("),source.indexOf("function activityLineNoticeHtml("));
 const describe=runInNewContext(code+";activitySavedMessage"),before=JSON.stringify(calendar);
 assert.match(describe(calendar),/活動已儲存[\s\S]*暫不公開[\s\S]*家長端不顯示/);
 assert.doesNotMatch(describe(calendar),/已取消|已刪除/);assert.equal(JSON.stringify(calendar),before);
 assert.match(describe({...calendar,enabled:true}),/已公開給家長[\s\S]*已同步至家長行事曆/);
 assert.match(describe({...dinner,enabled:false},{bankSelected:true}),/暫不公開[\s\S]*收款帳戶已綁定/);
});

test("activity config loading populates the list even if unrelated family statistics cannot render",async()=>{
 const elements={settings:{innerHTML:""},status:{textContent:""},familyStatus:{textContent:""},familyRows:{textContent:""},requestsStatus:{textContent:""},stockStatus:{textContent:""}};
 const context={el:id=>elements[id],esc,configActivityTypes:new Set(["yearEndDinner","calendarActivity"]),activityTypes:new Set(["yearEndDinner"]),cachedFamilyRegistrations:[],savedConfigs:[],activeAdminTab:"settings",hasFinanceAccess:false,
  fetch:async()=>({ok:true,json:async()=>[]}),api:async path=>({items:path==="uniform-events/config"?[dinner,calendar]:[]}),syncConfig:()=>{},
  refreshFamilyStatistics:()=>{throw Error("unrelated family view failure")},renderUniformRequestAlerts:()=>{},
  CustomEvent:class{constructor(type){this.type=type}},dispatchEvent:()=>{},console:{warn:()=>{}}
 };context.window=context;
 const loadSource=source.slice(source.indexOf("async function load(){"),source.indexOf("async function start(){"));
 const load=runInNewContext(renderSource+loadSource+";load",context);await load();
 assert.match(elements.settings.innerHTML,/已建立活動（2 筆）/);assert.match(elements.settings.innerHTML,/DEMO 期末餐會/);assert.match(elements.settings.innerHTML,/A 團全國賽/);
});

test("the resend action also works from the selected-activity panel and the list shortcut receives focus",async()=>{
 const handlers={},calls=[],target={scrollIntoView(){this.scrolled=true},focus(){this.focused=true}},status={textContent:""};
 const elements={viewSavedActivities:{addEventListener:(_,fn)=>{handlers.jump=fn}},protectedAdminArea:{addEventListener:(_,fn)=>{handlers.click=fn}},settings:target,status};
 const start=source.indexOf('el("viewSavedActivities").addEventListener('),end=source.indexOf('window.addEventListener("paymentEmailStatesUpdated"',start);
 runInNewContext(source.slice(start,end),{el:id=>elements[id],savedConfigs:[dinner],confirm:()=>true,load:async()=>{},api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return {activityLineNotification:{status:"accepted",accepted:2,failed:0,unbound:0}}}});
 handlers.jump();assert.equal(target.scrolled,true);assert.equal(target.focused,true);
 const button={dataset:{lineResendModule:"yearEndDinner",lineResendId:"dinner"},disabled:false};
 await handlers.click({target:{closest:selector=>selector.includes("data-line-resend-id")?button:null}});
 assert.equal(calls.length,1);assert.equal(calls[0].path,"uniform-events/config");assert.equal(calls[0].body.action,"RESEND_LINE");assert.equal(calls[0].body.id,"dinner");assert.match(status.textContent,/受理 2 位/);
});
