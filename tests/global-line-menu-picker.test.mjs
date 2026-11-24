import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../app/global-tenant-admin.js",import.meta.url),"utf8");
const channelLoader=source.slice(source.indexOf("  const globalLineChannelRequests="),source.indexOf("  const globalLineMenuRequests="));
const picker=source.slice(source.indexOf("  const globalLineMenuRequests="),source.indexOf("  function inlineAdminPanel("));
const parentId="richmenu-"+"a".repeat(32),staffId="richmenu-"+"b".repeat(32);
const config={schoolId:"school-a",parentMenuId:parentId,staffMenuId:staffId,menus:[
 {richMenuId:parentId,name:'家長 <script>bad</script>',areaCount:4,parentSelectable:true,parentValidationError:"",staffSelectable:false,staffValidationError:"幹部／老師須為六宮格",selectable:false},
 {richMenuId:staffId,name:"幹部",areaCount:6,parentSelectable:false,parentValidationError:"登入家長須為四宮格",staffSelectable:true,staffValidationError:"",selectable:true},
 {richMenuId:"richmenu-"+"c".repeat(32),name:"舊版",areaCount:3}
]};
function harness({global=true,reply=()=>config}={}){
 const calls=[],alerts=[],controls=[{disabled:false},{disabled:false}],panel={dataset:{},innerHTML:"",textContent:"",querySelectorAll:()=>controls};
 const facebookControls=[{disabled:false},{disabled:true}],facebookPanel={dataset:{},innerHTML:"",querySelectorAll:()=>facebookControls},facebookStatus={textContent:"",className:""};
 const state={me:{email:"global@example.test",role:"globalAdmin"},globalTenant:{selectedSchoolId:"school-a"}};
 const channelPanel={dataset:{},innerHTML:"",textContent:""};
 const nodes=new Map([["globalLineChannel_school-a",channelPanel],["globalLineMenus_school-a",panel],["globalLineParentMenu_school-a",{value:parentId}],["globalLineStaffMenu_school-a",{value:staffId}],
  ["globalLineFacebook_school-a",facebookPanel],["globalLineFacebookUrl_school-a",{value:"https://www.facebook.com/profile.php?id=100075610947066"}],["globalLineFacebookStatus_school-a",facebookStatus]]);
 const window={alert:message=>alerts.push(message)};
 const context={window,state,document:{getElementById:id=>nodes.get(id)},canGlobal:()=>global,esc:value=>String(value).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("'","&#39;").replaceAll("<","&lt;").replaceAll(">","&gt;"),
  api:async(path,options)=>{calls.push({path,options});return reply(path,options)},location:{origin:"https://school.example.test"},Symbol,Map,Array,JSON,String,Number,URL};
 runInNewContext(channelLoader+"\n"+picker,context);
 return {window,state,calls,alerts,nodes,panel,controls,channelPanel,facebookPanel,facebookControls,facebookStatus,setGlobal:value=>global=value};
}

test("Global shows existing personnel as the automatic audience source and keeps template controls collapsed",async()=>{
 const panel={dataset:{},innerHTML:"",textContent:""},calls=[],window={confirm:()=>true};
 runInNewContext(channelLoader,{window,state:{me:{email:"global@example.test",role:"globalAdmin"},globalTenant:{selectedSchoolId:"school-a"}},Map,Symbol,canGlobal:()=>true,document:{getElementById:id=>id==="globalLineChannel_school-a"?panel:null},location:{origin:"https://school.example.test"},URL,JSON,
  esc:value=>String(value??""),api:async(path,options)=>{calls.push({path,options});return {messagingConfigured:true,legacy:false,status:"active",email:{mode:"disabled"},webhookPath:"/api/line/webhook/school-a"}}});
 await window.loadGlobalLineChannel("school-a");
 assert.equal(calls.length,1);assert.equal(calls[0].options,undefined);
 assert.match(panel.innerHTML,/LINE 選單自動套用/);assert.match(panel.innerHTML,/Global 指派的本校幹部與啟用中的老師名冊/);
 assert.match(panel.innerHTML,/尚未綁定平台：預設三宮格/);assert.match(panel.innerHTML,/已核准學生關係的家長：四個功能/);assert.match(panel.innerHTML,/Facebook 新版後為五個入口/);assert.match(panel.innerHTML,/老師名冊：六宮格/);
 assert.match(panel.innerHTML,/不需另外指派 LINE 角色/);assert.match(panel.innerHTML,/學生資料僅依已核准關係開放/);
 assert.match(panel.innerHTML,/<details><summary>進階：選單版型設定<\/summary>/);assert.doesNotMatch(panel.innerHTML,/<details[^>]*open|<select/);
});

