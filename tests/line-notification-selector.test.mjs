import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("app/line-announcement.html"),source=read("app/line-announcement.js");

// Run the complete page controller; only browser elements and HTTP are replaced.
class Element{
 constructor(tag="div"){this.tagName=tag.toUpperCase();this.value="";this.name="";this.checked=false;this.disabled=false;this.hidden=false;this.children=[];this.handlers={};this.textContent="";this.elements={}}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=[...children]}
 addEventListener(type,handler){this.handlers[type]=handler}
}
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key,value??true]));
async function page(){
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
 const options={groups:["A","B","新測試團"],schoolName:"測試學校",history:[],activities:[{key:"fieldTrip:one",title:"交流活動",bound:true,groupName:"交流志工"}]};
 const context={document:{getElementById:id=>elements[id],createElement:tag=>new Element(tag)},sessionStorage:{getItem:()=>""},console,crypto:{randomUUID:()=>"12345678-1234-1234-1234-123456789abc"},
  Option:class extends Element{constructor(text,value){super("option");this.textContent=text;this.value=value}},confirm:()=>true,
  fetch:async(url,init)=>{const body=init.body&&JSON.parse(init.body);if(body)calls.push(body);return {ok:true,json:async()=>body?{preview:"preview-hash",targetLabel:"確認的收件範圍",matched:2,deliverable:1,unbound:1}:options}}
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

test("dynamic multi-team members can add finance recipients explicitly, and edits invalidate the send preview",async()=>{
 const p=await page();p.choose("groupScope","selected");p.choose("group","A");p.choose("group","新測試團");p.choose("role","teacher");
 p.choose("includeStaff");p.choose("staffScope","finance");
 assert.equal(p.elements.staffPanel.hidden,false);assert.equal(p.elements.teams.hidden,false);
 assert.equal(p.elements.audienceSummary.textContent,"本次通知：A 團、新測試團的家長與老師；另通知本校財務幹部");
 p.elements.message.value="跨團通知";await p.submit();assert.deepEqual(p.calls[0].roles,["parent","teacher","finance"]);
 assert.deepEqual(p.calls[0].groups,["A","新測試團"]);assert.equal(p.calls[0].allSchool,false);
 p.choose("staffScope","all");assert.equal(p.elements.recipientPreview.hidden,true);await p.send();assert.equal(p.calls.length,1);
});

test("staff-only mode cannot carry previously checked parents, teachers, teams or activities into the payload",async()=>{
 const p=await page();p.choose("role","teacher");p.choose("groupScope","selected");p.choose("group","A");p.choose("includeStaff");
 p.elements.activityKey.value="fieldTrip:one";p.choose("audience","staff");p.choose("staffScope","finance");
 assert.equal(p.elements.memberPanel.hidden,true);assert.equal(p.elements.memberPanel.disabled,true);assert.equal(p.elements.includeStaffOption.hidden,true);
 assert.equal(p.elements.staffPanel.hidden,false);assert.equal(p.elements.activityKey.required,false);
 assert.equal(p.elements.messageLabel.textContent,"2．輸入訊息");assert.equal(p.elements.audienceSummary.textContent,"本次通知：本校財務幹部");
 p.elements.message.value="財務核對";await p.submit();assert.deepEqual(p.calls[0].roles,["finance"]);assert.deepEqual(p.calls[0].groups,[]);
 assert.equal(p.calls[0].audience,"members");assert.equal(p.calls[0].allSchool,true);assert.equal(p.calls[0].activityKey,"");
 p.choose("staffScope","all");await p.submit();assert.deepEqual(p.calls[1].roles,["staff"]);
});

test("activity-group mode sends only to the selected bound group, and switching back restores member scope",async()=>{
 const p=await page();p.choose("groupScope","selected");p.choose("group","新測試團");p.choose("includeStaff");p.choose("audience","activityGroup");
 p.elements.activityKey.value="fieldTrip:one";p.elements.announcement.handlers.input({target:p.elements.activityKey});
 assert.equal(p.elements.staffPanel.hidden,true);assert.equal(p.elements.memberPanel.hidden,true);assert.equal(p.elements.activityPanel.hidden,false);
 assert.equal(p.elements.activityKey.required,true);assert.equal(p.elements.audienceSummary.textContent,"本次通知：交流活動的「交流志工」群組");
 p.elements.message.value="志工集合";await p.submit();assert.equal(p.calls[0].audience,"activityGroup");assert.deepEqual(p.calls[0].roles,[]);
 assert.deepEqual(p.calls[0].groups,[]);assert.equal(p.calls[0].activityKey,"fieldTrip:one");
 p.choose("audience","members");assert.equal(p.elements.audienceSummary.textContent,"本次通知：新測試團的家長；另通知本校全體幹部（含財務幹部）");
 assert.equal(p.elements.activityPanel.disabled,true);assert.equal(p.elements.staffPanel.disabled,false);
});

test("all-team selection excludes retained team checks and incomplete member selections cannot preview",async()=>{
 const p=await page();p.choose("groupScope","selected");p.elements.message.value="公告";await p.submit();assert.equal(p.calls.length,0);
 assert.match(p.elements.result.textContent,/勾選一個團別/);p.choose("group","A");p.choose("groupScope","all");await p.submit();
 assert.deepEqual(p.calls[0].groups,[]);assert.equal(p.calls[0].allSchool,true);assert.equal(p.input("group","A").disabled,true);
 p.choose("role","parent",false);p.choose("includeStaff");await p.submit();assert.equal(p.calls.length,1);assert.match(p.elements.result.textContent,/家長或老師/);
});
