import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";

function auditStore(){
  const rows=new Map(),filters=[];
  const t={submitTransaction:async actions=>{if(actions.some(([,e])=>rows.has(e.partitionKey+"/"+e.rowKey)))throw {statusCode:409};for(const [,e] of actions)rows.set(e.partitionKey+"/"+e.rowKey,{...e})},listEntities:({queryOptions:{filter}})=>({byPage:({continuationToken,maxPageSize})=>({next:async()=>{
    filters.push(filter);const criteria=[...filter.matchAll(/(\w+) (eq|ge|lt) '((?:''|[^'])*)'/g)].map(([,field,operator,value])=>[field,operator,value.replaceAll("''","'")]);
    const found=[...rows.values()].filter(row=>criteria.every(([f,op,v])=>{const value=row[f==="PartitionKey"?"partitionKey":f];return op==="eq"?String(value)===v:op==="ge"?String(value)>=v:String(value)<v})).sort((a,b)=>a.rowKey.localeCompare(b.rowKey));
    const start=Number(continuationToken||0),page=found.slice(start,start+maxPageSize);page.continuationToken=start+maxPageSize<found.length?String(start+maxPageSize):undefined;
    return {done:false,value:page};
  }})})};
  const context={TableClient:{fromConnectionString:()=>t},TableServiceClient:{fromConnectionString:()=>({createTable:async()=>{}})},createHash,tenantSchoolPartition:x=>String(x).toLowerCase(),process:{env:{STORAGE_CONNECTION_STRING:"fake-independent-test-store"}}};
  const source=readFileSync(new URL("../src/lib/teacherLoginAudit.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
  runInNewContext(source,context);return {rows,filters,context};
}
const access={authenticated:true,role:"teacher",schoolId:"school-a",email:"teacher@example.org",displayName:"王老師",authSessionId:"private-session-signature"};

test("teacher logins are atomic, deduplicated per verified session, and contain no credentials",async()=>{
  const b=auditStore();const result=await Promise.all([b.context.recordTeacherLogin(access,"teacher"),b.context.recordTeacherLogin(access,"teacher")]);
  assert.equal(result.filter(x=>x.created).length,1);assert.equal([...b.rows.values()].filter(x=>x.eventType==="teacher_login").length,1);
  await b.context.recordTeacherLogin({...access,authSessionId:"second session"},"teacher");
  assert.equal([...b.rows.values()].filter(x=>x.eventType==="teacher_login").length,2);
  assert.ok(!JSON.stringify([...b.rows.values()]).includes("private-session-signature"));
  assert.ok(!JSON.stringify([...b.rows.values()]).includes("second session"));
});

test("successful private and support teachers are recorded and denied verified teacher contexts are separate",async()=>{
  const b=auditStore();
  await b.context.recordTeacherLogin({...access,role:"privateTeacher"},"teacher");
  await b.context.recordTeacherLogin({...access,role:"contextDenied"},"teacher");
  const records=[...b.rows.values()].filter(x=>x.eventType==="teacher_login");assert.deepEqual(records.map(x=>x.result).sort(),["denied","success"]);
  assert.equal((await b.context.recordTeacherLogin({...access,role:"parent"},"parent")).created,false);
  assert.equal((await b.context.recordTeacherLogin({...access,authSessionId:""},"teacher")).created,false);
  assert.equal((await b.context.recordTeacherLogin({...access,schoolId:""},"teacher")).created,false);
  await b.context.recordTeacherLogin({...access,schoolId:"school-b"},"teacher");assert.equal([...b.rows.values()].filter(x=>x.eventType==="teacher_login").length,3);
});

test("date queries use Taiwan boundaries, filter the tenant, and page through every record",async()=>{
  const b=auditStore();
  for(let i=0;i<205;i++){
    const at=new Date(Date.parse("2026-10-24T16:00:00Z")+i*1000).toISOString(),rowKey="login_"+String(8640000000000000-Date.parse(at)).padStart(16,"0")+"_"+i;
    const e={partitionKey:"school-a|teacher-login",rowKey,eventType:"teacher_login",createdAt:at,teacherEmail:i%2?"teacher@example.org":"other@example.org",teacherName:"王老師",result:"success"};b.rows.set(e.partitionKey+"/"+rowKey,e);
  }
  const outside={partitionKey:"school-b|teacher-login",rowKey:"login_0",eventType:"teacher_login",createdAt:"2026-10-24T16:00:00Z",teacherEmail:access.email,result:"success"};b.rows.set(outside.partitionKey+"/"+outside.rowKey,outside);
  const seen=[];let cursor="";
  do{const page=await b.context.listTeacherLogins("school-a",{from:"2026-10-25",to:"2026-10-25",cursor});seen.push(...page.items);cursor=page.nextCursor}while(cursor);
  assert.equal(seen.length,205);assert.equal(new Set(seen.map(x=>x.id)).size,205);assert.ok(seen[0].at>seen[204].at);
  assert.match(b.filters[0],/createdAt ge '2026-10-24T16:00:00.000Z'/);assert.match(b.filters[0],/createdAt lt '2026-10-25T16:00:00.000Z'/);
  const selected=await b.context.listTeacherLogins("school-a",{from:"2026-10-25",to:"2026-10-25",email:access.email,result:"success"});
  assert.equal(selected.items.length,100);assert.ok(selected.items.every(x=>x.email===access.email));assert.ok(selected.nextCursor);
});

test("history rejects impossible dates and restricts reads to the current school's admin",async()=>{
  const b=auditStore();assert.equal(b.context.validAuditDate("2026-02-30"),false);assert.equal(b.context.validAuditDate("2024-02-29"),true);
  const handlers={},calls=[];let role="teacher";
  const context={app:{http:(name,config)=>handlers[name]=config.handler},getTenantContext:async()=>({access:{role},schoolId:"school-a"}),json:(jsonBody,status=200)=>({jsonBody,status}),validAuditDate:b.context.validAuditDate,listTeacherLogins:async(...args)=>{calls.push(args);return {items:[],nextCursor:""}},console};
  runInNewContext(readFileSync(new URL("../src/functions/teacherLoginHistory.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,""),context);
  const request=values=>handlers.teacherLoginHistory({query:new URLSearchParams({from:"2026-10-01",to:"2026-10-31",...values})});
  assert.equal((await request()).status,403);assert.equal(calls.length,0);role="admin";
  assert.equal((await request({from:"2026-02-30"})).status,400);assert.equal((await request({result:"all schools"})).status,400);
  assert.equal((await request({schoolId:"school-b"})).status,200);assert.equal(calls[0][0],"school-a");
});

test("me records teacher entry without exposing the internal session hash",async()=>{
  const handlers={},touches=[],events=[];
  const context={app:{http:(name,config)=>handlers[name]=config.handler},getAccess:async()=>access,json:(jsonBody,status=200)=>({jsonBody,status}),parseJsonEnv:()=>({}),saveUserIdentity:async()=>{},listTenantRolesByEmail:async()=>[],listTenantDirectory:async()=>[],defaultTenantId:()=>"school-a",recordTeacherLogin:async(...args)=>{events.push(args);return {created:events.length===1,result:"success"}},touchTeacherLastLogin:async(...args)=>touches.push(args),console};
  runInNewContext(readFileSync(new URL("../src/functions/me.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,""),context);
  const req={headers:new Map([["x-role-context","teacher"],["x-school-id","school-a"]])};
  const response=await handlers.me(req);await handlers.me(req);
  assert.equal(events.length,2);assert.equal(touches.length,1);assert.equal(response.jsonBody.authSessionId,undefined);assert.equal(response.jsonBody.email,access.email);
});

test("teacher history mounts inside the workspace even when other audit modules have not loaded",()=>{
  const registry=new Map(),jobs=[];
  class Element{
    constructor(){this.dataset={};this.children=[];this.hidden=false;this.parentElement=null}
    set id(value){this._id=value;registry.set(value,this)}get id(){return this._id}
    append(node){node.parentElement=this;this.children.push(node)}
    contains(node){for(let n=node;n;n=n.parentElement)if(n===this)return true;return false}
    insertAdjacentElement(position,node){this.parentElement?.append(node)}
  }
  const app=new Element(),main=new Element();app.append(main);
  const state={me:{role:"admin",schoolId:"school-a",email:"admin@example.org"},page:"admin",adminWorkspaceSection:"home"};
  const context={state,window:null,loadAdmin:async()=>{},adminPage:()=>"",render:()=>{},setTimeout:fn=>jobs.push(fn),api:async()=>({items:[],students:[]}),esc:x=>String(x),$:()=>null,document:{querySelector:s=>s===".main"?main:null,getElementById:id=>registry.get(id)||null,createElement:()=>new Element()}};context.window=context;
  runInNewContext(readFileSync(new URL("../../app/teacher-admin.js",import.meta.url),"utf8"),context);
  context.render();while(jobs.length)jobs.shift()();
  const root=registry.get("teacherLoginAudit");assert.equal(root.parentElement,main);assert.equal(root.hidden,true);
  state.adminWorkspaceSection="records";context.render();while(jobs.length)jobs.shift()();
  assert.equal(root.hidden,false);assert.match(root.innerHTML,/開啟老師登入查詢/);
});