test("Global loads only the selected school's existing menus and escapes names",async()=>{
 const h=harness();await h.window.loadGlobalLineMenus("school-a");
 assert.deepEqual(h.calls.map(call=>call.path),["/api/line/tenant-config/school-a/menus"]);
 assert.equal(h.calls[0].options,undefined);
 assert.match(h.panel.innerHTML,/目前幹部選單/);assert.match(h.panel.innerHTML,new RegExp(staffId));
 assert.match(h.panel.innerHTML,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(h.panel.innerHTML,/<script>/);
 assert.match(h.panel.innerHTML,/<option[^>]+disabled[^>]*>舊版｜3 格/);
 assert.match(h.panel.innerHTML,/我的 LINE 綁定/);
});
test("advanced templates independently allow parent four-grid and staff six-grid while leaving default three-grid unchanged",async()=>{
 const h=harness();await h.window.loadGlobalLineMenus("school-a");
 const parentOptions=h.panel.innerHTML.match(/id="globalLineParentMenu_school-a">([\s\S]*?)<\/select>/)[1];
 const staffOptions=h.panel.innerHTML.match(/id="globalLineStaffMenu_school-a">([\s\S]*?)<\/select>/)[1];
 const parentChoice=parentOptions.match(new RegExp('<option value="'+parentId+'"([^>]*)>'))[1];
 const staffParentChoice=staffOptions.match(new RegExp('<option value="'+parentId+'"([^>]*)>'))[1];
 const staffChoice=staffOptions.match(new RegExp('<option value="'+staffId+'"([^>]*)>'))[1];
 const parentStaffChoice=parentOptions.match(new RegExp('<option value="'+staffId+'"([^>]*)>'))[1];
 assert.doesNotMatch(parentChoice,/disabled/);assert.match(staffParentChoice,/disabled/);assert.doesNotMatch(staffChoice,/disabled/);assert.match(parentStaffChoice,/disabled/);
 assert.match(h.panel.innerHTML,/家長登入版型（四格／Facebook 新版五入口）/);assert.match(h.panel.innerHTML,/預設三宮格沿用此校官方帳號設定/);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].options,undefined);
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

test("Facebook setup uses only this school's saved or suggested URL and keeps previews collapsed",async()=>{
 const saved="https://www.facebook.com/profile.php?id=100075610947066";
 for(const field of ["facebookUrl","facebookSuggestedUrl"]){
  const h=harness({reply:()=>({messagingConfigured:true,legacy:false,status:"active",email:{mode:"disabled"},webhookPath:"/api/line/webhook/school-a",[field]:saved})});
  await h.window.loadGlobalLineChannel("school-a");
  assert.match(h.channelPanel.innerHTML,new RegExp('value="'+saved.replaceAll("?","\\?")+'"'));
  assert.match(h.channelPanel.innerHTML,/套用 Facebook 新版選單/);assert.match(h.channelPanel.innerHTML,/幹部／老師維持六格/);
  assert.match(h.channelPanel.innerHTML,/<details><summary>預覽新版選單/);assert.match(h.channelPanel.innerHTML,/\/line-menu-parent-facebook\.jpg/);assert.match(h.channelPanel.innerHTML,/\/line-menu-staff-facebook\.jpg/);
  assert.doesNotMatch(h.channelPanel.innerHTML,/<details[^>]*open/);assert.equal(h.calls.length,1);
 }
 const other=harness({reply:()=>({messagingConfigured:true,legacy:false,status:"active",email:{},webhookPath:"/api/line/webhook/school-a"})});
 await other.window.loadGlobalLineChannel("school-a");assert.match(other.channelPanel.innerHTML,/id="globalLineFacebookUrl_school-a" value=""/);
 assert.doesNotMatch(other.channelPanel.innerHTML,/100075610947066/);
});

test("explicit Facebook apply posts only the target URL and keeps personnel binding intact",async()=>{
 const h=harness({reply:()=>({schoolId:"school-a",applied:true,parentMenuId:parentId,staffMenuId:staffId,templateVersion:"facebook-v1"})});
 await h.window.applyGlobalLineFacebookMenus("school-a");
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,"/api/line/tenant-config/school-a/menus/apply");assert.equal(h.calls[0].options.method,"POST");
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{facebookUrl:"https://www.facebook.com/profile.php?id=100075610947066"});
 assert.match(h.facebookStatus.textContent,/已套用 Facebook 新版選單/);assert.match(h.facebookStatus.textContent,/不需重新綁定/);assert.match(h.facebookStatus.textContent,/家長五個入口、幹部／老師六宮格/);
 assert.match(h.panel.textContent,/新版選單已套用/);assert.equal(h.facebookPanel.dataset.applying,"false");assert.deepEqual(h.facebookControls.map(control=>control.disabled),[false,true]);
});

