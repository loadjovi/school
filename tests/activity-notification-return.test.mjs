import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const uniform=read("app/uniform-event-admin.js"),center=read("app/line-announcement.js"),workspace=read("app/school-admin-workspace.js");
const origin="https://school.example.invalid",school="school-a";
const item={module:"calendarActivity",id:"competition",title:"A 團全國賽",enabled:false,targetGroups:"A,B",eventDate:"2026-12-09",endDate:"2026-12-10",location:"基隆文化中心",eventType:"competition",note:"攜帶樂器"};
function sourceLink(embedded=true){
 const source=uniform.slice(uniform.indexOf("function activityNotificationLink("),uniform.indexOf("function syncSelectedActivityNotice("));
 return runInNewContext(source+";activityNotificationLink",{URLSearchParams,location:{search:embedded?"?embedded=school":""},sessionStorage:{getItem:()=>school}})(item);
}
function returnLinks(url){
 const elements={backLink:{href:"/",textContent:"返回學校後台"},returnActivityAfterSend:{hidden:true},activityReturnHint:{hidden:true}};
 const source=center.slice(center.indexOf("function setupActivityReturn("),center.indexOf("setupActivityReturn();"));
 runInNewContext(source+";setupActivityReturn()",{URLSearchParams,location:{search:new URL(url,origin).search},$:id=>elements[id]});return elements;
}
function workspaceEntry(url,{role="admin",schoolId=school,page="admin"}={}){
 const parser=workspace.slice(workspace.indexOf(" let activityEntryHandled=false;"),workspace.indexOf(" function organize(){"));
 const block=workspace.slice(workspace.indexOf("  const uniformFrame=root.querySelector('#awUniformFrame');"),workspace.indexOf("  const learningTask="));
 const context={bindUniformFrameNavigation(){},URLSearchParams,location:{search:new URL(url,origin).search},state:{me:{role,schoolId},page}};
 return runInNewContext(parser+";({get:activityWorkspaceEntry,mount:(root,group,activityEntry)=>{"+block+"}})",context);
}
function restoreForm(url,items=[item],verifiedSchool=school){
 const elements={configModule:{value:"yearEndDinner"},existingActivity:{value:"other"},configSaveFeedback:{textContent:""},config:{elements:{},scrollIntoView(){this.scrolled=true}}};
 for(const name of ["id","enabled","eventType","calendarTitle","calendarLocation","calendarTargetGroups","eventDate","endDate","timeLabel","startTime","endTime","note"])elements.config.elements[name]={value:""};
 let selectedTab=false,context;
 const populate=uniform.slice(uniform.indexOf("function populateActivity(){"),uniform.indexOf('el("configModule").addEventListener('));
 const restore=uniform.slice(uniform.indexOf("function restoreActivitySelection("),uniform.indexOf("async function start(){"));
 context={URLSearchParams,location:{search:new URL(url,origin).search},savedConfigs:items,el:id=>elements[id],syncConfig(){},updateActivityAudiencePreview(){},Event:class{constructor(type){this.type=type}},document:{querySelector:()=>({click(){selectedTab=true}})}};
 const functions=runInNewContext(populate+restore+";({populateActivity,restoreActivitySelection})",context);
 elements.existingActivity.dispatchEvent=()=>functions.populateActivity();
 const restored=functions.restoreActivitySelection(verifiedSchool);
 return {elements,restored,selectedTab};
}

