import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const strip=source=>source.replace(/^import\s+[\s\S]*?;\r?\n/gm,"");
const source=read("app/parent-uniform-events.js");
const now=Date.parse("2026-11-21T09:00:00+08:00");
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
const child={studentId:"990101",name:"測試甲同學",groupName:"A"};
const calendar={module:"calendarActivity",id:"competition",title:"A 團全國賽｜賽事期間（實際賽程待公告）",enabled:true,targetGroups:"A,B",eventDate:"2026-12-09",endDate:"2026-12-10",timeLabel:"08:30 集合；實際賽程待公告",location:"基隆文化中心",note:"請帶樂器\n測試注意事項"};
const trip={module:"fieldTrip",id:"exchange",title:"其他交流活動",enabled:true,targetGroups:"ALL",startAt:"2026-12-05T00:00:00Z",endAt:"2026-12-05T04:00:00Z"};
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.className="";this.id="";this.hidden=false;this.open=false;this.ownText="";this.handlers={};this.attributes={};this.classList={add:name=>{this.className+=" "+name}}}
 get textContent(){return this.ownText+this.children.map(child=>child?.textContent??String(child)).join("")}
 set textContent(value){this.ownText=String(value);this.children=[]}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.ownText="";this.children=[...children]}
 setAttribute(name,value){this.attributes[name]=value}
 addEventListener(name,fn){this.handlers[name]=fn}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 querySelectorAll(selector){const [tag,cls]=selector.split(".");return this.descendants().filter(node=>node.tag===tag&&(!cls||node.className.split(" ").includes(cls)))}
 descendants(){return this.children.flatMap(child=>child instanceof Node?[child,...child.descendants()]:[])}
 focus(){this.focused=true}
 scrollIntoView(){this.scrolled=true}
}
function page({target="calendarActivity:competition",groupName="A",items=[trip,calendar]}={}){
 let meHandler;
 runInNewContext(strip(read("api/src/functions/me.js")),{
  app:{http:(_,entry)=>{meHandler=entry.handler}},json:(data,status=200)=>({data,status}),
  getAccess:async()=>({authenticated:true,authProvider:"line",role:"parent",schoolId:"school-a",displayName:"家長",students:[{...child,groupName}]}),tenantFeeEnabled:()=>false
 });
 const roots=Object.fromEntries(["inlineEventRegistration","inlinePerformanceRegistration","inlineHistory","newActivityNotice"].map(id=>{const node=new Node("div");node.id=id;return [id,node]}));
 const storage=new Map(),calls=[],selections=[];
 const context={Date:FixedDate,URLSearchParams,location:{search:"?view=performance&activity="+encodeURIComponent(target)},console,
  document:{getElementById:id=>Object.values(roots).flatMap(root=>[root,...root.descendants()]).find(node=>node.id===id)||null,createElement:tag=>new Node(tag)},
  sessionStorage:{getItem:()=>"school-a"},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
  select:view=>selections.push(view),
  parentApi:async path=>{
   calls.push(path);
   if(path==="me")return (await meHandler({query:new URLSearchParams()})).data;
   if(path==="uniform-events/config")return {items};
   if(path==="uniform-events/family-registration")return {items:[{id:"r1",kind:"fieldTrip",activityId:"exchange",registrationStatus:"REGISTERED",paymentStatus:"VERIFIED",studentIds:[child.studentId],adults:1,extraChildren:0}]};
   throw Error("Unexpected endpoint "+path);
  },appendActivityFeeBreakdown(){},appendActivityPayment:async()=>{},activityPaymentLabel:()=>"已確認入帳"
 };context.window=context;
 runInNewContext(read("app/parent-activity-notice.js"),context);
 runInNewContext(source.slice(source.indexOf("function formatDate("),source.indexOf("async function parentApi(")),context);
 runInNewContext(source.slice(source.indexOf("async function renderInlineActivities(){"),source.lastIndexOf("\nrenderInlineActivities();")),context);
 return {context,roots,calls,selections,render:()=>context.renderInlineActivities(),card:key=>context.document.getElementById("activity_"+key)};
}

test("a LINE parent's free-activity link renders and opens the exact authorized calendar announcement",async()=>{
 const p=page();await p.render();const card=p.card("calendarActivity:competition");
 assert.ok(card,"the child-scoped calendar announcement must not disappear for LINE login");
 assert.match(card.textContent,/A 團全國賽｜賽事期間（實際賽程待公告）/);
 assert.match(card.textContent,/2026-12-09～2026-12-10/);assert.match(card.textContent,/基隆文化中心/);
 assert.match(card.textContent,/免報名・免繳費/);assert.match(card.textContent,/請帶樂器/);
 assert.equal(card.querySelector("details.activity-details").open,true);
 assert.equal(p.selections.at(-1),"performance");
 assert.doesNotMatch(card.textContent,/其他交流活動|匯款|費用明細/);
 assert.deepEqual(p.calls.sort(),["me","uniform-events/config","uniform-events/family-registration"].sort());
});

test("the selected free event is focused and highlighted even without optional notes",async()=>{
 const p=page({items:[trip,{...calendar,note:""}]});await p.render();const card=p.card("calendarActivity:competition");
 assert.equal(card.focused,true);assert.equal(card.scrolled,true);assert.match(card.className,/activity-selected/);
 assert.equal(card.querySelector("form"),null);assert.equal(p.card("fieldTrip:exchange").scrolled,undefined);
});

test("an unavailable, hidden or wrong-team target never silently becomes a different activity",async()=>{
 for(const options of [{target:"calendarActivity:missing"},{items:[trip,{...calendar,enabled:false}]},{items:[trip,{...calendar,targetGroups:"B"}]}]){
  const p=page(options);await p.render();assert.equal(p.roots.newActivityNotice.hidden,false);
  assert.match(p.roots.newActivityNotice.textContent,/找不到這筆活動/);assert.equal(p.roots.newActivityNotice.attributes.role,"alert");
  assert.equal(p.card("fieldTrip:exchange").scrolled,undefined);assert.notEqual(p.context.__parentActivityDeepLinkHandled,true);
 }
});

test("an unavailable direct target can be opened when authorized activity data becomes available on refresh",async()=>{
 const items=[trip],p=page({items});await p.render();assert.match(p.roots.newActivityNotice.textContent,/找不到這筆活動/);
 items.push(calendar);await p.render();const card=p.card("calendarActivity:competition");
 assert.ok(card);assert.equal(card.scrolled,true);assert.equal(card.querySelector("details.activity-details").open,true);
 assert.equal(p.context.__parentActivityDeepLinkHandled,true);assert.equal(p.roots.newActivityNotice.attributes.role,"status");
 assert.doesNotMatch(p.roots.newActivityNotice.textContent,/找不到這筆活動/);
});

test("an existing registration link still opens that specific paid activity without selecting the free event",async()=>{
 const p=page({target:"fieldTrip:exchange"});await p.render();const card=p.card("fieldTrip:exchange");
 assert.equal(card.scrolled,true);assert.match(card.textContent,/其他交流活動/);assert.match(card.textContent,/報名完成/);
 assert.equal(p.card("calendarActivity:competition").scrolled,undefined);
 assert.equal(p.card("calendarActivity:competition").querySelector("details.activity-details").open,false);
});