test("Facebook apply rejects invalid targets, missing Global capability and a nonselected school before any request",async()=>{
 for(const target of ["", "javascript:alert(1)","http://www.facebook.com/page","https://facebook.com.evil.test/page","https://user:secret@facebook.com/page","https://www.facebook.com:8443/page","https://www.facebook.com/page#fragment"]){
  const h=harness();h.nodes.get("globalLineFacebookUrl_school-a").value=target;await h.window.applyGlobalLineFacebookMenus("school-a");
  assert.equal(h.calls.length,0);assert.match(h.facebookStatus.textContent,/HTTPS Facebook/);
 }
 const denied=harness({global:false});await denied.window.applyGlobalLineFacebookMenus("school-a");assert.equal(denied.calls.length,0);
 const other=harness();other.state.globalTenant.selectedSchoolId="school-b";await other.window.applyGlobalLineFacebookMenus("school-a");assert.equal(other.calls.length,0);
});

test("Facebook apply blocks duplicate submissions and restores choices after a safe failure",async()=>{
 let reject;const waiting=new Promise((_resolve,fail)=>reject=fail),h=harness({reply:()=>waiting});
 const pending=h.window.applyGlobalLineFacebookMenus("school-a");await h.window.applyGlobalLineFacebookMenus("school-a");assert.equal(h.calls.length,1);
 assert.equal(h.facebookPanel.dataset.applying,"true");assert.ok(h.facebookControls.every(control=>control.disabled));
 reject(Error("此校 LINE 設定已變更，請重新讀取"));await pending;
 assert.match(h.facebookStatus.textContent,/設定已變更/);assert.equal(h.facebookStatus.className,"notice error");assert.equal(h.facebookPanel.dataset.applying,"false");
 assert.deepEqual(h.facebookControls.map(control=>control.disabled),[false,true]);assert.equal(h.nodes.get("globalLineFacebookUrl_school-a").value,"https://www.facebook.com/profile.php?id=100075610947066");
});

test("stale Facebook responses never show success after school, identity, capability or panel changes",async()=>{
 for(const change of [h=>{h.state.globalTenant.selectedSchoolId="school-b"},h=>{h.state.me.email="other@example.test"},h=>h.setGlobal(false),h=>{h.nodes.set("globalLineFacebook_school-a",{dataset:{},innerHTML:"new"})}]){
  let resolve;const waiting=new Promise(done=>resolve=done),h=harness({reply:()=>waiting});
  const pending=h.window.applyGlobalLineFacebookMenus("school-a");change(h);resolve({schoolId:"school-a",applied:true});await pending;
  assert.doesNotMatch(h.facebookStatus.textContent,/已套用 Facebook 新版選單/);assert.doesNotMatch(h.panel.textContent,/新版選單已套用/);
 }
});

test("Facebook apply invalidates an older advanced-menu read instead of displaying obsolete IDs",async()=>{
 let resolve;const waiting=new Promise(done=>resolve=done),h=harness({reply:path=>path.endsWith("/apply")?{schoolId:"school-a",applied:true}:waiting});
 const old=h.window.loadGlobalLineMenus("school-a");await h.window.applyGlobalLineFacebookMenus("school-a");
 resolve(config);await old;assert.equal(h.panel.innerHTML,"");assert.match(h.panel.textContent,/新版選單已套用/);
});

test("Facebook apply requires a positive result for the requested school before reporting success",async()=>{
 for(const result of [{schoolId:"school-b",applied:true},{schoolId:"school-a",applied:false}]){
  const h=harness({reply:()=>result});await h.window.applyGlobalLineFacebookMenus("school-a");
  assert.match(h.facebookStatus.textContent,/尚未確認選單已套用/);assert.doesNotMatch(h.facebookStatus.textContent,/已套用 Facebook 新版選單/);
  assert.equal(h.facebookStatus.className,"notice error");assert.equal(h.facebookPanel.dataset.applying,"false");
 }
});

test("advanced picker accepts the new five-entry parent menu only for its approved audience",async()=>{
 const five={richMenuId:parentId,name:"家長 Facebook",areaCount:5,parentSelectable:true,staffSelectable:false};
 const h=harness({reply:()=>({...config,menus:[five,config.menus[1]]})});await h.window.loadGlobalLineMenus("school-a");
 const parentOptions=h.panel.innerHTML.match(/id="globalLineParentMenu_school-a">([\s\S]*?)<\/select>/)[1],staffOptions=h.panel.innerHTML.match(/id="globalLineStaffMenu_school-a">([\s\S]*?)<\/select>/)[1];
 assert.doesNotMatch(parentOptions.match(new RegExp('<option value="'+parentId+'"([^>]*)>'))[1],/disabled/);
 assert.match(staffOptions.match(new RegExp('<option value="'+parentId+'"([^>]*)>'))[1],/disabled/);
});
