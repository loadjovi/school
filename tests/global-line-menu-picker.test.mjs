import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../app/global-tenant-admin.js",import.meta.url),"utf8");
const picker=source.slice(source.indexOf("  const globalLineMenuRequests="),source.indexOf("  function inlineAdminPanel("));
const parentId="richmenu-"+"a".repeat(32),staffId="richmenu-"+"b".repeat(32);
const config={schoolId:"school-a",parentMenuId:parentId,staffMenuId:staffId,menus:[
 {richMenuId:parentId,name:'家長 <script>bad</script>',areaCount:6},
 {richMenuId:staffId,name:"幹部",areaCount:6},
 {richMenuId:"richmenu-"+"c".repeat(32),name:"舊版",areaCount:3}
]};
function harness({global=true,reply=()=>config}={}){
 const calls=[],alerts=[],controls=[{disabled:false},{disabled:false}],panel={dataset:{},innerHTML:"",textContent:"",querySelectorAll:()=>controls};
 const nodes=new Map([["globalLineMenus_school-a",panel],["globalLineParentMenu_school-a",{value:parentId}],["globalLineStaffMenu_school-a",{value:staffId}]]);
 const window={alert:message=>alerts.push(message)};
 const context={window,document:{getElementById:id=>nodes.get(id)},canGlobal:()=>global,esc:value=>String(value).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("'","&#39;").replaceAll("<","&lt;").replaceAll(">","&gt;"),
  api:async(path,options)=>{calls.push({path,options});return reply(path,options)},Symbol,Map,Array,JSON,String,Number};
 runInNewContext(picker,context);
 return {window,calls,alerts,nodes,panel,controls,setGlobal:value=>global=value};
}

test("Global loads only the selected school's existing menus and escapes names",async()=>{
 const h=harness();await h.window.loadGlobalLineMenus("school-a");
 assert.deepEqual(h.calls.map(call=>call.path),["/api/line/tenant-config/school-a/menus"]);
 assert.equal(h.calls[0].options,undefined);
 assert.match(h.panel.innerHTML,/目前幹部選單/);assert.match(h.panel.innerHTML,new RegExp(staffId));
 assert.match(h.panel.innerHTML,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(h.panel.innerHTML,/<script>/);
 assert.match(h.panel.innerHTML,/<option[^>]+disabled[^>]*>舊版｜3 格/);
 assert.match(h.panel.innerHTML,/我的 LINE 綁定/);
});
test("menu picker guards reads and saves when Global capability is absent",async()=>{
 const h=harness({global:false});await h.window.loadGlobalLineMenus("school-a");await h.window.saveGlobalLineMenus("school-a");
 assert.equal(h.calls.length,0);assert.equal(h.panel.innerHTML,"");
});
test("explicit save sends only selected nonsecret IDs without assigning a user's menu",async()=>{
 const h=harness();await h.window.saveGlobalLineMenus("school-a");
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,"/api/line/tenant-config/school-a/menus");assert.equal(h.calls[0].options.method,"PATCH");
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{parentMenuId:parentId,staffMenuId:staffId});
 assert.match(h.panel.innerHTML,/已儲存此校選單設定/);assert.equal(h.panel.dataset.saving,"false");
});
test("missing staff or duplicate audience menu is rejected before any request",async()=>{
 for(const value of ["",parentId,"not-a-rich-menu"]){
  const h=harness();h.nodes.get("globalLineStaffMenu_school-a").value=value;
  await h.window.saveGlobalLineMenus("school-a");assert.equal(h.calls.length,0);assert.equal(h.alerts.length,1);
 }
});
test("parent menu may be deferred while a valid staff menu is saved",async()=>{
 const h=harness();h.nodes.get("globalLineParentMenu_school-a").value="";await h.window.saveGlobalLineMenus("school-a");
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{parentMenuId:"",staffMenuId:staffId});
});
test("failed save preserves choices and restores controls for retry",async()=>{
 const h=harness({reply:()=>{throw Error("選單不屬於此校官方帳號")}});await h.window.saveGlobalLineMenus("school-a");
 assert.deepEqual(h.alerts,["選單不屬於此校官方帳號"]);assert.equal(h.nodes.get("globalLineStaffMenu_school-a").value,staffId);
 assert.equal(h.panel.dataset.saving,"false");assert.ok(h.controls.every(control=>!control.disabled));
});
test("a delayed read cannot replace a newer selection or a detached school's panel",async()=>{
 let resolve;const pending=new Promise(done=>resolve=done),h=harness({reply:()=>pending});
 const old=h.window.loadGlobalLineMenus("school-a");h.nodes.set("globalLineMenus_school-a",{dataset:{},innerHTML:"new panel"});
 resolve(config);await old;assert.equal(h.panel.innerHTML,"");assert.equal(h.nodes.get("globalLineMenus_school-a").innerHTML,"new panel");
});
test("empty same-channel menu list provides an actionable setup message",async()=>{
 const h=harness({reply:()=>({schoolId:"school-a",menus:[],parentMenuId:"",staffMenuId:""})});await h.window.loadGlobalLineMenus("school-a");
 assert.match(h.panel.innerHTML,/尚無可選取的 Rich Menu/);assert.match(h.panel.innerHTML,/目前幹部選單：尚未設定/);
 assert.match(h.panel.innerHTML,/<button class="primary"[^>]+disabled>儲存選單設定/);
});
test("six-area menus that point at a different environment stay visible with a disabled choice and reason",async()=>{
 const h=harness({reply:()=>({...config,menus:[{richMenuId:staffId,name:"LAB 幹部",areaCount:6,selectable:false,validationError:"選單連結不屬於此校目前的平台"}]})});
 await h.window.loadGlobalLineMenus("school-a");
 assert.match(h.panel.innerHTML,/<option[^>]+selected[^>]+disabled[^>]*>LAB 幹部/);
 assert.match(h.panel.innerHTML,/選單連結不屬於此校目前的平台/);
 assert.match(h.panel.innerHTML,/<button class="primary"[^>]+disabled>儲存選單設定/);
});
