import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createHash,createHmac,randomBytes} from "node:crypto";
import {verifyLineSignature,parseLineBindingCommand} from "../api/src/lib/lineMessaging.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const strip=text=>text.replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const missing=statusCode=>Object.assign(Error(String(statusCode)),{statusCode});
const bot="U"+"a".repeat(32),groupA="C"+"a".repeat(32),groupB="C"+"b".repeat(32);
const channel={schoolId:"school-a",botUserId:bot,channelSecret:"secret-a",accessToken:"token-a",loginConfigured:true,configured:true,legacy:false,appOrigin:"https://school-a.example.invalid"};
function fixture(){
 const tables=new Map();let version=0,clock=Date.now();
 const key=(p,r)=>p+"|"+r;
 const rows=name=>{if(!tables.has(name))tables.set(name,new Map());return tables.get(name)};
 const mutate=(map,action,row,mode,options)=>{
  const id=key(row.partitionKey,row.rowKey),old=map.get(id);
  if(action==="create"&&old)throw missing(409);
  if(action==="update"&&!old)throw missing(404);
  if(options?.etag&&options.etag!==old?.etag)throw missing(412);
  map.set(id,{...(mode==="Merge"?old:{}),...row,etag:"v"+(++version)});
 };
 const client=name=>({
  async createTable(){},async getEntity(p,r){const row=rows(name).get(key(p,r));if(!row)throw missing(404);return {...row}},
  async submitTransaction(actions){const draft=new Map(rows(name));for(const a of actions)mutate(draft,...a);tables.set(name,draft)},
  async updateEntity(row,mode,options){mutate(rows(name),"update",row,mode,options)},
  async upsertEntity(row,mode){mutate(rows(name),"upsert",row,mode)},
  async *listEntities({queryOptions:{filter}}){
   const p=filter.match(/PartitionKey eq '([^']+)'/)[1],start=filter.match(/RowKey ge '([^']+)'/)?.[1],end=filter.match(/RowKey lt '([^']+)'/)?.[1];
   for(const row of rows(name).values())if(row.partitionKey===p&&(!start||row.rowKey>=start)&&(!end||row.rowKey<end))yield {...row};
  }
 });
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
 const api=runInNewContext(strip(read("api/src/lib/lineActivityGroups.js"))+";({requireLineActivity,getActivityLineGroup,listActivityLineGroups,parseActivityLineBinding,createActivityLineBinding,consumeActivityLineBinding,clearActivityLineGroup,leaveActivityLineGroup,recordLineAnnouncement,lineAnnouncementHistory})",{
  TableClient:{fromConnectionString:(_,name)=>client(name)},process:{env:{STORAGE_CONNECTION_STRING:"test"}},createHash,randomBytes,tenantSchoolPartition:x=>x,Date:Clock
 });
 const seed=(school,key,title="活動",enabled=true)=>mutate(rows("TenantUniformEventConfig"),"upsert",{partitionKey:school,rowKey:key,payload:JSON.stringify({title,enabled,eventDate:"2026-12-09"})},"Replace");
 seed("school-a","fieldTrip:exchange","交流活動");seed("school-a","calendarActivity:competition","比賽活動");seed("school-b","fieldTrip:exchange","乙校交流");
 return {api,seed,tables,rows,advance:ms=>{clock+=ms}};
}

test("an activity binding code is one-use, school/bot-specific, expiring, and cannot change general todo groups",async()=>{
 const h=fixture(),a=h.api,code=await a.createActivityLineBinding(channel,"fieldTrip:exchange","admin@example.invalid");
 assert.equal(code.code.length,16);assert.equal(a.parseActivityLineBinding("#綁定活動通知 "+code.code),code.code);
 assert.equal(await a.consumeActivityLineBinding({...channel,schoolId:"school-b"},code.code,groupA,"錯校"),null);
 assert.equal(await a.consumeActivityLineBinding({...channel,botUserId:"other-bot"},code.code,groupA,"錯帳號"),null);
 const results=await Promise.all([a.consumeActivityLineBinding(channel,code.code,groupA,"交流志工群"),a.consumeActivityLineBinding(channel,code.code,groupB,"重複群")]);
 assert.equal(results.filter(Boolean).length,1);
 assert.equal((await a.getActivityLineGroup("school-a",bot,"fieldTrip:exchange")).groupName,"交流志工群");
 assert.equal(await a.consumeActivityLineBinding(channel,code.code,groupB,"重複"),null);
 assert.equal(await a.getActivityLineGroup("school-b",bot,"fieldTrip:exchange"),null);
 assert.equal(h.tables.has("SystemSettings"),false);
 const expired=await a.createActivityLineBinding(channel,"calendarActivity:competition","admin");h.advance(16*60000);
 assert.equal(await a.consumeActivityLineBinding(channel,expired.code,groupA,"過期"),null);
});

