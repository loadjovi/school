import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8"),source=read("app/fee-collections.js");
const stripped=source.replace(/^import .*;\n/gm,"").replace('if(!legacyLineEntry)load();','globalThis.loadFeePage=load;globalThis.feeState=state;');
function page({demo=true,accountOnly=false,role="admin",finance=true,deferMe=false}={}){
 const calls=[],rendered=[],flags=new Set([...(demo?["data-line-uat-fees"]:[]),...(accountOnly?["data-line-account"]:[])]);
 const nodes=Object.fromEntries(["siteName","roleTitle","roleIntro","originalFinanceLink","status","adminCreate","projects","lineBinding","projectKind","activityField","projectForm"].map(id=>[id,{textContent:"",innerHTML:"",className:"",hidden:id==="originalFinanceLink",value:id==="projectKind"?"TEAM_T":"",classList:{toggle(){}},addEventListener(){}}]));
 const profile={role,schoolId:"school-a",schoolName:"測試學校",capabilities:{feeCollections:true,lineAccount:true,financeVerifier:finance}};
 let releaseMe;
 const context={console,URLSearchParams,document:{title:accountOnly?"LINE 通知設定":"繳費與核帳紀錄",documentElement:{hasAttribute:name=>flags.has(name)},getElementById:id=>nodes[id]||null,addEventListener(){}},location:{hash:"",search:"",pathname:accountOnly?"/line-account.html":"/fee-collections.html",replace(){throw Error("Unexpected redirect")}},history:{replaceState(){}},sessionStorage:{getItem:()=>""},
  fetch:async(url,options)=>{
   calls.push({url,method:options.method||"GET"});
   let data=url==="/api/me"?profile:url==="/api/line/school-account"?{configured:true,bound:true,googleLinked:true,authProvider:"google",lineDisplayName:"測試家長"}:{items:[],dinnerActivities:[]};
   if(url==="/api/me"&&deferMe)await new Promise(resolve=>{releaseMe=resolve});
   return {ok:true,json:async()=>data};
  }};
 runInNewContext(stripped,context);
 const renderCreate=context.renderAdminCreate;
 context.renderAdminCreate=()=>rendered.push("create");context.renderProjects=()=>rendered.push("projects");
 return {context,nodes,calls,rendered,profile,releaseMe:()=>releaseMe?.(),load:()=>context.loadFeePage(),renderCreate};
}
test("LAB project identity is visible before private data arrives and remains separate from transient status messages",async()=>{
 const h=page({deferMe:true}),pending=h.load();
 assert.equal(h.context.document.title,"LAB 收費專案驗證（DEMO）");assert.equal(h.nodes.roleTitle.textContent,"LAB 收費專案驗證（DEMO）");assert.match(h.nodes.roleIntro.textContent,/測試用收費專案.*原財務流程/);assert.equal(h.nodes.originalFinanceLink.hidden,true);
 h.releaseMe();await pending;assert.equal(h.nodes.originalFinanceLink.hidden,false);assert.match(h.nodes.status.textContent,/已載入 0 個收費專案/);
 h.context.showStatus("已準備 DEMO 虛構收款帳戶及期末聚餐報名。請勿實際匯款。");assert.match(h.nodes.roleIntro.textContent,/實際團服／活動核帳請使用原財務流程/);
 assert.ok(h.calls.every(call=>call.method==="GET"));assert.deepEqual(h.rendered,["create","projects"]);
});
test("parents and non-finance admins see the DEMO explanation but cannot see the actual finance shortcut",async()=>{
 for(const input of [{role:"parent"},{finance:false}]){
  const h=page(input);await h.load();assert.equal(h.nodes.roleTitle.textContent,"LAB 收費專案驗證（DEMO）");assert.match(h.nodes.roleIntro.textContent,/測試用收費專案/);assert.equal(h.nodes.originalFinanceLink.hidden,true);
 }
 const html=read("app/fee-collections.html");assert.match(html,/id="originalFinanceLink"[^>]*href="\/uniform-event-admin.html\?task=finance"[^>]*target="_top"[^>]*hidden/);
});
test("unmarked project pages retain their existing title, data reads and role behavior",async()=>{
 for(const role of ["admin","parent"]){
  const h=page({demo:false,role});await h.load();assert.equal(h.nodes.roleTitle.textContent,role==="admin"?"收費專案與匯款核帳":"繳費與核帳紀錄");assert.equal(h.nodes.roleIntro.textContent,"測試學校");assert.equal(h.nodes.originalFinanceLink.hidden,true);
  assert.ok(h.calls.some(call=>call.url==="/api/fee-collections/projects"));assert.equal(h.calls.some(call=>call.url==="/api/uniform-events/payment-account-templates"),role==="admin");assert.ok(h.calls.every(call=>call.method==="GET"));
 }
});
test("the account-only page is unchanged even if a LAB fee marker is present",async()=>{
 const h=page({accountOnly:true,role:"parent"});await h.load();assert.equal(h.nodes.roleTitle.textContent,"LINE 通知設定");assert.equal(h.nodes.roleIntro.textContent,"測試學校");assert.deepEqual(h.calls.map(call=>call.url),["/api/me","/api/line/school-account"]);assert.equal(h.nodes.originalFinanceLink.hidden,true);assert.doesNotMatch(h.nodes.lineBinding.innerHTML,/DEMO|收費專案/);
});
test("creating DEMO fixtures remains opt-in and available only to marked-page finance admins",async()=>{
 for(const [input,expected] of [[{},true],[{finance:false},false],[{demo:false},false],[{accountOnly:true},false]]){
  const h=page(input);await h.load();h.renderCreate();assert.equal(h.nodes.adminCreate.innerHTML.includes('data-action="seed-demo-fee"'),expected);assert.equal(h.calls.some(call=>call.method!=="GET"),false);
 }
});