test("an embedded free activity returns through the school workspace to the exact saved activity",()=>{
 const href=sourceLink(),outbound=new URL(href,origin);
 assert.equal(outbound.pathname,"/line-announcement.html");assert.equal(outbound.searchParams.get("fromActivity"),"calendarActivity:competition");
 assert.equal(outbound.searchParams.get("returnMode"),"workspace");assert.equal(outbound.searchParams.get("activitySchool"),school);
 const links=returnLinks(href);assert.equal(links.backLink.textContent,"← 返回原活動");assert.equal(links.returnActivityAfterSend.hidden,false);
 assert.equal(links.backLink.href,links.returnActivityAfterSend.href);
 const route=new URL(links.backLink.href,origin);assert.equal(route.pathname,"/");assert.equal(route.searchParams.get("adminActivity"),"calendarActivity:competition");
 const entry=workspaceEntry(route),frame={src:"about:blank",getAttribute(){return this.src}},root={querySelector:()=>frame};
 entry.mount(root,"uniformAdmin",entry.get());assert.equal(entry.get(),null,"a later workspace render must not force the activity to reopen");
 const source=new URL(frame.src,origin);assert.equal(source.pathname,"/uniform-event-admin.html");assert.equal(source.searchParams.get("embedded"),"school");
 assert.equal(source.searchParams.get("activity"),"calendarActivity:competition");assert.equal(source.searchParams.get("activitySchool"),school);
 const form=restoreForm(source);assert.equal(form.restored,true);assert.equal(form.selectedTab,true);assert.equal(form.elements.configModule.value,"calendarActivity");
 assert.equal(form.elements.existingActivity.value,"competition");assert.equal(form.elements.config.elements.calendarTitle.value,"A 團全國賽");
 assert.equal(form.elements.config.elements.enabled.value,"false");assert.equal(form.elements.config.elements.endDate.value,"2026-12-10");assert.equal(form.elements.config.scrolled,true);
});

test("a standalone activity returns directly to its own edit form without browser-history assumptions",()=>{
 const href=sourceLink(false),first=returnLinks(href),afterReload=returnLinks(href);
 assert.equal(first.backLink.href,afterReload.backLink.href);
 const route=new URL(first.backLink.href,origin);assert.equal(route.pathname,"/uniform-event-admin.html");assert.equal(route.searchParams.get("task"),"activity");
 const form=restoreForm(route);assert.equal(form.restored,true);assert.equal(form.elements.existingActivity.value,item.id);
});

test("the return route cannot select an activity in another school or open an administrative view for another role",()=>{
 const links=returnLinks(sourceLink()),route=new URL(links.backLink.href,origin);
 for(const options of [{schoolId:"school-b"},{role:"parent"},{role:"teacher"},{page:"home"}])assert.equal(workspaceEntry(route,options).get(),null);
 const direct=returnLinks(sourceLink(false)),form=restoreForm(direct.backLink.href,[item],"school-b");
 assert.equal(form.restored,false);assert.equal(form.selectedTab,false);assert.equal(form.elements.existingActivity.value,"other");
});

test("generic notification entry retains the work-home link and arbitrary return URLs are never used",()=>{
 const direct=returnLinks("/line-announcement.html");assert.equal(direct.backLink.href,"/");assert.equal(direct.returnActivityAfterSend.hidden,true);
 for(const from of ["https://outside.invalid","calendarActivity:../private","calendarActivity:abc&next=evil","calendarActivity:"+"x".repeat(81)]){
  const links=returnLinks("/line-announcement.html?"+new URLSearchParams({fromActivity:from,returnMode:"https://outside.invalid"}));
  assert.equal(links.backLink.href,"/");assert.equal(links.returnActivityAfterSend.hidden,true);
 }
 const valid=returnLinks("/line-announcement.html?"+new URLSearchParams({fromActivity:"calendarActivity:competition",returnMode:"https://outside.invalid"}));
 assert.equal(new URL(valid.backLink.href,origin).origin,origin);
});

test("a removed activity is identified explicitly rather than being mistaken for another selected activity",()=>{
 const form=restoreForm(returnLinks(sourceLink(false)).backLink.href,[]);assert.equal(form.restored,false);assert.equal(form.selectedTab,true);
 assert.match(form.elements.configSaveFeedback.textContent,/找不到原活動/);assert.equal(form.elements.config.scrolled,undefined);
});