test("regeneration, unbinding, disabled activities, bot changes and a group leave invalidate stale activity bindings",async()=>{
 const h=fixture(),a=h.api;
 const old=await a.createActivityLineBinding(channel,"fieldTrip:exchange","admin"),next=await a.createActivityLineBinding(channel,"fieldTrip:exchange","admin");
 assert.equal(await a.consumeActivityLineBinding(channel,old.code,groupA,"old"),null);
 assert.ok(await a.consumeActivityLineBinding(channel,next.code,groupA,"新志工群"));
 const pending=await a.createActivityLineBinding(channel,"fieldTrip:exchange","admin");await a.clearActivityLineGroup("school-a",bot,"fieldTrip:exchange");
 assert.equal(await a.consumeActivityLineBinding(channel,pending.code,groupA,"old"),null);
 const closed=await a.createActivityLineBinding(channel,"fieldTrip:exchange","admin");h.seed("school-a","fieldTrip:exchange","交流",false);
 assert.equal(await a.consumeActivityLineBinding(channel,closed.code,groupA,"closed"),null);
 h.seed("school-a","fieldTrip:exchange","交流",true);
 const active=await a.createActivityLineBinding(channel,"fieldTrip:exchange","admin");await a.consumeActivityLineBinding(channel,active.code,groupA,"志工群");
 assert.equal(await a.getActivityLineGroup("school-a","different-bot","fieldTrip:exchange"),null);
 await a.leaveActivityLineGroup({...channel,schoolId:"school-b"},groupA);assert.ok(await a.getActivityLineGroup("school-a",bot,"fieldTrip:exchange"));
 await a.leaveActivityLineGroup(channel,groupA);assert.equal(await a.getActivityLineGroup("school-a",bot,"fieldTrip:exchange"),null);
 await assert.rejects(a.createActivityLineBinding(channel,"fieldTrip:unknown","admin"),/活動已關閉/);
});

function controller(h){
 const handlers={},sends=[],audiences=[];let role="admin",school="school-a",groupName="交流志工群",fails=false;
 runInNewContext(strip(read("api/src/functions/lineAnnouncements.js")),{
  app:{http:(name,entry)=>{handlers[name]=entry.handler}},createHash,console,process:{env:{LAB_ENVIRONMENT:"functional-uat"}},
  getTenantContext:async()=>({schoolId:school,access:{role,email:"admin@example.invalid"},tenant:{schoolName:"甲校"}}),json:(data,status=200)=>({data,status}),
  resolveTenantLineChannel:async()=>({...channel,schoolId:school}),workflowLineEnabled:()=>true,workflowLineRetryKey:(...args)=>args.join("|"),
  ...h.api,lineAudienceStudents:async()=>[{groupName:"A"},{groupName:"新團"}],lineAudienceGroups:students=>students.map(x=>x.groupName),lineAudienceRoles:["parent","teacher","staff","finance"],
  resolveLineAudience:async(s,b,input)=>{audiences.push({s,b,input});return {targets:["U"+"1".repeat(32)],matched:2,unbound:1}},
  getLineGroupSummary:async()=>({groupName}),pushLineMessage:async(to,text,options)=>{sends.push({to,text,options});if(fails)throw Error("provider unavailable")},
  lineApi:async(path,options)=>sends.push({path,options})
 });
 const request=(body,origin=channel.appOrigin)=>handlers.lineAnnouncements({method:body?"POST":"GET",headers:new Headers({origin}),json:async()=>body});
 return {request,sends,audiences,setRole:v=>{role=v},setSchool:v=>{school=v},setName:v=>{groupName=v},setFails:v=>{fails=v}};
}
const draft={action:"preview",audience:"activityGroup",activityKey:"fieldTrip:exchange",text:"請志工 08:00 集合",requestId:"12345678-1234-1234-1234-123456789abc"};

