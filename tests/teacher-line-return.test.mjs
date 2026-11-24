import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const app=readFileSync(new URL("../app/app-v3.js",import.meta.url),"utf8");
const entrySource=app.slice(app.indexOf("function teacherLineAccountEntry(){"),app.indexOf("async function restoreLineStaffSession(){"));
const bootSource=app.slice(app.indexOf("async function boot(){"),app.indexOf("const schoolViewScript="));
const teacher={authProvider:"google",role:"teacher",schoolId:"school-a",email:"teacher@example.invalid"};
function fixture({search="?teacherLineAccount=school-a&line_link=confirm",token="",pending="",profile=teacher,status=200}={}){
 const requests=[],profiles=[],logins=[],histories=[],storage=new Map(pending?[["teacher_line_account_return",pending]]:[]),state={token,me:null};
 const location={pathname:"/",search,hash:""};
 const scope={state,URLSearchParams,location,window:{},history:{replaceState:(_state,_title,url)=>{histories.push(url);location.search=new URL(url,"https://example.invalid").search}},
  sessionStorage:{getItem:key=>storage.get(key)||"",setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  fetch:async(url,options)=>{requests.push({url,options});return {ok:status===200,status,json:async()=>profile}},
  loadProfile:async value=>profiles.push(value),renderLogin:message=>logins.push(message)};
 runInNewContext(entrySource+"\n"+bootSource+";this.start=boot;this.restore=restoreTeacherLineAccountSession;this.entry=teacherLineAccountEntry;",scope);
 return {scope,state,storage,requests,profiles,logins,histories,boot:()=>scope.start()};
}

test("teacher callback restores a Gmail cookie in a new tab and forces only the verified same-school teaching context",async()=>{
 for(const token of ["","line-session","verified-google-token"]){
  const h=fixture({token});await h.boot();
  assert.equal(h.logins.length,0);assert.deepEqual(h.profiles,[teacher]);assert.equal(h.requests.length,1);
  const {options}=h.requests[0];assert.equal(options.credentials,"same-origin");assert.equal(options.cache,"no-store");
  assert.equal(options.headers["X-School-Id"],"school-a");assert.equal(options.headers["X-Role-Context"],"teacher");
  assert.equal(options.headers["X-Google-ID-Token"],token==="verified-google-token"?token:undefined);
  assert.equal(h.storage.get("role_context"),"teacher");assert.equal(h.storage.get("google_id_token"),token==="verified-google-token"?token:"cookie-session");
 }
});

test("a LINE-only, parent, revoked or other-school session can never fall through to student registration on a teacher return",async()=>{
 for(const variant of [
  {profile:{authProvider:"line",role:"unassigned",schoolId:"school-a",displayName:"Wen",email:""}},
  {profile:{...teacher,authProvider:"line"}},
  {profile:{...teacher,role:"parent"}},
  {profile:{...teacher,role:"contextDenied"}},
  {profile:{...teacher,schoolId:"school-b"}},
  {status:401},{status:403},{status:503}
 ]){
  const h=fixture({token:"line-session",...variant});await h.boot();
  assert.equal(h.profiles.length,0);assert.equal(h.logins.length,1);assert.match(h.logins[0],/Gmail/);assert.equal(h.state.me,null);
  assert.equal(h.storage.get("role_context"),"teacher");assert.equal(h.storage.get("school_context_id"),"school-a");
 }
});

test("lost OAuth cookie errors recover the intended teacher screen rather than loading an older LINE session",async()=>{
 const h=fixture({search:"?line_error=authorization",token:"line-session",pending:"school-a"});await h.boot();
 assert.deepEqual(h.profiles,[teacher]);assert.equal(h.logins.length,0);
 assert.match(h.histories[0],/teacherLineAccount=school-a/);assert.match(h.histories[0],/line_error=authorization/);
 // A Google redirect drops the query. The original teacher intent must still
 // reject a parent Gmail when the user retries the login in that same tab.
 h.scope.location.search="";assert.equal(h.scope.entry(),"school-a");
 const denied=fixture({search:"",token:"google-token",pending:"school-a",profile:{...teacher,role:"parent"}});await denied.boot();
 assert.equal(denied.profiles.length,0);assert.equal(denied.logins.length,1);
 const fresh=fixture({token:'line-session',profile:{...teacher,role:'unassigned'}});await fresh.boot();
 fresh.scope.location.search='';assert.equal(fresh.scope.entry(),'school-a');assert.equal(fresh.profiles.length,0);
});

test("ordinary OAuth errors remain visible with an existing LINE token and never resume the unlinked student form",async()=>{
 for(const error of ["authorization","verification","configuration","conflict"]){
  const h=fixture({search:"?line_error="+error,token:"line-session"});await h.boot();
  assert.equal(h.profiles.length,0);assert.equal(h.requests.length,0);assert.equal(h.logins.length,1);assert.match(h.logins[0],/綁定|驗證/);
 }
});

test("teacher return hints cannot request another origin or arbitrary role",async()=>{
 for(const search of ["?teacherLineAccount=https://evil.invalid","?teacherLineAccount=../school-a"]){
  const h=fixture({search});assert.equal(h.scope.entry(),"");
 }
});

test("the actual Gmail retry callback repeats teacher return verification before loading a profile",async()=>{
 const callback=app.slice(app.indexOf("callback:async res=>{state.token=res.credential;"),app.indexOf("google.accounts.id.renderButton($(\"googleBtn\")"));
 const body=callback.slice("callback:".length,callback.lastIndexOf("});"));
 const storage=new Map(),calls=[],state={me:{role:"parent"}},fail=new Error("請使用老師 Gmail");
 const retry=runInNewContext("("+body+")",{state,sessionStorage:{setItem:(k,v)=>storage.set(k,v)},teacherLineAccountEntry:()=>"school-a",parentLineAccountEntry:()=>"",restoreTeacherLineAccountSession:async sid=>{calls.push(sid);throw fail},loadProfile:async()=>calls.push("loaded"),renderLogin:message=>calls.push(message)});
 await retry({credential:"new-google-token"});assert.deepEqual(calls,["school-a",fail.message]);assert.equal(state.me,null);
});
