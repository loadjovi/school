import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const childSource=read("app/uniform-admin-frame.js"),workspace=read("app/school-admin-workspace.js"),origin="https://school.example.invalid";
function child({embedded=true,framed=true,frameId="awUniformFrame"}={}){
 const listeners={},messages=[],classes=new Set(),back={hidden:false,target:"_top"};
 const document={readyState:"loading",documentElement:{classList:{add:x=>classes.add(x)},scrollHeight:850},body:{scrollHeight:700,firstChild:{id:"functional-uat-banner"}},getElementById:id=>id==="uniformPlatformBack"?back:null,addEventListener:(type,fn)=>{listeners[type]=fn}};
 const window={frameElement:framed?{id:frameId}:null,addEventListener(){}};window.parent=framed?{postMessage:(data,target)=>messages.push({data,target})}:window;
 runInNewContext(childSource,{window,document,URL,URLSearchParams,location:{origin,href:origin+"/uniform-event-admin.html"+(embedded?"?embedded=school":""),search:embedded?"?embedded=school":""},ResizeObserver:class{observe(){}}});
 listeners.DOMContentLoaded?.();
 return {back,classes,messages,click:(href,{download=false}={})=>{const event={prevented:false,preventDefault(){this.prevented=true},target:{closest:()=>href?{href,hasAttribute:()=>download}:null}};listeners.click?.(event);return event}};
}
test("the prepended LAB label cannot expose a return link or duplicate the shell inside an embedded tool",()=>{
 const h=child();assert.equal(h.back.hidden,true);assert.equal(h.back.target,"_top");assert.equal(h.classes.has("school-embedded"),true);
 assert.equal(h.messages[0].data.type,"school-uniform-height");assert.equal(h.messages[0].target,origin);
 const html=read("app/uniform-event-admin.html");assert.match(html,/#uniformPlatformBack,html\.school-embedded #functional-uat-banner/);assert.match(html,/<a id="uniformPlatformBack" href="\/" target="_top">/);
 assert.doesNotMatch(html,/body>a:first-child/);
});
test("a cached in-frame root link returns through the parent workspace without loading the root in the child",()=>{
 const h=child();const event=h.click(origin+"/");assert.equal(event.prevented,true);assert.equal(h.messages.at(-1).data.type,"school-uniform-return");assert.equal(h.messages.at(-1).target,origin);
 assert.equal(h.click(origin+"/index.html").prevented,true);
});
test("inventory buttons, CSV downloads and other tool links are not intercepted as a return",()=>{
 const h=child(),before=h.messages.length;
 for(const [href,options] of [[null,{}],[origin+"/line-announcement.html",{}],[origin+"/",{download:true}],["https://other.example.invalid/",{}]])assert.equal(h.click(href,options).prevented,false);
 assert.equal(h.messages.length,before);
 const standalone=child({embedded:false,framed:false});assert.equal(standalone.back.hidden,false);assert.equal(standalone.classes.size,0);
 const missingQuery=child({embedded:false});assert.equal(missingQuery.back.hidden,true,"the actual workspace frame is sufficient to retain embedded behavior");
});
function parentRuntime(){
 const loads=[],messages=[],opened=[],errors=[],frame={dataset:{},style:{},src:"/uniform-event-admin.html?embedded=school",contentWindow:{location:{href:origin+"/uniform-event-admin.html?embedded=school"}},addEventListener:(type,fn)=>{if(type==="load")loads.push(fn)}};
 const window={openSchoolAdminWorkspace:async group=>opened.push(group),addEventListener:(type,fn)=>{if(type==="message")messages.push(fn)}};
 const state={me:{role:"admin",schoolId:"school-a",email:"admin@example.test"}},scopeKey=()=>state.me.email+"|"+state.me.schoolId;
 const context={window,state,scopeKey,document:{getElementById:()=>frame},URL,URLSearchParams,location:{origin},toast:value=>errors.push(value)};
 const helper=workspace.slice(workspace.indexOf(" function bindUniformFrameNavigation("),workspace.indexOf(" const setGroup=",workspace.indexOf(" function bindUniformFrameNavigation(")));
 const start=workspace.indexOf(" window.addEventListener('message',event=>{"),end=workspace.indexOf(" window.addEventListener('message',event=>{",start+1);
 const bind=runInNewContext(helper+workspace.slice(start,end)+";bindUniformFrameNavigation",context);bind(frame);bind(frame);
 return {frame,loads,opened,errors,state,scopeKey,bind:()=>bind(frame),message:({origin:senderOrigin=origin,source=frame.contentWindow,data}={})=>messages[0]({origin:senderOrigin,source,data})};
}
test("the parent accepts only its own embedded document and keeps valid height updates working",()=>{
 const h=parentRuntime();h.message({origin:"https://other.example.invalid",data:{type:"school-uniform-return"}});h.message({source:{},data:{type:"school-uniform-return"}});assert.equal(h.opened.length,0);
 h.message({data:{type:"school-uniform-return"}});assert.deepEqual(h.opened,["home"]);assert.equal(h.frame.src,"/uniform-event-admin.html?embedded=school");
 h.message({data:{type:"school-uniform-height",height:1400.1}});assert.equal(h.frame.style.height,"1401px");h.message({data:{type:"school-uniform-height",height:999999}});assert.equal(h.frame.style.height,"1401px");
});
test("a stale navigation to the full application is cleared once and returns the outer workspace home",()=>{
 const h=parentRuntime();assert.equal(h.loads.length,1);h.loads[0]();assert.equal(h.opened.length,0);
 h.frame.contentWindow.location.href=origin+"/";h.loads[0]();assert.equal(h.frame.src,"about:blank");assert.deepEqual(h.opened,["home"]);
 h.frame.contentWindow.location.href="about:blank";h.loads[0]();assert.equal(h.opened.length,1);
 h.frame.contentWindow.location.href="https://other.example.invalid/";h.loads[0]();assert.equal(h.opened.length,1);
});
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.attributes={};this.value="";this.textContent="";this.style={};this.disabled=false;this.dataset={}}
 append(...children){this.children.push(...children)}replaceChildren(...children){this.children=children}setAttribute(k,v){this.attributes[k]=v}addEventListener(k,fn){this.handlers[k]=fn}querySelector(selector){return descendants(this).find(x=>"#"+x.id===selector)||null}focus(){}
}
const descendants=node=>node.children.flatMap(x=>[x,...descendants(x)]);
test("choosing T-shirt inventory and saving its batch count stay in the same tool and do not submit a native page navigation",async()=>{
 const panels=["students","requests","procurement","inventory","parents","reports"].map(name=>{const el=new Element("section");el.dataset={adminView:"regularUniform",tshirtPanel:name};el.hidden=true;return el}),buttons=panels.map(panel=>{const el=new Element("button");el.dataset={tshirtView:panel.dataset.tshirtPanel};return el});
 const stock=panels[3],requests=panels[1],shortcuts={hidden:false},posts=[];const document={getElementById:id=>({uniformInventoryPanel:stock,uniformRequestsPanel:requests,tshirtShortcutPanel:shortcuts})[id]||null,querySelector:()=>({getAttribute:()=>"true"}),querySelectorAll:selector=>selector==="[data-tshirt-view]"?buttons:selector.includes("data-tshirt-panel")?panels:[],createElement:tag=>new Element(tag)};
 const scope={document,window:{},queueMicrotask(){}};
 runInNewContext(read("app/tshirt-admin-shortcuts.js").replace(/^import .*;\n/gm,""),scope);buttons[3].handlers.click();assert.equal(stock.hidden,false);assert.equal(requests.hidden,true);assert.equal(buttons[3].attributes["aria-pressed"],"true");
 const create=runInNewContext(read("app/tshirt-stock-count.js").replace("export function","function")+";createTshirtStockCounter",{document});
 let counter;const inventory=[{key:"regular:S",onHand:2,reserved:0,unavailable:0,etag:"v1"}];
 counter=create({host:stock,api:async(path,options)=>{posts.push({path,body:JSON.parse(options.body)});return {updated:1}},onReload:async()=>counter.render(inventory)});counter.render(inventory);
 const form=stock.children[0],input=descendants(form).find(x=>x.name==="count-S");input.value="3";form.handlers.input();let prevented=false;await form.handlers.submit({preventDefault(){prevented=true}});
 assert.equal(prevented,true);assert.equal(stock.hidden,false);assert.equal(posts.length,1);assert.equal(posts[0].path,"uniform-events/inventory");assert.equal(posts[0].body.items[0].onHand,3);
});