test("only the selected activity group can receive a preview-confirmed send, and target changes reject stale previews",async()=>{
 const h=fixture(),c=controller(h),binding=await h.api.createActivityLineBinding(channel,draft.activityKey,"admin");await h.api.consumeActivityLineBinding(channel,binding.code,groupA,"交流志工群");
 const options=await c.request();assert.equal(options.data.activities.length,2);assert.equal(options.data.activities[1].groupId,undefined);
 const preview=await c.request(draft);assert.equal(preview.status,200);assert.equal(preview.data.deliverable,1);assert.match(preview.data.targetLabel,/交流活動.*交流志工群/);
 assert.equal(c.sends.length,0);
 const sent=await c.request({...draft,action:"send",preview:preview.data.preview});assert.equal(sent.data.accepted,1);
 assert.equal(c.sends[0].to,groupA);assert.equal(c.sends[0].options.accessToken,channel.accessToken);assert.match(c.sends[0].text,/活動志工通知/);assert.equal(c.audiences.length,0);
 assert.equal((await h.api.lineAnnouncementHistory("school-a")).length,1);assert.equal((await h.api.lineAnnouncementHistory("school-b")).length,0);
 const replacement=await h.api.createActivityLineBinding(channel,draft.activityKey,"admin");await h.api.consumeActivityLineBinding(channel,replacement.code,groupB,"交流志工群");
 assert.equal((await c.request({...draft,action:"send",preview:preview.data.preview})).status,409);assert.equal(c.sends.length,1);
 c.setName("群組已改名");assert.equal((await c.request({...draft,action:"send",preview:preview.data.preview})).status,409);assert.equal(c.sends.length,1);
 c.setSchool("school-b");assert.equal((await c.request(draft)).status,409);assert.equal(c.sends.length,1);
 c.setRole("parent");assert.equal((await c.request()).status,403);
});

test("general team notices retain dynamic groups and require a matching preview, with separate provider retry keys",async()=>{
 const c=controller(fixture()),body={...draft,audience:"members",activityKey:"",roles:["parent"],groups:["新團"]};
 const p=await c.request(body);assert.equal(p.status,200);assert.equal(p.data.matched,2);assert.match(p.data.targetLabel,/新團/);
 assert.equal((await c.request({...body,action:"send",text:"changed",preview:p.data.preview})).status,409);
 const sent=await c.request({...body,action:"send",preview:p.data.preview});assert.equal(sent.data.accepted,1);
 assert.equal(c.sends[0].path,"/v2/bot/message/multicast");assert.equal(c.audiences[0].s,"school-a");assert.equal(c.audiences[0].b,bot);
 assert.equal((await c.request({...body,groups:["unknown"]})).status,400);
 assert.equal((await c.request({...body,groups:[],allSchool:false})).status,400);
 assert.equal((await c.request({...body,groups:[],allSchool:true})).status,200);
});

test("binding management requires the current school's admin and origin, and failed group sends are recorded without a fallback",async()=>{
 const h=fixture(),c=controller(h),command={action:"activity-binding-code",activityKey:draft.activityKey};
 assert.equal((await c.request(command,"https://other.example.invalid")).status,403);
 c.setRole("parent");assert.equal((await c.request(command)).status,403);
 c.setRole("admin");const code=await c.request(command);assert.equal(code.status,200);
 await h.api.consumeActivityLineBinding(channel,code.data.code,groupA,"志工群");
 const p=await c.request(draft);c.setFails(true);
 const sent=await c.request({...draft,action:"send",preview:p.data.preview});
 assert.equal(sent.data.accepted,0);assert.equal(sent.data.failed,1);assert.equal(c.sends.length,1);assert.equal(c.audiences.length,0);
 const log=await h.api.lineAnnouncementHistory("school-a");assert.equal(log[0].failed,1);
});

