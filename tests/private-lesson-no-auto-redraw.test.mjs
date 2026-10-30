import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const source=readFileSync(new URL("../app/private-lesson-confirmation.js",import.meta.url),"utf8");
const from=source.indexOf("  function startPrivatePoll(){"),to=source.indexOf("  function teacherHistoryHtml()",from);
assert.ok(from>=0&&to>from);
const func=source.slice(from,to);
function harness(role="teacher"){
 const callbacks=[],state={page:role==="parent"?"home":"private",me:{role:role==="parent"?"parent":"privateTeacher"}};
 let privatePoll=null,rendered=0,changes=0,fetches=0;
 const context={
  teacherAccount:()=>role==="teacher",state,
  clearInterval:()=>{privatePoll=null},setInterval:fn=>{callbacks.push(fn);return 1},
  document:{hidden:false},loadPrivateLessons:async()=>{fetches++;changes++},
  lessonSignature:()=>String(changes),
  render:()=>{rendered++}
 };
 const object=runInNewContext("let privatePoll=null;"+func+";({startPrivatePoll})",context);
 return {start:object.startPrivatePoll,callbacks,state,get rendered(){return rendered},get fetches(){return fetches},context};
}
test("teachers never auto-redraw private lesson content while writing",()=>{
 const h=harness("teacher");h.start();
 assert.equal(h.callbacks.length,0);
 assert.match(source,/老師端統一改為手動重新整理/);
 assert.match(source,/window.reloadPrivateLessons=async function/);
});
test("parents still receive background status refresh",async()=>{
 const h=harness("parent");h.start();assert.equal(h.callbacks.length,1);
 await h.callbacks[0]();assert.equal(h.fetches,1);assert.equal(h.rendered,1);
 h.context.document.hidden=true;await h.callbacks[0]();assert.equal(h.fetches,1);
 h.context.document.hidden=false;h.state.page="private";await h.callbacks[0]();assert.equal(h.fetches,1);
});