test("repairing an activity return still restores the exact saved activity in the same school's tool",()=>{
 const h=parentRuntime();h.frame.contentWindow.location.href=origin+"/?"+new URLSearchParams({adminActivity:"calendarActivity:competition",activitySchool:"school-a"});h.loads[0]();
 assert.deepEqual(h.opened,["uniformAdmin"]);const url=new URL(h.frame.src,origin);assert.equal(url.pathname,"/uniform-event-admin.html");assert.equal(url.searchParams.get("embedded"),"school");assert.equal(url.searchParams.get("activity"),"calendarActivity:competition");
 const foreign=parentRuntime();foreign.frame.contentWindow.location.href=origin+"/?"+new URLSearchParams({adminActivity:"calendarActivity:competition",activitySchool:"school-b"});foreign.loads[0]();assert.deepEqual(foreign.opened,["home"]);assert.equal(foreign.frame.src,"about:blank");
});

test("an operations frame from a previous school or identity is invalidated before the existing listener is reused",()=>{
 const h=parentRuntime();assert.equal(h.frame.dataset.workspaceScope,h.scopeKey());assert.equal(h.loads.length,1);
 h.state.me.schoolId="school-b";h.bind();assert.equal(h.frame.src,"about:blank");assert.equal(h.frame.dataset.workspaceScope,h.scopeKey());assert.equal(h.loads.length,1);
 h.frame.src="/uniform-event-admin.html?embedded=school";h.bind();assert.equal(h.frame.src,"/uniform-event-admin.html?embedded=school","same verified scope retains the current document");
 h.state.me.email="another@example.test";h.bind();assert.equal(h.frame.src,"about:blank");assert.equal(h.frame.dataset.workspaceScope,"another@example.test|school-b");assert.equal(h.loads.length,1);
});