test("signed activity-group webhooks bind only in group chat and never touch general staff notification settings",async()=>{
 const h=fixture(),handlers={},replies=[],binding=await h.api.createActivityLineBinding(channel,"fieldTrip:exchange","admin");
 runInNewContext(strip(read("api/src/functions/lineWebhook.js")),{
  app:{http:(name,entry)=>{handlers[name]=entry.handler}},json:(data,status=200)=>({data,status}),Buffer,console,verifyLineSignature,...h.api,
  tenantIdValue:x=>x,defaultTenantId:()=>"school-a",resolveTenantLineChannel:async()=>channel,
  replyLineMessage:async(_,text)=>replies.push(text),getLineGroupSummary:async()=>({groupName:"已指定志工群"}),
  findLineBindingRequest:()=>{throw Error("must not use general notification binding")}
 });
 const invoke=async(source,type="message",secret=channel.channelSecret)=>{
  const raw=Buffer.from(JSON.stringify({destination:bot,events:[{type,source,message:{type:"text",text:"#綁定活動通知 "+binding.code},replyToken:"reply"}]}));
  return handlers.tenantLineWebhook({params:{schoolId:"school-a"},headers:new Headers({"x-line-signature":createHmac("sha256",secret).update(raw).digest("base64")}),arrayBuffer:async()=>raw});
 };
 assert.equal((await invoke({type:"group",groupId:groupA},"message","wrong-secret")).status,401);
 await invoke({type:"user",userId:"user"});assert.match(replies[0],/該群組/);
 await invoke({type:"group",groupId:groupA});assert.match(replies[1],/已綁定活動志工群組/);
 assert.equal((await h.api.getActivityLineGroup("school-a",bot,"fieldTrip:exchange")).groupId,groupA);
 await invoke({type:"group",groupId:groupA},"leave");assert.equal(await h.api.getActivityLineGroup("school-a",bot,"fieldTrip:exchange"),null);
});

test("the standalone LINE account page fetches no projects, bank templates or financial data for bound parents",async()=>{
 const calls=[],elements=Object.fromEntries(["siteName","roleTitle","roleIntro","status","lineBinding"].map(id=>[id,{textContent:"",innerHTML:"",className:"",hidden:false}]));
 const ctx={console,document:{documentElement:{hasAttribute:()=>true},getElementById:id=>elements[id]||null,addEventListener(){}},location:{hash:"",search:"",pathname:"/line-account.html"},history:{replaceState(){}},URLSearchParams,
  sessionStorage:{getItem:()=>""},fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url==="/api/me"?{role:"parent",schoolId:"school-a",capabilities:{lineAccount:true,feeCollections:true}}:{configured:true,bound:true,googleLinked:true,authProvider:"google",lineDisplayName:"家長"}}}
 };
 runInNewContext(read("app/fee-collections.js").replace('if(!legacyLineEntry)load();','globalThis.loadAccount=load;'),ctx);
 await ctx.loadAccount();assert.deepEqual(calls,["/api/me","/api/line/school-account"]);
 assert.equal(elements.roleTitle.textContent,"LINE 通知設定");assert.equal(elements.status.hidden,true);
 assert.doesNotMatch(elements.lineBinding.innerHTML,/收費|費用|專案/);
 const html=read("app/line-account.html");assert.doesNotMatch(html,/id="projects"|id="adminCreate"/);
 assert.match(read("api/src/functions/tenantLineLogin.js"),/resultUrl.pathname="\/line-account.html"/);
});


test("legacy LINE binding bookmarks redirect to the account-only page before requesting billing data",()=>{
 const redirects=[],calls=[];
 runInNewContext(read("app/fee-collections.js"),{document:{documentElement:{hasAttribute:()=>false},getElementById:()=>null,addEventListener(){}},location:{hash:"#lineBinding",search:"?line_link=confirm",replace:url=>redirects.push(url)},URLSearchParams,sessionStorage:{getItem:()=>""},fetch:(...args)=>calls.push(args)});
 assert.deepEqual(redirects,["/line-account.html?line_link=confirm#lineBinding"]);assert.equal(calls.length,0);
});
