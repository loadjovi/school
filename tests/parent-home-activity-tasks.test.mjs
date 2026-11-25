import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=name=>readFileSync(new URL("../app/"+name,import.meta.url),"utf8");
const now=Date.parse("2026-11-18T00:00:00Z");
const trip=(id,extra={})=>({id,module:"fieldTrip",enabled:true,targetGroups:"A",startAt:"2026-12-09T00:00:00Z",...extra});
const student={studentId:"1",name:"甲同學",groupName:"A團"};

function setup(){
 const session=new Map(),list={},documentEvents={},otherDialog={open:false},dialog={open:false,querySelector:()=>list,setAttribute(){},
  showModal(){this.open=true;this.opens=(this.opens||0)+1},close(){this.open=false}};
 const context={
  Date:class extends Date{static now(){return now}},
  sessionStorage:{getItem:key=>session.get(key),setItem:(key,value)=>session.set(key,value)},
  localStorage:{getItem:()=>null,setItem(){}},state:{me:{email:"p@example.invalid",role:"parent"},page:"home",student,students:[student]},
  home:()=>"",render:()=>{},refreshStudent:async()=>{},setTimeout:()=>1,clearTimeout(){},addEventListener(){},esc:value=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;"),
  document:{createElement:()=>dialog,body:{append(){}},querySelector:()=>otherDialog.open?otherDialog:dialog.open?dialog:null,
   addEventListener:(type,callback)=>documentEvents[type]=callback},getParentActivityRegistrations:()=>[]
 };
 context.window=context;
 for(const name of ["parent-activity-notice.js","parent-home-summary.js"])runInNewContext(read(name),context);
 return {context,dialog,list,otherDialog,documentEvents,session};
}

test("registration tasks follow the configured group, deadline, opening time and actual family registration",()=>{
 const {context}=setup(),tasks=context.parentActivityNotice.registrationTasks;
 const items=[trip("open",{openAt:"2026-11-18T00:00:00Z"}),trip("future",{openAt:"2026-11-18T00:00:01Z"}),
  trip("expired",{closeAt:"2026-11-18T00:00:00Z"}),trip("already"),trip("other",{targetGroups:"B"}),
  trip("old",{startAt:"2026-11-16T23:00:00Z"}),trip("hidden",{enabled:false}),
  trip("dinner",{module:"yearEndDinner",feeStatus:"PUBLISHED",paymentOpen:true}),
  trip("dinner-draft",{module:"yearEndDinner",feeStatus:"PUBLISHED",paymentOpen:false}),
  trip("calendar",{module:"calendarActivity",eventDate:"2026-12-09"})];
 assert.deepEqual(Array.from(tasks(items,[{kind:"fieldTrip",activityId:"already"}],[student],now),item=>item.id),["open","dinner"]);
 assert.equal(tasks(items,null,[student],now).length,0);
 assert.equal(tasks(items,[],[{...student,status:"inactive"}],now).length,0);
 assert.equal(tasks([trip("reserve",{targetGroups:"B,儲備團"})],[],[{...student,groupName:"C"}],now).length,1);
});

test("one home dialog links to each actionable item, survives renders, and can be reopened later",()=>{
 const {context,dialog,list}=setup();
 context.state.parentActivityConfigs=[trip("open",{title:"<活動>"}),trip("expired",{closeAt:"2026-11-18T00:00:00Z"})];
 context.state.parentTshirtSizes=[{...student},{studentId:"2",studentName:"乙同學",size:"M",schoolIssuedAt:"2026-11-17",received:false},
  {studentId:"3",size:"S"},{studentId:"4",size:"L",schoolIssuedAt:"2026-11-17",received:true,historicalIssued:true}];
 context.render();
 assert.equal(dialog.opens,1);
 assert.match(list.innerHTML,/activity=fieldTrip%3Aopen/);
 assert.match(list.innerHTML,/&lt;活動>/);
 assert.match(list.innerHTML,/studentId=1[^]*填寫尺寸/);
 assert.match(list.innerHTML,/studentId=2[^]*確認領取/);
 assert.doesNotMatch(list.innerHTML,/expired|studentId=[34]/);
 dialog.close();context.render();assert.equal(dialog.opens,1);
 context.showParentTasks();assert.equal(dialog.opens,2);
 context.getParentActivityRegistrations=()=>[{kind:"fieldTrip",activityId:"open"}];
 context.state.parentTshirtSizes=[];
 context.render();assert.equal(dialog.open,false);
 context.state.me.role="admin";context.showParentTasks();assert.equal(dialog.open,false);
});

test("activity tasks wait for another open modal without marking unseen tasks handled, then open after it closes",()=>{
 const {context,dialog,otherDialog,documentEvents,session}=setup();
 context.state.parentActivityConfigs=[trip("open",{title:"待報名活動"})];context.state.parentTshirtSizes=[];
 otherDialog.open=true;context.render();assert.equal(dialog.open,false);assert.equal(dialog.opens,undefined);assert.equal(session.size,0);
 otherDialog.open=false;documentEvents.close({target:otherDialog});assert.equal(dialog.open,true);assert.equal(dialog.opens,1);assert.equal(session.size,1);
 dialog.close();documentEvents.close({target:dialog});context.render();assert.equal(dialog.opens,1);
});

test("a direct activity link opens its rendered registration form even when the activity was read before",()=>{
 const source=read("parent-uniform-events.js");
 const openActivity=source.slice(source.indexOf("  function openActivity("),source.indexOf("  const history=hosts.history;"));
 const deepLink=source.slice(source.indexOf("  if(!window.__parentActivityDeepLinkHandled)"),source.indexOf(" }catch(e){for(const host of Object.values(hosts))"));
 const summary={focus(){this.focused=true},scrollIntoView(){this.scrolled=true}};
 const details={open:false,querySelector:()=>summary};
 const card={querySelector:()=>details,classList:{add(){}},scrollIntoView(){this.scrolled=true}};
 const cfg=[trip("open")],windows={};
 const context={window:windows,URLSearchParams,location:{search:"?view=performance&activity=fieldTrip%3Aopen"},cfg,
  activityNotice:{key:item=>item.module+":"+item.id,mark(){}},select:view=>{windows.view=view},
  document:{getElementById:id=>id==="activity_fieldTrip:open"?card:null},me:{},students:[student],drawNotice(){}};
 runInNewContext(openActivity+deepLink,context);
 assert.equal(windows.view,"performance");
 assert.equal(details.open,true);
 assert.equal(summary.focused,true);
 assert.equal(card.scrolled,true);
});
