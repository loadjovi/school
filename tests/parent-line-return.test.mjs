import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const app=readFileSync(new URL("../app/app-v3.js",import.meta.url),"utf8");
const entries=app.slice(app.indexOf("function teacherLineAccountEntry(){"),app.indexOf("async function restoreLineStaffSession(){"));
const bootstrap=app.slice(app.indexOf("async function boot(){"),app.indexOf("const schoolViewScript="));
const parent={authProvider:"google",role:"parent",schoolId:"school-a",email:"parent@example.invalid",students:[{studentId:"100001",name:"原核准學生"},{studentId:"100002",name:"第二位原核准學生"}]};
function fixture({search="?parentLineAccount=school-a&line_link=confirm",token="",pending="",teacherPending="",profile=parent,status=200}={}){
 const requests=[],profiles=[],logins=[],navigation=[],histories=[],state={token,me:null};
 const storage=new Map([...(pending?[["parent_line_account_return",pending]]:[]),...(teacherPending?[["teacher_line_account_return",teacherPending]]:[])]);
 const location={pathname:"/",search,hash:"",replace:url=>navigation.push(url)};
 const context={state,URLSearchParams,location,window:{},history:{replaceState:(_state,_title,url)=>{histories.push(url);location.search=new URL(url,"https://example.invalid").search}},
  sessionStorage:{getItem:key=>storage.get(key)||"",setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  fetch:async(url,options)=>{requests.push({url,options});return {ok:status===200,status,json:async()=>profile}},
  loadProfile:async value=>profiles.push(value),renderLogin:message=>logins.push(message)};
 runInNewContext(entries+"\n"+bootstrap+";this.start=boot;this.parentEntry=parentLineAccountEntry;this.teacherEntry=teacherLineAccountEntry;",context);
 return {context,state,storage,requests,profiles,logins,navigation,histories,boot:()=>context.start()};
}

test("approved Gmail parents return directly to LINE account confirmation with no student registration or mapping mutation",async()=>{
 const original=JSON.stringify(parent);
 for(const token of ["","line-session","google-token"]){
  const h=fixture({token});await h.boot();assert.equal(h.logins.length,0);assert.equal(h.profiles.length,0);
  assert.equal(h.navigation.length,1);const url=new URL(h.navigation[0],"https://example.invalid");
  assert.equal(url.pathname,"/line-account.html");assert.equal(url.searchParams.get("parentLineAccount"),"school-a");assert.equal(url.searchParams.get("line_link"),"confirm");
  assert.equal(h.requests.length,1);const {url:path,options}=h.requests[0];assert.equal(path,"/api/me");assert.equal(options.method,undefined);
  assert.equal(options.credentials,"same-origin");assert.equal(options.cache,"no-store");assert.equal(options.headers["X-Role-Context"],"parent");assert.equal(options.headers["X-School-Id"],"school-a");
  assert.equal(options.headers["X-Google-ID-Token"],token==="google-token"?token:undefined);
  assert.equal(h.storage.get("google_id_token"),token==="google-token"?token:"cookie-session");
 }
 assert.equal(JSON.stringify(parent),original);
});

test("an unpaired LINE account, unapproved Gmail, other role or school cannot turn a parent return into a student registration",async()=>{
 for(const variant of [
  {profile:{authProvider:"line",role:"unassigned",schoolId:"school-a",displayName:"LINE 家長"}},
  {profile:{...parent,authProvider:"line"}},
  {profile:{...parent,role:"unassigned",students:[]}},
  {profile:{...parent,role:"teacher"}},{profile:{...parent,role:"admin"}},
  {profile:{...parent,schoolId:"school-b"}},{status:401},{status:403},{status:503}
 ]){
  const h=fixture({token:"line-session",...variant});await h.boot();assert.equal(h.navigation.length,0);assert.equal(h.profiles.length,0);
  assert.equal(h.logins.length,1);assert.match(h.logins[0],/Gmail/);assert.match(h.logins[0],/不需/);assert.equal(h.state.me,null);
 }
});

test("parent intent survives a lost callback cookie and another Gmail redirect without asking for student data",async()=>{
 const h=fixture({search:"?line_error=authorization",token:"line-session",pending:"school-a"});await h.boot();
 assert.equal(h.logins.length,0);assert.match(h.navigation[0],/line_error=authorization/);
 const fresh=fixture({status:401});await fresh.boot();fresh.context.location.search="";
 assert.equal(fresh.context.parentEntry(),"school-a");assert.equal(fresh.storage.get("role_context"),"parent");
});

test("an explicit parent callback beats an obsolete teacher hint and an explicit teacher callback beats a parent hint",async()=>{
 const h=fixture({teacherPending:"school-a"});await h.boot();assert.equal(h.context.teacherEntry(),"");assert.equal(h.navigation.length,1);assert.equal(h.storage.has("teacher_line_account_return"),false);
 const teacher=fixture({search:"?teacherLineAccount=school-a",pending:"school-a",profile:{...parent,role:"teacher"}});await teacher.boot();
 assert.equal(teacher.context.parentEntry(),"");assert.equal(teacher.navigation.length,0);assert.equal(teacher.profiles.length,1);assert.equal(teacher.storage.has("parent_line_account_return"),false);
});

test("parent account navigation forwards only known callback results and never user-supplied destinations or children",async()=>{
 const h=fixture({search:'?parentLineAccount=school-a&line_link=confirm&line_error=https://evil.invalid&returnTo=https://evil.invalid&studentId=foreign&teacherLineAccount=bad/value'});
 await h.boot();const url=new URL(h.navigation[0],"https://example.invalid");
 assert.deepEqual([...url.searchParams.keys()],["parentLineAccount","line_link"]);assert.equal(url.searchParams.get("parentLineAccount"),"school-a");
});
test("friendship callbacks return a verified Gmail parent to the account page without student registration",async()=>{
 for(const result of ['checked','unavailable','mismatch']){
  const h=fixture({search:'?parentLineAccount=school-a&line_friend='+result});await h.boot();
  const url=new URL(h.navigation[0],'https://example.invalid');assert.equal(url.pathname,'/line-account.html');assert.equal(url.searchParams.get('line_friend'),result);
  assert.equal(h.profiles.length,0);assert.equal(h.logins.length,0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/me');
 }
 for(const result of ['friend','confirm','https://evil.invalid']){
  const h=fixture({search:'?parentLineAccount=school-a&line_friend='+result});await h.boot();assert.equal(new URL(h.navigation[0],'https://example.invalid').searchParams.has('line_friend'),false);
 }
});

test("the Gmail retry callback keeps a parent with missing authorization out of the first-time student form",async()=>{
 const callback=app.slice(app.indexOf("callback:async res=>{state.token=res.credential;"),app.indexOf("google.accounts.id.renderButton($(\"googleBtn\")"));
 const body=callback.slice("callback:".length,callback.lastIndexOf("});")),calls=[],state={};
 const retry=runInNewContext("("+body+")",{state,sessionStorage:{setItem(){}},adminFriendAccountEntry:()=>"",teacherLineAccountEntry:()=>"",parentLineAccountEntry:()=>"school-a",restoreParentLineAccountSession:async()=>{throw Error("請使用原 Gmail，不需重填學生資料")},openParentLineAccount:()=>calls.push("account"),loadProfile:()=>calls.push("student-form"),renderLogin:message=>calls.push(message)});
 await retry({credential:"gmail-token"});assert.equal(calls.length,1);assert.match(calls[0],/原 Gmail/);assert.equal(state.me,null);
});
