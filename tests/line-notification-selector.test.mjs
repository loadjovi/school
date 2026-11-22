import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("app/line-announcement.html"),source=read("app/line-announcement.js");

// Run the complete page controller; only browser elements and HTTP are replaced.
class Element{
 constructor(tag="div"){this.tagName=tag.toUpperCase();this.value="";this.name="";this.checked=false;this.disabled=false;this.hidden=false;this.children=[];this.handlers={};this.textContent="";this.elements={};this.style={}}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=[...children]}
 addEventListener(type,handler){this.handlers[type]=handler}
}
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key,value??true]));
async function page({recipients=[],recipientResults=[],accepted=1,failed=0,history=[],search=""}={}){
 const elements={},inputs=[],calls=[];
 for(const tag of html.matchAll(/<([a-z]+)\b([^>]*\bid="[^"]+"[^>]*)>/g)){
  const a=attrs(tag[2]),element=new Element(tag[1]);Object.assign(element,{id:a.id,hidden:!!a.hidden,disabled:!!a.disabled,value:a.value||"",name:a.name||""});elements[a.id]=element;
 }
 for(const tag of html.matchAll(/<input\b([^>]+)>/g)){
  const a=attrs(tag[1]),input=a.id?elements[a.id]:new Element("input");
  Object.assign(input,{type:a.type,name:a.name,value:a.value||"",checked:!!a.checked});inputs.push(input);
 }
 const form=elements.announcement;
 const candidates=()=>[...inputs,...elements.teams.children.flatMap(label=>label.children.filter(child=>child instanceof Element))];
 form.querySelectorAll=selector=>{
  if(selector==="input,select,textarea,button")return [...candidates(),...Object.values(elements).filter(element=>["SELECT","TEXTAREA","BUTTON"].includes(element.tagName))];
  const name=selector.match(/name="([^"]+)"/)?.[1];return candidates().filter(input=>input.name===name&&(!selector.includes(":checked")||input.checked));
 };
 form.querySelector=selector=>form.querySelectorAll(selector)[0]||null;
 form.elements.includeStaff=inputs.find(input=>input.name==="includeStaff");
 const schoolGroups=[{key:"school:teachers",title:"學校群組",bound:true,groupName:"學校老師群",source:"settings",sourceLabel:"平台學生缺席通知群組"},{key:"school:cadres",title:"幹部群組",bound:true,groupName:"後援幹部群",source:"settings",sourceLabel:"平台後台待辦群組"},{key:"school:finance",title:"財務幹部群組",bound:true,groupName:"財務群",source:"center"}];
 const options={schoolGroups,groups:["A","B","新測試團"],schoolName:"測試學校",history,activities:[{key:"fieldTrip:one",title:"交流活動",bound:true,groupName:"交流志工"}]};
 const context={document:{getElementById:id=>elements[id],createElement:tag=>new Element(tag)},sessionStorage:{getItem:()=>""},URLSearchParams,location:{search},console,crypto:{randomUUID:()=>"12345678-1234-1234-1234-123456789abc"},
  Option:class extends Element{constructor(text,value){super("option");this.textContent=text;this.value=value}},confirm:()=>true,
  fetch:async(url,init)=>{const body=init.body&&JSON.parse(init.body);if(body)calls.push(body);return {ok:true,json:async()=>!body?options:body.action==="school-binding-code"?{code:"AABBCCDD11223344",expiresAt:"2026-12-01T00:00:00Z",groupTitle:"幹部群組"}:body.action==="send"?{accepted,failed,recipientResults,...(body.audience==="schoolGroups"?{deliveryMode:"group",groupAccepted:accepted,groupFailed:failed}:{})}:{...(body.audience==="schoolGroups"?{groupDeliverable:body.schoolGroupKeys.length,deliveryMode:"group"}:{}),preview:"preview-hash",targetLabel:"確認的收件範圍",matched:2,deliverable:recipients.length||1,unbound:1,recipients}}}
 };
 await runInNewContext("(async()=>{"+source+"})()",context);
 const input=(name,value)=>candidates().find(input=>input.name===name&&(value===undefined||input.value===value));
 const choose=(name,value,checked=true)=>{
  const target=input(name,value);assert.ok(target,"missing input "+name+" "+value);
  if(target.type==="radio")candidates().filter(x=>x.name===name).forEach(x=>{x.checked=false});
  target.checked=checked;form.handlers.input({target});
 };
 return {elements,calls,input,choose,submit:()=>form.handlers.submit({preventDefault(){}}),send:()=>elements.send.handlers.click()};
}

test("default member notice names the role and all-team scope, with only family/teacher role controls",async()=>{
 const p=await page();assert.equal(p.elements.staffPanel.hidden,true);assert.equal(p.elements.teams.hidden,true);
 assert.equal(p.elements.audienceSummary.textContent,"本次通知：所有團別的家長");
 assert.equal(p.input("role","staff"),undefined);assert.equal(p.input("role","finance"),undefined);
 p.elements.message.value="全團公告";await p.submit();
 assert.deepEqual(p.calls[0].roles,["parent"]);assert.deepEqual(p.calls[0].groups,[]);assert.equal(p.calls[0].allSchool,true);
 assert.equal(p.calls[0].activityKey,"");assert.equal(p.elements.recipientPreview.hidden,false);
 assert.equal(p.elements.staffPanel.disabled,true);assert.equal(p.elements.activityPanel.disabled,true);
});

