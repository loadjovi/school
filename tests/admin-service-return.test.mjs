import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const source=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8"),origin="https://school.example.invalid";
function harness({capabilities={lineAccount:true,feeCollections:true,financeVerifier:true},sessionSchool="school-a"}={}){
 const workspaceServices=runInNewContext(source.slice(source.indexOf(" const workspaceServices="),source.indexOf(" const accountTasks="))+";workspaceServices",{});
 const opens=[],errors=[],indicators={},frames={},rootClicks=[],messages=[],session=new Map(sessionSchool?[["school_context_id",sessionSchool]]:[]);
 const state={page:"admin",adminWorkspaceSection:"home",me:{role:"admin",email:"admin@example.test",schoolId:"school-a",capabilities},master:[{studentId:"one"}],registrations:[{id:"pending"}]};
 function frame(id,path){
  let src=path;const loads=[],assignments=[];
  const item={id,dataset:{},style:{},contentWindow:{location:{href:origin+path}},addEventListener(type,handler){if(type==="load")loads.push(handler)},get src(){return src},set src(value){src=value;assignments.push(value);this.contentWindow.location.href=value.startsWith("about:")?value:new URL(value,origin).href}};
  frames[id]=item;return {item,loads,assignments};
 }
 const line=frame("awLineServiceFrame","about:blank"),fees=frame("awFeesServiceFrame","about:blank"),finance=frame("awFinanceServiceFrame","about:blank"),uniform=frame("awUniformFrame","/uniform-event-admin.html?embedded=school");
 let uniformClick;uniform.item.contentDocument={getElementById:id=>({value:id==="configModule"?"calendarActivity":"competition"}),addEventListener(type,handler){if(type==="click")uniformClick=handler}};
 const document={getElementById:id=>frames[id],querySelector:selector=>{const key=selector.includes('"line"')?"line":selector.includes('"finance"')?"finance":"fees";return indicators[key]||=( {hidden:true})},addEventListener(type,handler){if(type==="click")rootClicks.push(handler)}};
 const scopeKey=()=>state.me.email+"|"+state.me.schoolId;
 const window={openSchoolAdminWorkspace:async group=>{opens.push(group);state.adminWorkspaceSection=group},addEventListener(type,handler){if(type==="message")messages.push(handler)}};
 const context={window,document,state,workspaceServices,scopeKey,sessionStorage:{getItem:key=>session.get(key)||"",setItem:(key,value)=>session.set(key,value)},URL,URLSearchParams,location:{origin},toast:value=>errors.push(value),api(){throw Error("return must not initialize APIs")},render(){throw Error("return must not rebuild app")},go(){throw Error("return must not reload app")}};
 const begin=source.indexOf(" function schoolServiceAllowed("),end=source.indexOf(" window.openSchoolAdminWorkspace=",begin);
 const helpers=runInNewContext(source.slice(begin,end)+";({schoolServiceAllowed,serviceEntryUrl,bindSchoolServiceFrame})",context);
 const clickStart=source.indexOf(" document.addEventListener('click',event=>{\n  if(event.defaultPrevented"),clickEnd=source.indexOf(" document.addEventListener('click',async e=>{",clickStart);
 runInNewContext(source.slice(clickStart,clickEnd),context);
 const messageStart=source.indexOf(" window.addEventListener('message',event=>{\n  const data=event.data,config=workspaceServices"),messageEnd=source.indexOf(" window.refreshSchoolAdminWorkspaceView=",messageStart);
 runInNewContext(source.slice(messageStart,messageEnd),context);
 const bindStart=source.indexOf(" function bindUniformFrameNavigation("),bindEnd=source.indexOf(" const setGroup=",bindStart);
 const bindUniform=runInNewContext(source.slice(bindStart,bindEnd)+";bindUniformFrameNavigation",context);bindUniform(uniform.item);uniform.loads[0]();
 const message=(service,data,extra={})=>messages[0]({origin,source:frames[workspaceServices[service].frameId].contentWindow,data:{service,schoolId:state.me.schoolId,...data},...extra});
 const click=(service,extra={})=>{
  const link={href:origin+workspaceServices[service].path,target:"",hasAttribute:()=>false,closest:()=>({dataset:{adminService:service}})};
  const event={button:0,prevented:false,preventDefault(){this.prevented=true},target:{closest:()=>link},...extra};rootClicks[0](event);return event;
 };
 return {window,state,line,fees,finance,uniform,opens,errors,indicators,session,scopeKey,helpers,message,click,context,uniformClick:()=>uniformClick};
}

