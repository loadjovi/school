import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../app/parent-home-summary.js",import.meta.url),"utf8");
const admin=readFileSync(new URL("../app/tshirt-admin-shortcuts.js",import.meta.url),"utf8");
const guard=readFileSync(new URL("../app/webview-guard.js",import.meta.url),"utf8");
const index=readFileSync(new URL("../app/index.html",import.meta.url),"utf8");

function harness(){
 const listeners=new Map(),storage=new Map([["school_context_id","sacred-heart"],["role_context","parent"]]);
 const context={state:{me:{role:"parent",email:"parent@example.com",schoolId:"sacred-heart"},student:{studentId:"1",name:"甲同學"},students:[{studentId:"1",name:"甲同學"}],practice:[],page:"home"},home:()=>"",nav:()=>"",refreshStudent:async()=>{},sessionStorage:{getItem:key=>storage.get(key)||""},fetch:async()=>({ok:true,json:async()=>({items:[]})}),addEventListener:(name,fn)=>listeners.set(name,fn),document:{getElementById:()=>null},location:{origin:"https://example.invalid"},setTimeout:()=>{},render:()=>{},go:()=>{},api:async()=>({}),navBtn:()=>"",esc:value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]),Date,console};
 context.window=context;vm.runInNewContext(source,context);return context;
}

test("missing team T size stays visible until every linked child has a size",()=>{
 const ctx=harness();
 ctx.state.parentTshirtSizes=[{studentId:"1",studentName:"甲同學",size:null}];
 const pending=ctx.parentTshirtSizeReminderHtml();
 assert.match(pending,/團 T 尺寸尚未完成/);
 assert.match(pending,/甲同學尚未登錄尺寸/);
 assert.match(pending,/完成所有孩子的尺寸登記前，此提醒會在每次登入時持續顯示/);
 assert.doesNotMatch(pending,/關閉|稍後提醒|已讀/);
 ctx.state.parentTshirtSizes=[{studentId:"1",studentName:"甲同學",size:"M"}];
 assert.equal(ctx.parentTshirtSizeReminderHtml(),"");
});

test("size reminder is independent from one-time activity seen state and handles read failures",()=>{
 const start=source.indexOf("function tshirtSizeShortcut"),end=source.indexOf("async function loadParentActivityAlerts",start),block=source.slice(start,end);
 assert.doesNotMatch(block,/parentActivityNotice|localStorage|mark\(/);
 const ctx=harness();ctx.state.parentTshirtSizesError="團 T 尺寸狀態暫時無法確認";
 assert.match(ctx.parentTshirtSizeReminderHtml(),/系統不會將讀取失敗視為已完成/);
 assert.match(ctx.parentTshirtSizeReminderHtml(),/重新讀取尺寸狀態/);
 assert.match(source,/parent-tshirt-size-saved[\s\S]*loadParentTshirtSizes\(\)/);
});

test("parent reminder is first on home and school roster counts the same missing size records",()=>{
 assert.match(source,/return `\$\{tshirtSizeShortcut\(\)\}\$\{todayCourseReminder\(\)\}/);
 assert.match(admin,/const size=historicalSizes\.get\([\s\S]*?if\(size\)counts\.set\(size,[\s\S]*?else missing\.push/);
 assert.match(admin,/"待填寫 "\)\+missing\.length\+" 人"/);
 assert.match(guard,/parent-home-summary\.js\?v=20261103-tshirt-size-reminder/);
 assert.match(index,/webview-guard\.js\?v=20261107-line-absence-group/);
});