test("dynamic multi-team members can also notify the existing school group and edits invalidate the send preview",async()=>{
 const p=await page();p.choose("groupScope","selected");p.choose("group","A");p.choose("group","新測試團");p.choose("role","teacher");
 p.choose("includeStaff");p.choose("staffScope","school");
 assert.equal(p.elements.staffPanel.hidden,false);assert.equal(p.elements.teams.hidden,false);
 assert.equal(p.elements.audienceSummary.textContent,"本次通知：A 團、新測試團的家長與老師；另通知學校群組「學校老師群」");
 p.elements.message.value="跨團通知";await p.submit();assert.deepEqual(p.calls[0].roles,["parent","teacher"]);assert.deepEqual(p.calls[0].schoolGroupKeys,["school:teachers"]);
 assert.deepEqual(p.calls[0].groups,["A","新測試團"]);assert.equal(p.calls[0].allSchool,false);
 p.choose("staffScope","all");assert.equal(p.elements.recipientPreview.hidden,true);await p.send();assert.equal(p.calls.length,1);
});

test("the original staff option sends to one existing group without member roles or new group-setting panels",async()=>{
 const p=await page();p.choose("role","teacher");p.choose("groupScope","selected");p.choose("group","A");p.choose("includeStaff");
 p.elements.activityKey.value="fieldTrip:one";p.choose("audience","staff");
 assert.equal(p.elements.memberPanel.hidden,true);assert.equal(p.elements.memberPanel.disabled,true);assert.equal(p.elements.includeStaffOption.hidden,true);
 assert.equal(p.elements.staffPanel.hidden,false);assert.equal(p.elements.activityKey.required,false);assert.equal(p.elements.messageLabel.textContent,"2．輸入訊息");
 assert.match(p.elements.audienceSummary.textContent,/幹部群組「後援幹部群」/);
 assert.equal(p.elements.schoolGroupPanel,undefined);assert.equal(p.elements.createSchoolGroupCode,undefined);assert.equal(p.elements.bindStaffGroup,undefined);
 p.elements.message.value="幹部公告";await p.submit();assert.deepEqual(p.calls[0].roles,[]);assert.deepEqual(p.calls[0].groups,[]);
 assert.equal(p.calls[0].audience,"schoolGroups");assert.deepEqual(p.calls[0].schoolGroupKeys,["school:cadres"]);assert.equal(p.calls[0].activityKey,"");
 assert.match(p.elements.deliveryHint.textContent,/多人 LINE 群組/);assert.doesNotMatch(p.elements.deliveryHint.textContent,/個人/);
 p.choose("staffScope","school");await p.submit();assert.deepEqual(p.calls[1].schoolGroupKeys,["school:teachers"]);assert.match(p.elements.audienceSummary.textContent,/學校老師群/);
});

test("activity-group mode sends only to the selected bound group, and switching back restores member scope",async()=>{
 const p=await page();p.choose("groupScope","selected");p.choose("group","新測試團");p.choose("includeStaff");p.choose("audience","activityGroup");
 p.elements.activityKey.value="fieldTrip:one";p.elements.announcement.handlers.input({target:p.elements.activityKey});
 assert.equal(p.elements.staffPanel.hidden,true);assert.equal(p.elements.memberPanel.hidden,true);assert.equal(p.elements.activityPanel.hidden,false);
 assert.equal(p.elements.activityKey.required,true);assert.equal(p.elements.audienceSummary.textContent,"本次通知：交流活動的「交流志工」群組");
 p.elements.message.value="志工集合";await p.submit();assert.equal(p.calls[0].audience,"activityGroup");assert.deepEqual(p.calls[0].roles,[]);
 assert.deepEqual(p.calls[0].groups,[]);assert.equal(p.calls[0].activityKey,"fieldTrip:one");
 p.choose("audience","members");assert.equal(p.elements.audienceSummary.textContent,"本次通知：新測試團的家長；另通知幹部群組「後援幹部群」");
 assert.equal(p.elements.activityPanel.disabled,true);assert.equal(p.elements.staffPanel.disabled,false);
});

test("all-team selection excludes retained team checks and incomplete member selections cannot preview",async()=>{
 const p=await page();p.choose("groupScope","selected");p.elements.message.value="公告";await p.submit();assert.equal(p.calls.length,0);
 assert.match(p.elements.result.textContent,/勾選一個團別/);p.choose("group","A");p.choose("groupScope","all");await p.submit();
 assert.deepEqual(p.calls[0].groups,[]);assert.equal(p.calls[0].allSchool,true);assert.equal(p.input("group","A").disabled,true);
 p.choose("role","parent",false);p.choose("includeStaff");await p.submit();assert.equal(p.calls.length,1);assert.match(p.elements.result.textContent,/家長或老師/);
});