test("opening and returning from finance, LINE or fees reuses the current workspace and frame without reloading main data",async()=>{
 for(const service of ["line","fees","finance"]){
  const h=harness(),frame=h[service],master=h.state.master,registrations=h.state.registrations;
  assert.equal(await h.window.openSchoolAdminService(service),true);assert.equal(frame.assignments.length,1);
  const url=new URL(frame.item.src);assert.equal(url.searchParams.get("embedded"),"school");assert.equal(url.searchParams.get("workspaceService"),service);assert.equal(url.searchParams.get("workspaceSchool"),"school-a");
  h.message(service,{type:"school-service-return"});assert.equal(h.opens.at(-1),"home");assert.equal(frame.assignments.length,1);
  await h.window.openSchoolAdminService(service);assert.equal(frame.assignments.length,1);assert.equal(frame.loads.length,1);assert.equal(h.state.master,master);assert.equal(h.state.registrations,registrations);assert.equal(h.errors.length,0);
 }
});
test("ordinary homepage clicks stay in the workspace while modified or new-tab links retain native behavior",async()=>{
 const h=harness();assert.equal(h.click("line").prevented,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.line.assignments.length,1);
 for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{button:2},{defaultPrevented:true}])assert.equal(h.click("fees",extra).prevented,false);
 assert.equal(h.fees.assignments.length,0);
});
test("service routes preserve feature gates, the verified school and safe destinations",async()=>{
 const denied=harness({capabilities:{}});assert.equal(await denied.window.openSchoolAdminService("line"),false);assert.equal(await denied.window.openSchoolAdminService("fees"),false);assert.equal(await denied.window.openSchoolAdminService("finance"),false);assert.equal(denied.opens.length,0);
 const staff=harness({capabilities:{lineRoleMenus:{staff:true}}});assert.equal(await staff.window.openSchoolAdminService("line"),true);
 const normal=harness();for(const href of ["https://other.example.invalid/line-announcement.html","/fee-collections.html","/line-announcement.html?fromActivity=calendarActivity:competition&activitySchool=other-school","/line-announcement.html?fromActivity=../escape&activitySchool=school-a"])assert.equal(await normal.window.openSchoolAdminService("line",href),false);
 const parent=harness();parent.state.me.role="parent";assert.equal(await parent.window.openSchoolAdminService("fees"),false);
 const implicit=harness({sessionSchool:""});assert.equal(await implicit.window.openSchoolAdminService("line"),true);assert.equal(implicit.session.get("school_context_id"),"school-a");
 const mismatched=harness({sessionSchool:"other-school"});assert.equal(await mismatched.window.openSchoolAdminService("line"),false);assert.equal(mismatched.line.assignments.length,0);
});
test("a disabled fee project cannot be reopened by a finance verifier",async()=>{
 const h=harness({capabilities:{feeCollections:false,financeVerifier:true}});assert.equal(await h.window.openSchoolAdminService('fees'),false);assert.equal(h.fees.assignments.length,0);assert.equal(h.opens.length,0);
});
test("only the active service from the same origin, frame, identity and school can return or resize",async()=>{
 const h=harness();await h.window.openSchoolAdminService("line");
 h.message("line",{type:"school-service-height",height:1450.2});assert.equal(h.line.item.style.height,"1451px");assert.equal(h.line.item.dataset.serviceLoading,"false");
 for(const height of [0,-1,Infinity,50001,"bad"])h.message("line",{type:"school-service-height",height});assert.equal(h.line.item.style.height,"1451px");
 const before=h.opens.length;
 h.message("line",{type:"school-service-return"},{origin:"https://other.example.invalid"});h.message("line",{type:"school-service-return"},{source:{}});h.message("line",{type:"school-service-return",schoolId:"other-school"});assert.equal(h.opens.length,before);
 h.state.me.email="different@example.test";h.message("line",{type:"school-service-return"});assert.equal(h.opens.length,before);
 h.state.me.email="admin@example.test";h.state.adminWorkspaceSection="attendance";h.message("line",{type:"school-service-return"});assert.equal(h.opens.length,before);
});
test("activity notification entry stays in the outer workspace and returns to the exact form without losing its draft",async()=>{
 const h=harness(),href=origin+"/line-announcement.html?fromActivity=calendarActivity:competition&activitySchool=school-a&returnMode=workspace";
 const link={href,target:"_top",hasAttribute:()=>false},event={button:0,prevented:false,preventDefault(){this.prevented=true},target:{closest:()=>link}};
 h.uniformClick()(event);assert.equal(event.prevented,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.opens.at(-1),"lineNotice");
 assert.equal(new URL(h.line.item.src).searchParams.get("fromActivity"),"calendarActivity:competition");
 h.message("line",{type:"school-service-return",activity:"calendarActivity:competition"});assert.equal(h.opens.at(-1),"uniformAdmin");assert.equal(h.uniform.assignments.length,0);
 await h.window.openSchoolAdminService("line",href);assert.equal(h.line.assignments.length,1);
 h.uniform.item.contentDocument={getElementById:()=>({value:"different"})};h.message("line",{type:"school-service-return",activity:"calendarActivity:competition"});assert.equal(h.uniform.assignments.length,1);assert.equal(new URL(h.uniform.item.src,origin).searchParams.get("activity"),"calendarActivity:competition");
});
test("forged activity returns cannot open a different form or a form from another service",async()=>{
 const h=harness();await h.window.openSchoolAdminService("line");const before=h.opens.length;
 for(const activity of ["calendarActivity:unrelated","https://other.example.invalid","calendarActivity:../escape"])h.message("line",{type:"school-service-return",activity});assert.equal(h.opens.length,before);
 await h.window.openSchoolAdminService("fees");const after=h.opens.length;h.message("fees",{type:"school-service-return",activity:"calendarActivity:competition"});assert.equal(h.opens.length,after);
});
test("cached in-frame root links are repaired once, while normal home returns preserve the tool",async()=>{
 const h=harness();await h.window.openSchoolAdminService("line");h.line.item.contentWindow.location.href=origin+"/";h.line.loads[0]();assert.equal(h.opens.at(-1),"home");assert.equal(h.line.item.src,"about:blank");
 h.line.loads[0]();assert.equal(h.opens.filter(group=>group==="home").length,1);await h.window.openSchoolAdminService("line");assert.equal(h.line.assignments.length,3);
});

