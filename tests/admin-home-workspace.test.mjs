import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8"),source=read("app/school-admin-workspace.js"),app=read("app/app-v3.js");
function jobs(capabilities={}){
 const start=source.indexOf(" const shortcuts="),end=source.indexOf(" const guideTasks=",start);
 return runInNewContext(source.slice(start,end)+";homeJobs",{state:{me:{capabilities}}});
}
function services(capabilities={},extra={},demo=false){
 const state={me:{role:"admin",capabilities},page:"admin",...extra};
 const start=app.indexOf("function tenantServicesEntry()"),end=app.indexOf("async function renderLogin(",start);
 const context={state,window:{},api(){},document:{documentElement:{hasAttribute:name=>demo&&name==='data-line-uat-fees'}},sessionStorage:{}};
 const render=runInNewContext(app.slice(start,end)+";tenantServicesEntry",context);
 return {render,state,window:context.window};
}
test("home offers two clear common jobs and five management jobs with the original destinations",()=>{
 const render=jobs(),primary=render(true),management=render(false);
 assert.equal((primary.match(/data-workspace-action=/g)||[]).length,2);
 assert.equal((management.match(/data-workspace-action=/g)||[]).length,5);
 for(const action of ["attendance","uniformAdmin"])assert.match(primary,new RegExp('data-workspace-action="'+action+'"'));
 for(const action of ["students","courses","privateLookup","accounts","grades"])assert.match(management,new RegExp('data-workspace-action="'+action+'"'));
 assert.doesNotMatch(primary+management,/onclick|→|›|CSV|20 分|LINE 綁定涵蓋/);
 assert.equal((primary.match(/aw-job-copy/g)||[]).length,2);assert.equal((management.match(/aria-hidden="true"/g)||[]).length,5);
});
test("LINE and fee jobs use real accessible links and retain their exact feature gates",()=>{
 const empty=services();assert.equal(empty.render(),"");
 const fees=services({feeCollections:true}).render();assert.match(fees,/data-admin-service="fees"/);assert.match(fees,/href="\/fee-collections.html"/);assert.doesNotMatch(fees,/data-admin-service="line"|核對匯款/);
 const finance=services({feeCollections:true,financeVerifier:true}).render();assert.match(finance,/核對匯款、處理補款與退費/);
 for(const cap of [{lineAccount:true},{lineRoleMenus:{staff:true}}]){const line=services(cap).render();assert.match(line,/data-admin-service="line"/);assert.match(line,/href="\/line-announcement.html"/);assert.doesNotMatch(line,/data-admin-service="fees"/)}
 const both=services({feeCollections:true,lineAccount:true}).render();assert.equal((both.match(/class="aw-job-link"/g)||[]).length,2);assert.doesNotMatch(both,/class="primary"|onclick=/);
});
test("no admin service is exposed during role bootstrap, on another admin page or inside teacher administration",()=>{
 const h=services({feeCollections:true,lineAccount:true});h.window.__roleLoaderActive=true;assert.equal(h.render(),"");h.window.__roleModulesReady=true;assert.match(h.render(),/aw-job-link/);
 h.state.page="students";assert.equal(h.render(),"");h.state.page="admin";h.state.teacherAdminOpen=true;assert.equal(h.render(),"");
});
test("LAB fee projects are removed from ordinary admin and parent entry points, while LINE remains available",()=>{
 const cap={feeCollections:true,lineAccount:true,financeVerifier:true},admin=services(cap,{},true);
 assert.doesNotMatch(admin.render(),/data-admin-service="fees"|收費與核帳/);assert.match(admin.render(),/data-admin-service="line"/);
 const parent=services(cap,{me:{role:"parent",capabilities:cap},page:"home"},true);
 assert.doesNotMatch(parent.render(),/fee-collections.html/);assert.match(parent.render(),/line-account.html/);
 assert.match(services(cap).render(),/data-admin-service="fees"/,'explicitly enabled non-DEMO schools retain their existing project module');
});
test("the real finance shortcut is shown only to finance verifiers and uses the original application review flow",async()=>{
 assert.doesNotMatch(jobs()(true),/data-admin-todo="finance"/);
 assert.match(jobs({financeVerifier:true})(true),/data-admin-todo="finance"[\s\S]*財務核帳/);
 const start=source.indexOf(" document.addEventListener('click',async e=>{"),end=source.indexOf(" document.addEventListener('click',e=>{",start),calls=[],frame={src:""};let handler;
 runInNewContext(source.slice(start,end),{document:{addEventListener:(_event,fn)=>{handler=fn},getElementById:()=>frame},window:{openSchoolAdminWorkspace:async group=>calls.push(group)},encodeURIComponent,toast:message=>{throw Error(message)}});
 await handler({preventDefault(){},target:{closest:()=>({dataset:{adminTodo:"finance"},hasAttribute:()=>false})}});
 assert.deepEqual(calls,["uniformAdmin"]);assert.match(frame.src,/uniform-event-admin.html\?embedded=school.*task=finance/);assert.doesNotMatch(frame.src,/fee-collections/);
 assert.match(source,/data-workspace-service-entry="fees" data-demo-fee-entry hidden>LAB 收費專案驗證（DEMO）/);
});
test("existing service nodes move once into the same common-job grid, and own LINE binding remains available in More",()=>{
 const start=source.indexOf("  const serviceHost=root.querySelector("),end=source.indexOf("  for(const [selector,visible]",start),nodes=[{dataset:{adminService:"fees"}},{dataset:{adminService:"line"}}],binding={hidden:true};let moves=0;
 const host={append(node){moves++;node.parentElement=this},querySelector:selector=>nodes.find(node=>selector.includes('"'+node.dataset.adminService+'"'))};
 const context={main:{querySelectorAll:()=>nodes},root:{querySelector:selector=>selector.includes("aw-primary-jobs")?host:binding}};
 runInNewContext('{'+source.slice(start,end)+'}',context);assert.equal(moves,2);assert.equal(binding.hidden,false);
 runInNewContext('{'+source.slice(start,end)+'}',context);assert.equal(moves,2);
 assert.match(source,/href="\/line-account.html" data-aw-line-binding/);
});
function todos({roleFinance=false,uniform=[],family=[],loading=false,error=false,registrations=[]}={}){
 const start=source.indexOf(" function todoHtml(){"),end=source.indexOf(" function mountGuide",start);
 return runInNewContext(source.slice(start,end)+";todoHtml()",{state:{me:{capabilities:{financeVerifier:roleFinance}},registrations},summary:{uniform,family,attendance:null,loadedAt:1,loading,error}});
}
test("actionable requests and items waiting on parents are separated without losing the original handlers",()=>{
 const html=todos({uniform:[{kind:"regularUniform",status:"PENDING"},{kind:"competitionUniform",acquisition:"PURCHASE",status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",amount:2625}]});
 assert.match(html,/data-admin-todo="tshirt"/);assert.match(html,/<h3>等待家長處理<\/h3>/);assert.match(html,/aw-todo-waiting" data-admin-todo="competitionPayment"/);
 assert.ok(html.indexOf('data-admin-todo="tshirt"')<html.indexOf("等待家長處理"));assert.doesNotMatch(html,/沒有待處理事項/);
 assert.match(todos({registrations:[{status:"pending"},{status:"approved"}]}),/家長綁定待審<\/span><b>1 筆/);
});
test("loading and failure remain unknown rather than falsely zero, and finance is capability gated",()=>{
 assert.match(todos({loading:true}),/其他功能可先使用/);assert.doesNotMatch(todos({loading:true}),/目前沒有待處理事項/);
 assert.match(todos({error:true}),/暫時無法讀取/);assert.doesNotMatch(todos({error:true}),/目前沒有待處理事項/);
 const uniform=[{kind:"regularUniform",status:"APPROVED",paymentStatus:"REPORTED_UNVERIFIED"}];assert.doesNotMatch(todos({uniform}),/匯款待核帳/);assert.match(todos({uniform,roleFinance:true}),/匯款待核帳<\/span><b>1 筆/);
});
test("mobile navigation keeps Home active while working and provides a consistent return action",()=>{
 const start=source.indexOf(" const previousNav=nav;"),end=source.indexOf(" const inScope=",start),state={me:{role:"admin"},page:"admin",adminWorkspaceSection:"uniformAdmin"},context={window:{},state,nav:()=>"legacy"};
 runInNewContext(source.slice(start,end),context);assert.match(context.nav(),/data-workspace-group="home" aria-current="page"/);assert.equal((context.nav().match(/<button/g)||[]).length,3);
 state.adminWorkspaceSection="tasks";assert.match(context.nav(),/data-workspace-group="tasks" aria-current="page"/);state.me.role="parent";assert.equal(context.nav(),"legacy");
 assert.match(source,/class="aw-workspace-back" data-workspace-group="home"/);
 const help=source.match(/<details class="aw-onboarding"[^>]*>/)?.[0];assert.ok(help);assert.doesNotMatch(help,/ open/);
});