const recipientNames=[{reference:"a123456789ab",name:"Roy"},{reference:"b123456789ab",name:"Eileen"}];
const content=element=>element.textContent+element.children.map(child=>typeof child==="string"?child:content(child)).join("");
test("preview lists individual bound accounts without claiming they can receive or have received a message",async()=>{
 const p=await page({recipients:recipientNames});p.elements.message.value="公告";await p.submit();
 assert.match(p.elements.previewCounts.textContent,/已綁定 2 個 LINE 帳號/);assert.doesNotMatch(p.elements.previewCounts.textContent,/可通知|已送達/);
 assert.match(content(p.elements.previewRecipients),/Roy.*尚未發送.*Eileen.*尚未發送/);assert.equal(p.elements.deliveryReport.hidden,true);
});

test("individual send results identify partial failure, retain the same retry request, and never claim receipt",async()=>{
 const recipientResults=recipientNames.map((entry,index)=>({...entry,status:index?"failed":"accepted",...(index?{httpStatus:400}:{})}));
 const p=await page({recipients:recipientNames,recipientResults,accepted:1,failed:1});p.elements.message.value="公告";await p.submit();await p.send();
 assert.match(p.elements.result.textContent,/API 已受理 1 人，失敗 1 人；實際收件待確認/);assert.equal(p.elements.deliveryReport.hidden,false);
 assert.match(content(p.elements.deliveryRecipients),/Roy.*API 已受理.*Eileen.*API 發送失敗/);assert.doesNotMatch(content(p.elements.deliveryRecipients),/已送達|已讀/);
 await p.send();const sends=p.calls.filter(call=>call.action==="send");assert.equal(sends.length,2);assert.deepEqual(sends[0],sends[1]);
 p.choose("role","teacher");assert.equal(p.elements.deliveryReport.hidden,true);
});

test("history distinguishes old multicast counts from new per-person acceptance records",async()=>{
 const results=recipientNames.map(entry=>({...entry,status:"accepted"}));
 const p=await page({history:[{label:"舊公告",audience:"members",accepted:2,failed:0,updatedAt:"2026-11-21",text:"文字"},{label:"新公告",audience:"members",accepted:2,failed:0,updatedAt:"2026-11-21",text:"文字",deliveryMode:"push",recipientResults:results}]});
 const history=content(p.elements.history);assert.match(history,/舊版批次紀錄，沒有逐人受理結果/);assert.match(history,/查看逐人結果/);
 assert.match(history,/Roy.*收件待確認.*Eileen.*收件待確認/);assert.doesNotMatch(history,/已送達|已讀/);
 assert.match(html,/LINE API 受理不代表實際收件/);
});

test("activity return links survive preview, send and notification-history refresh",async()=>{
 const p=await page({search:"?fromActivity=calendarActivity%3Acompetition&returnMode=workspace&activitySchool=school-a"});
 const before=p.elements.backLink.href;assert.match(before,/adminActivity=calendarActivity%3Acompetition/);
 assert.equal(p.elements.returnActivityAfterSend.href,before);assert.equal(p.elements.returnActivityAfterSend.hidden,false);
 p.elements.message.value="通知測試";await p.submit();await p.send();
 assert.equal(p.elements.backLink.href,before);assert.equal(p.elements.returnActivityAfterSend.href,before);
 assert.equal(p.calls.filter(call=>call.action==="send").length,1);
});
test("staff group previews and failures count the existing group rather than individual staff accounts",async()=>{
 const recipientResults=[{reference:"a123456789ab",name:"後援幹部群",kind:"group",status:"failed"}];
 const p=await page({accepted:0,failed:1,recipientResults});p.choose("audience","staff");p.elements.message.value="幹部公告";await p.submit();
 assert.match(p.elements.previewCounts.textContent,/1 個 LINE 群組/);assert.doesNotMatch(p.elements.previewCounts.textContent,/個帳號|個人/);await p.send();assert.match(p.elements.result.textContent,/API 已受理 0 個群組.*失敗 1 個群組/);
 assert.match(content(p.elements.deliveryRecipients),/群組｜後援幹部群.*發送失敗/);assert.deepEqual(p.calls.filter(x=>x.action==="send")[0].roles,[]);
});
test("the simple school and cadre choices invalidate old previews while preserving original activity group controls",async()=>{
 const p=await page();p.choose("audience","staff");p.elements.message.value="公告";await p.submit();assert.equal(p.calls.length,1);
 p.choose("staffScope","school");assert.equal(p.elements.recipientPreview.hidden,true);await p.send();assert.equal(p.calls.length,1);
 assert.equal(p.elements.createGroupCode.hidden,false);assert.equal(p.elements.activityPanel.hidden,true);assert.equal(p.input("staffScope","finance"),undefined);
 assert.doesNotMatch(html,/id="schoolBindingInstructions"|id="schoolGroupPanel"|id="refreshSchoolGroups"/);
});