test("finance navigation is separate from operations and rejects missing permissions and unsafe mode switches",async()=>{
 const h=harness(),operations=h.uniform.item.src;
 assert.equal(await h.window.openSchoolAdminService("finance"),true);
 assert.equal(h.opens.at(-1),"financeAdmin");assert.equal(h.uniform.item.src,operations);assert.equal(h.uniform.assignments.length,0);
 const url=new URL(h.finance.item.src);assert.equal(url.pathname,"/uniform-event-admin.html");assert.equal(url.searchParams.get("workspace"),"finance");
 for(const task of ["finance","accounts","notifications","activity-fees"]){
  const next=h.helpers.serviceEntryUrl("finance","/uniform-event-admin.html?workspace=finance&task="+task);assert.equal(next.searchParams.get("task"),task);
 }
 for(const href of ["/uniform-event-admin.html","/uniform-event-admin.html?workspace=finance&task=activity","https://other.example.invalid/uniform-event-admin.html?workspace=finance"]){
  assert.equal(await h.window.openSchoolAdminService("finance",href),false);
 }
 for(const capabilities of [{},{feeCollections:true},{financeVerifier:false},{financeVerifier:"true"}]){
  const denied=harness({capabilities});assert.equal(await denied.window.openSchoolAdminService("finance"),false);assert.equal(denied.finance.assignments.length,0);
 }
 h.state.me.role="parent";assert.equal(await h.window.openSchoolAdminService("finance"),false);
});
test("direct finance workspace calls cannot bypass the finance permission gate",async()=>{
 const h=harness({capabilities:{lineAccount:true}}),start=source.indexOf(" window.openSchoolAdminWorkspace=async"),end=source.indexOf(" window.openSchoolAdminActivitySettings=",start),calls=[];
 h.context.groups={home:["home"],financeAdmin:["finance"],uniformAdmin:["operations"]};h.context.inScope=()=>true;h.context.organize=()=>calls.push("organize");h.context.requestAnimationFrame=fn=>fn();h.context.window.scrollTo=()=>{};h.context.schoolServiceAllowed=h.helpers.schoolServiceAllowed;
 runInNewContext(source.slice(start,end),h.context);
 await h.window.openSchoolAdminWorkspace("financeAdmin");assert.equal(h.state.adminWorkspaceSection,"home");assert.equal(calls.length,0);
 h.state.me.capabilities.financeVerifier=true;await h.window.openSchoolAdminWorkspace("financeAdmin");assert.equal(h.state.adminWorkspaceSection,"financeAdmin");assert.ok(calls.length);
});
test("finance entry links in operations move to the dedicated frame while retaining the operations document",async()=>{
 const h=harness(),href=origin+"/uniform-event-admin.html?workspace=finance&task=accounts",link={href,target:"",hasAttribute:()=>false};
 const event={button:0,prevented:false,preventDefault(){this.prevented=true},target:{closest:()=>link}};
 h.uniformClick()(event);assert.equal(event.prevented,true);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.opens.at(-1),"financeAdmin");assert.equal(new URL(h.finance.item.src).searchParams.get("task"),"accounts");assert.equal(h.uniform.assignments.length,0);
});

test("LINE settings deep links stay in the existing school workspace and reject unsupported tabs",async()=>{
 const h=harness();assert.equal(await h.window.openSchoolAdminService("line","/line-announcement.html?tab=settings"),true);
 assert.equal(new URL(h.line.item.src,origin).searchParams.get("tab"),"settings");
 const assignments=h.line.assignments.length;
 assert.equal(await h.window.openSchoolAdminService("line","/line-announcement.html?tab=unknown"),false);
 assert.equal(h.line.assignments.length,assignments);
});
