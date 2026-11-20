import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../app/app-v3.js",import.meta.url),"utf8");
const apiSource=source.slice(source.indexOf("const pendingApiGets="),source.indexOf("async function restoreLineStaffSession("));
const refreshSource=source.slice(source.indexOf("async function refreshStudent(){"),source.indexOf("async function renderLineLogin("));
function harness(){
 const requests=[],session=new Map([["school_context_id","school-a"],["role_context","parent"]]);
 const state={token:"cookie-session",me:{role:"parent",email:"parent@example.invalid",schoolId:"school-a"},student:{studentId:"student1"}};
 const context={state,console,window:{},sessionStorage:{getItem:key=>session.get(key)||"",removeItem:key=>session.delete(key)},
  renderLogin(){},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,reply(data,status=200){resolve({ok:status<400,status,json:async()=>data})}}))};
 runInNewContext(apiSource+"\n"+refreshSource,context);
 return {context,state,session,requests};
}

test("simultaneous identical private reads share one request but return independent objects and never cache a settled result",async()=>{
 const h=harness(),url="/api/private-lesson?studentId=student1";
 const a=h.context.api(url),b=h.context.api(url);
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.cache,"no-store");
 h.requests[0].reply({items:[{status:"pending"}]});const [first,second]=await Promise.all([a,b]);
 first.items[0].status="changed";assert.equal(second.items[0].status,"pending");
 const fresh=h.context.api(url);assert.equal(h.requests.length,2);
 h.requests[1].reply({items:[]});await fresh;
});

test("child, school, role and identity changes keep in-flight requests separate",async()=>{
 const h=harness(),calls=[];
 calls.push(h.context.api("/api/summary?studentId=student1"));
 calls.push(h.context.api("/api/summary?studentId=student2"));
 h.session.set("school_context_id","school-b");calls.push(h.context.api("/api/summary?studentId=student1"));
 h.session.set("role_context","teacher");calls.push(h.context.api("/api/summary?studentId=student1"));
 h.state.me.email="another@example.invalid";calls.push(h.context.api("/api/summary?studentId=student1"));
 assert.equal(h.requests.length,5);
 h.requests.forEach((r,i)=>r.reply({request:i}));await Promise.all(calls);
 assert.equal(h.requests[2].options.headers["X-School-Id"],"school-b");
 assert.equal(h.requests[3].options.headers["X-Role-Context"],"teacher");
});

test("a payment or practice write forces the next read to be fresh instead of sharing the pre-write read",async()=>{
 const h=harness(),before=h.context.api("/api/summary?studentId=student1");
 const write=h.context.api("/api/practice",{method:"POST",body:"{}"});h.requests[1].reply({ok:true});await write;
 const after=h.context.api("/api/summary?studentId=student1");assert.equal(h.requests.length,3);
 h.requests[0].reply({version:"before"});h.requests[2].reply({version:"after"});
 assert.equal((await before).version,"before");assert.equal((await after).version,"after");
});

test("caller-owned cancellation and failed responses are not retained as shared cached data",async()=>{
 const h=harness();
 const a=h.context.api("/api/summary",{signal:{caller:"a"}}),b=h.context.api("/api/summary",{signal:{caller:"b"}});
 assert.equal(h.requests.length,2);h.requests[0].reply({});h.requests[1].reply({});await Promise.all([a,b]);
 const first=h.context.api("/api/summary"),second=h.context.api("/api/summary");
 const result=Promise.allSettled([first,second]);h.requests[2].reply({error:"暫時無法讀取"},503);
 assert.ok((await result).every(x=>x.status==="rejected"));
 const retry=h.context.api("/api/summary");assert.equal(h.requests.length,4);h.requests[3].reply({});await retry;
});

test("an old unauthorized response cannot log out the next verified identity",async()=>{
 const h=harness(),old=h.context.api("/api/summary");const oldResult=old.catch(error=>error);
 h.context.logout(false);h.state.token="new-token";h.state.me={role:"parent",email:"new@example.invalid",schoolId:"school-a"};
 h.requests[0].reply({},401);await oldResult;assert.equal(h.state.token,"new-token");
 const current=h.context.api("/api/summary"),currentResult=current.catch(error=>error);h.requests[1].reply({},401);await currentResult;
 assert.equal(h.state.token,"");assert.equal(h.state.me,null);
});

test("overlapping student refreshes issue two API reads instead of four and ignore a response for the previous school",async()=>{
 const h=harness(),a=h.context.refreshStudent(),b=h.context.refreshStudent();
 assert.equal(h.requests.length,2);
 h.requests[0].reply({practiceMinutes:20});h.requests[1].reply({items:[{minutes:20}]});await Promise.all([a,b]);
 assert.equal(h.state.summary.practiceMinutes,20);assert.equal(h.state.practice[0].minutes,20);
 const old=h.context.refreshStudent();h.session.set("school_context_id","school-b");h.state.summary={school:"b"};
 h.requests[2].reply({school:"a"});h.requests[3].reply({items:[]});await old;
 assert.equal(h.state.summary.school,"b");
});

test("the parent read optimization does not coalesce administrator or teacher requests",async()=>{
 for(const role of ["admin","teacher"]){
  const h=harness();h.state.me.role=role;
  const a=h.context.api("/api/summary"),b=h.context.api("/api/summary");assert.equal(h.requests.length,2);
  h.requests[0].reply({});h.requests[1].reply({});await Promise.all([a,b]);
 }
});
