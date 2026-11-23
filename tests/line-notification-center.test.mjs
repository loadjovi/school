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
const matchingSource=read("api/src/lib/lineTenantConfig.js");
const lineTargetMatchesChannel=runInNewContext(matchingSource.slice(matchingSource.indexOf("export function lineTargetMatchesChannel"),matchingSource.indexOf("export function tenantWebhookPath")).replace("export ","")+";lineTargetMatchesChannel");
function fixture(){
 const tables=new Map(),existingTargets=new Map(),channels=new Map();let version=0,clock=Date.now();
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
 const api=runInNewContext(strip(read("api/src/lib/lineActivityGroups.js"))+";({requireLineActivity,getActivityLineGroup,listActivityLineGroups,listSchoolLineGroups,schoolLineGroupTarget,parseActivityLineBinding,createActivityLineBinding,consumeActivityLineBinding,clearActivityLineGroup,leaveActivityLineGroup,recordLineAnnouncement,lineAnnouncementHistory})",{
  TableClient:{fromConnectionString:(_,name)=>client(name)},process:{env:{STORAGE_CONNECTION_STRING:"test"}},createHash,randomBytes,tenantSchoolPartition:x=>x,Date:Clock,getLineNotificationTarget:async(school,purpose)=>existingTargets.get(school+":"+purpose)||{},resolveTenantLineChannel:async school=>channels.get(school)||{...channel,schoolId:school,acceptsLegacy:false},lineTargetMatchesChannel
 });
 const seed=(school,key,title="活動",enabled=true)=>mutate(rows("TenantUniformEventConfig"),"upsert",{partitionKey:school,rowKey:key,payload:JSON.stringify({title,enabled,eventDate:"2026-12-09"})},"Replace");
 seed("school-a","fieldTrip:exchange","交流活動");seed("school-a","calendarActivity:competition","比賽活動");seed("school-b","fieldTrip:exchange","乙校交流");
 return {api,seed,tables,rows,advance:ms=>{clock+=ms},setExisting:(school,purpose,target)=>existingTargets.set(school+":"+purpose,target),setChannel:(school,current)=>channels.set(school,current)};
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

function controller(h,{resolvedChannel=channel}={}){
 const handlers={},sends=[],audiences=[],groupNames=new Map();let role="admin",school=resolvedChannel.schoolId,groupName="交流志工群",fails=false,targets=["U"+"1".repeat(32)],pushFailure=()=>null;
 runInNewContext(strip(read("api/src/functions/lineAnnouncements.js")),{
  app:{http:(name,entry)=>{handlers[name]=entry.handler}},createHash,console,process:{env:{LAB_ENVIRONMENT:"functional-uat"}},
  getTenantContext:async()=>({schoolId:school,access:{role,email:"admin@example.invalid"},tenant:{schoolName:"甲校"}}),json:(data,status=200)=>({data,status}),
  resolveTenantLineChannel:async()=>({...resolvedChannel,schoolId:school}),workflowLineEnabled:()=>true,workflowLineRetryKey:(...args)=>args.join("|"),
  ...h.api,lineAudienceStudents:async()=>[{groupName:"A"},{groupName:"新團"}],lineAudienceGroups:students=>students.map(x=>x.groupName),lineAudienceRoles:["parent","teacher","staff","finance"],
  resolveLineAudience:async(s,b,input)=>{audiences.push({s,b,input});return {targets,recipients:targets.map((userId,index)=>({userId,name:index?"Eileen":"Roy"})),matched:2,unbound:1}},
  getLineGroupSummary:async id=>groupNames.has(id)?groupNames.get(id)===null?null:{groupName:groupNames.get(id)}:{groupName},pushLineMessage:async(to,text,options)=>{sends.push({to,text,options});if(fails)throw Error("provider unavailable");const error=pushFailure(to,options);if(error)throw error},
  lineApi:async(path,options)=>sends.push({path,options})
 });
 const request=(body,origin=resolvedChannel.appOrigin)=>handlers.lineAnnouncements({method:body?"POST":"GET",headers:new Headers({origin}),json:async()=>body});
 return {request,sends,audiences,setRole:v=>{role=v},setSchool:v=>{school=v},setName:v=>{groupName=v},setGroupName:(id,name)=>groupNames.set(id,name),setFails:v=>{fails=v},setTargets:v=>{targets=v},setPushFailure:v=>{pushFailure=v}};
}
const draft={action:"preview",audience:"activityGroup",activityKey:"fieldTrip:exchange",text:"請志工 08:00 集合",requestId:"12345678-1234-1234-1234-123456789abc"};

test("two bound personal accounts receive independent push requests rather than a single multicast acceptance",async()=>{
 const h=fixture(),c=controller(h),targets=["U"+"1".repeat(32),"U"+"2".repeat(32)];c.setTargets(targets);
 const body={...draft,audience:"members",roles:["parent"],groups:[],allSchool:true},preview=await c.request(body);
 const sent=await c.request({...body,action:"send",preview:preview.data.preview});
 assert.deepEqual(c.sends.map(call=>call.to).sort(),targets);assert.equal(sent.data.accepted,2);assert.equal(sent.data.failed,0);
 assert.notEqual(c.sends[0].options.retryKey,c.sends[1].options.retryKey);
});

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
 assert.equal(c.sends[0].to,"U"+"1".repeat(32));assert.equal(sent.data.deliveryMode,"push");assert.equal(c.audiences[0].s,"school-a");assert.equal(c.audiences[0].b,bot);
 assert.equal((await c.request({...body,groups:["unknown"]})).status,400);
 assert.equal((await c.request({...body,groups:[],allSchool:false})).status,400);
 assert.equal((await c.request({...body,groups:[],allSchool:true})).status,200);
});

test("legacy staff selections route only to their bound groups and mixed notices keep members separate",async()=>{
 const h=fixture(),c=controller(h),body={...draft,audience:"members",activityKey:"",roles:["finance"],groups:["stale-team"],allSchool:false};
 for(const [key,id] of [["school:finance",groupA],["school:cadres",groupB]]){const binding=await h.api.createActivityLineBinding(channel,key,"admin");await h.api.consumeActivityLineBinding(channel,binding.code,id,"幹部群")}
 const p=await c.request(body);assert.equal(p.status,200);assert.match(p.data.targetLabel,/財務幹部群組/);assert.equal(c.audiences.length,0);
 const sent=await c.request({...body,action:"send",preview:p.data.preview});assert.equal(sent.data.accepted,1);
 assert.equal(c.sends[0].to,groupA);assert.equal(sent.data.groupAccepted,1);assert.equal(sent.data.deliveryMode,"group");
 assert.match((await h.api.lineAnnouncementHistory("school-a"))[0].label,/財務幹部群組/);
 const allStaff=await c.request({...body,roles:["staff"]});assert.match(allStaff.data.targetLabel,/幹部群組/);
 const mixed=await c.request({...body,roles:["parent","teacher","finance"],groups:["A"]});
 assert.equal(mixed.status,200);assert.match(mixed.data.targetLabel,/A 團的家長與老師；另通知財務幹部群組/);assert.deepEqual(Array.from(c.audiences[0].input.roles),["parent","teacher"]);
 const allMembers=await c.request({...body,roles:["parent"],groups:[],allSchool:true});assert.equal(allMembers.data.targetLabel,"所有團別的家長");
 assert.equal((await c.request({...body,roles:["parent","finance"]})).status,400);
 assert.equal((await c.request({...body,roles:["unknown"]})).status,400);
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
 const ctx={createLineAccountPanel:({api})=>({load:()=>api("/api/line/school-account"),destroy(){}}),console,document:{documentElement:{hasAttribute:()=>true},getElementById:id=>elements[id]||null,addEventListener(){}},location:{hash:"",search:"",pathname:"/line-account.html"},history:{replaceState(){}},URLSearchParams,
  sessionStorage:{getItem:()=>""},fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url==="/api/me"?{role:"parent",schoolId:"school-a",capabilities:{lineAccount:true,feeCollections:true}}:{configured:true,bound:true,googleLinked:true,authProvider:"google",lineDisplayName:"家長"}}}
 };
 runInNewContext(read("app/fee-collections.js").replace(/^import .*;\n/gm,"").replace('if(!legacyLineEntry)load();','globalThis.loadAccount=load;'),ctx);
 await ctx.loadAccount();assert.deepEqual(calls,["/api/me","/api/line/school-account"]);
 assert.equal(elements.roleTitle.textContent,"LINE 通知設定");assert.equal(elements.status.hidden,true);
 assert.doesNotMatch(elements.lineBinding.innerHTML,/收費|費用|專案/);
 const html=read("app/line-account.html");assert.doesNotMatch(html,/id="projects"|id="adminCreate"/);
 assert.match(read("api/src/functions/tenantLineLogin.js"),/resultUrl.pathname="\/line-account.html"/);
});


test("legacy LINE binding bookmarks redirect to the account-only page before requesting billing data",()=>{
 const redirects=[],calls=[];
 runInNewContext(read("app/fee-collections.js").replace(/^import .*;\n/gm,""),{document:{documentElement:{hasAttribute:()=>false},getElementById:()=>null,addEventListener(){}},location:{hash:"#lineBinding",search:"?line_link=confirm",replace:url=>redirects.push(url)},URLSearchParams,sessionStorage:{getItem:()=>""},fetch:(...args)=>calls.push(args)});
 assert.deepEqual(redirects,["/line-account.html?line_link=confirm#lineBinding"]);assert.equal(calls.length,0);
});

test("individual failures, transient retries and recipient history remain separate and never claim delivery",async()=>{
 const h=fixture(),c=controller(h),first="U"+"1".repeat(32),second="U"+"2".repeat(32),attempts=new Map(),keys=new Map();c.setTargets([first,second]);
 c.setPushFailure((to,options)=>{
  const n=(attempts.get(to)||0)+1;attempts.set(to,n);
  if(keys.has(to))assert.equal(options.retryKey,keys.get(to));else keys.set(to,options.retryKey);
  if(to===first&&n===1)return Object.assign(Error("temporary secret-token"),{status:503});
  if(to===second)return Object.assign(Error("private-provider-body"),{status:400});
  return null;
 });
 const body={...draft,audience:"members",roles:["parent"],groups:[],allSchool:true},p=await c.request(body);
 assert.deepEqual(Array.from(p.data.recipients,entry=>entry.name),["Roy","Eileen"]);assert.equal(p.data.deliveryConfirmed,false);
 const result=await c.request({...body,action:"send",preview:p.data.preview});
 assert.equal(result.data.accepted,1);assert.equal(result.data.failed,1);assert.equal(result.data.deliveryConfirmed,false);
 assert.equal(attempts.get(first),2);assert.equal(attempts.get(second),1);
 assert.deepEqual(Array.from(result.data.recipientResults,entry=>entry.status),["accepted","failed"]);
 assert.equal(result.data.recipientResults[1].httpStatus,400);
 const history=(await h.api.lineAnnouncementHistory("school-a"))[0];assert.equal(history.deliveryMode,"push");
 assert.deepEqual(Array.from(history.recipientResults,entry=>entry.name),["Roy","Eileen"]);assert.equal(history.deliveryConfirmed,false);
 const output=JSON.stringify([p.data,result.data,history]);assert.doesNotMatch(output,/secret-token|private-provider-body|accessToken/);assert.ok(!output.includes(first)&&!output.includes(second));
 const initialKey=keys.get(first);await c.request({...body,action:"send",preview:p.data.preview});assert.equal(keys.get(first),initialKey);
});

test("recipient detail storage is tenant-scoped, size-bounded, and strips identifiers and credentials",async()=>{
 const h=fixture(),all=Array.from({length:130},(_,index)=>({reference:index.toString(16).padStart(12,"0"),name:"家長".repeat(100),status:index%2?"failed":"accepted",httpStatus:400,userId:"private-user",accessToken:"secret"}));
 await h.api.recordLineAnnouncement("school-a",{...draft,requestId:"history-size",label:"家長",text:"公告",accepted:65,failed:65,deliveryMode:"push",recipientResults:all});
 const stored=[...h.rows("TenantLineNotificationCenter").values()].find(row=>row.rowKey==="sent:history-size");assert.ok(stored.recipientResults.length<30000);
 const history=(await h.api.lineAnnouncementHistory("school-a"))[0];assert.equal(history.recipientResults.length,100);assert.equal(history.omittedRecipients,30);
 assert.equal(history.recipientResults[0].name.length,80);assert.doesNotMatch(JSON.stringify(history),/private-user|secret|accessToken/);
 assert.equal((await h.api.lineAnnouncementHistory("school-b")).length,0);
 await h.api.recordLineAnnouncement("school-a",{requestId:"old",audience:"members",label:"舊公告",text:"舊版",accepted:2,failed:0});
 const legacy=(await h.api.lineAnnouncementHistory("school-a")).find(row=>row.label==="舊公告");assert.equal(legacy.deliveryMode,"multicast");assert.equal(legacy.recipientResults.length,0);
 await h.api.recordLineAnnouncement("school-a",{requestId:"escaped",audience:"members",label:"控制字元",text:"文字",accepted:130,failed:0,deliveryMode:"push",recipientResults:all.map(row=>({...row,name:"\u0000".repeat(80)}))});
 const escaped=[...h.rows("TenantLineNotificationCenter").values()].find(row=>row.rowKey==="sent:escaped");assert.ok(escaped.recipientResults.length<=30000);
 const detail=(await h.api.lineAnnouncementHistory("school-a")).find(row=>row.label==="控制字元");assert.equal(detail.omittedRecipients,130-detail.recipientResults.length);
});

const existingGroup=(targetId,targetLabel)=>({targetId,targetLabel,targetType:"group",botUserId:bot});
test("both existing platform groups appear by their saved names without creating or rebinding groups",async()=>{
 const h=fixture();h.setExisting("school-a","admin",existingGroup(groupA,"後援幹部群"));h.setExisting("school-a","absence",existingGroup(groupB,"學校老師群"));
 const c=controller(h),result=await c.request();assert.equal(result.status,200);
 const groups=result.data.schoolGroups;assert.equal(groups.find(x=>x.key==="school:cadres").groupName,"後援幹部群");assert.equal(groups.find(x=>x.key==="school:teachers").groupName,"學校老師群");
 assert.equal(groups.filter(x=>x.bound).length,2);assert.equal(groups.find(x=>x.key==="school:teachers").sourceLabel,"平台學生缺席通知群組");assert.equal(h.rows("TenantLineNotificationCenter").size,0);
 assert.doesNotMatch(JSON.stringify(groups),/targetId|groupId|secret-a|token-a/);assert.equal(c.sends.length,0);
 await assert.rejects(h.api.clearActivityLineGroup("school-a",bot,"school:cadres"),/沿用平台原有綁定/);
});
test("verified same-school legacy groups retain their names without a new binding, while stale or unrelated channels stay isolated",async()=>{
 const h=fixture(),legacy={targetId:groupA,targetLabel:"原有幹部群",targetType:"group",botUserId:""};
 h.setExisting("school-a","admin",legacy);
 h.setChannel("school-a",{...channel,loginConfigured:false,acceptsLegacy:true});
 const group=await h.api.getActivityLineGroup("school-a",bot,"school:cadres");
 assert.equal(group.groupId,groupA);assert.equal(group.groupName,"原有幹部群");assert.equal(group.source,"settings");
 assert.equal(h.rows("TenantLineNotificationCenter").size,0);assert.equal(legacy.botUserId,"");
 assert.equal((await h.api.listSchoolLineGroups("school-a",bot)).find(x=>x.key==="school:cadres").bound,true);
 for(const override of [{acceptsLegacy:false},{configured:false},{schoolId:"school-b"},{botUserId:"U"+"b".repeat(32)}]){
  h.setChannel("school-a",{...channel,acceptsLegacy:true,...override});
  assert.equal(await h.api.getActivityLineGroup("school-a",bot,"school:cadres"),null);
 }
 h.setChannel("school-a",{...channel,acceptsLegacy:true});
 h.setExisting("school-a","admin",{...legacy,botUserId:"U"+"b".repeat(32)});
 assert.equal(await h.api.getActivityLineGroup("school-a",bot,"school:cadres"),null);
 assert.equal(await h.api.getActivityLineGroup("school-b",bot,"school:cadres"),null);
 assert.equal(h.rows("TenantLineNotificationCenter").size,0);
});
test("an existing production Messaging-only account can preview and notify its original groups while OAuth stays disabled",async()=>{
 const school="sacred-heart",lookups=[];
 const config=runInNewContext(strip(read("api/src/lib/lineTenantConfig.js"))+";({resolveTenantLineChannel,listTenantLineLoginSchools})",{
  createHash,URL,process:{env:{LINE_CHANNEL_SECRET:"legacy-secret",LINE_CHANNEL_ACCESS_TOKEN:"legacy-token",LINE_APP_ORIGIN:channel.appOrigin}},defaultTenantId:()=>school,tenantSchoolPartition:String,getTenantDirectory:async()=>({status:"active"}),
  TableClient:{fromConnectionString:()=>({getEntity:async()=>{throw missing(404)},async *listEntities(){}})},lineApi:async(path,options)=>{lookups.push({path,options});return {userId:bot}}
 });
 const resolved=await config.resolveTenantLineChannel(school);assert.equal(resolved.loginConfigured,false);assert.equal(resolved.botUserId,bot);assert.equal(resolved.appOrigin,channel.appOrigin);
 assert.equal((await config.listTenantLineLoginSchools([{schoolId:school,status:"active"}])).length,0);
 const h=fixture();h.setChannel(school,resolved);
 for(const [purpose,id,name] of [["admin",groupA,"原有幹部群"],["absence",groupB,"原有學校群"]])h.setExisting(school,purpose,{targetType:"group",targetId:id,targetLabel:name,botUserId:""});
 const c=controller(h,{resolvedChannel:resolved});c.setGroupName(groupA,"原有幹部群");c.setGroupName(groupB,"原有學校群");
 const options=await c.request();assert.equal(options.status,200);assert.equal(options.data.schoolGroups.filter(x=>x.bound).length,2);
 const body={...draft,audience:"schoolGroups",schoolGroupKeys:["school:cadres","school:teachers"]},preview=await c.request(body);
 assert.equal(preview.status,200);assert.equal(preview.data.groupDeliverable,2);assert.equal(c.sends.length,0);
 const result=await c.request({...body,action:"send",preview:preview.data.preview});assert.equal(result.status,200);assert.equal(result.data.groupAccepted,2);
 assert.deepEqual(c.sends.map(x=>x.to).sort(),[groupA,groupB]);assert.ok(c.sends.every(x=>x.options.accessToken==="legacy-token"));assert.equal(c.audiences.length,0);
 assert.equal([...h.rows("TenantLineNotificationCenter").values()].some(row=>row.rowKey.startsWith("group:")),false);assert.equal(lookups.length,1);
});
test("selecting both existing groups sends one push per group and never resolves individual admin accounts",async()=>{
 const h=fixture();h.setExisting("school-a","admin",existingGroup(groupA,"後援幹部群"));h.setExisting("school-a","absence",existingGroup(groupB,"學校老師群"));
 const c=controller(h);c.setGroupName(groupA,"後援幹部群");c.setGroupName(groupB,"學校老師群");
 const body={...draft,audience:"schoolGroups",schoolGroupKeys:["school:teachers","school:cadres"],roles:["staff","teacher"],groups:["stale"]},p=await c.request(body);
 assert.equal(p.status,200);assert.equal(p.data.groupDeliverable,2);assert.equal(p.data.memberDeliverable,0);assert.equal(p.data.deliveryMode,"group");assert.equal(c.sends.length,0);
 const result=await c.request({...body,action:"send",preview:p.data.preview});assert.equal(result.data.groupAccepted,2);assert.equal(result.data.accepted,2);assert.equal(c.audiences.length,0);
 assert.deepEqual(c.sends.map(x=>x.to).sort(),[groupA,groupB]);assert.ok(c.sends.every(x=>x.options.accessToken===channel.accessToken));assert.notEqual(c.sends[0].options.retryKey,c.sends[1].options.retryKey);
 const history=(await h.api.lineAnnouncementHistory("school-a"))[0];assert.equal(history.deliveryMode,"group");assert.equal(history.groupAccepted,2);assert.ok(history.recipientResults.every(x=>x.kind==="group"));assert.doesNotMatch(JSON.stringify([p.data,result.data,history]),new RegExp(groupA+"|"+groupB+"|token-a"));
});
test("one LINE group assigned to two school uses receives only one message",async()=>{
 const h=fixture();for(const purpose of ["admin","absence"])h.setExisting("school-a",purpose,existingGroup(groupA,"同一群組"));const c=controller(h);
 const body={...draft,audience:"schoolGroups",schoolGroupKeys:["school:cadres","school:teachers","school:cadres"]},p=await c.request(body);
 assert.equal(p.data.groupDeliverable,1);const result=await c.request({...body,action:"send",preview:p.data.preview});assert.equal(result.data.accepted,1);assert.equal(c.sends.length,1);
});
test("missing, foreign-bot and foreign-school groups fail without falling back to 1v1 staff recipients",async()=>{
 const h=fixture(),c=controller(h),body={...draft,audience:"schoolGroups",schoolGroupKeys:["school:cadres"]};
 assert.equal((await c.request(body)).status,409);h.setExisting("school-a","admin",{...existingGroup(groupA,"幹部群"),botUserId:"different-bot"});assert.equal((await c.request(body)).status,409);
 h.setExisting("school-a","admin",existingGroup(groupA,"幹部群"));c.setSchool("school-b");assert.equal((await c.request(body)).status,409);
 c.setSchool("school-a");assert.equal((await c.request({...body,schoolGroupKeys:["school:unknown"]})).status,409);assert.equal((await c.request({...body,schoolGroupKeys:[]})).status,400);
 h.setExisting("school-a","admin",{});assert.equal((await c.request({...body,audience:"members",roles:["staff"],groups:[]})).status,409);assert.equal(c.audiences.length,0);assert.equal(c.sends.length,0);
});
test("changing an existing binding or removing the bot after preview prevents a stale group send",async()=>{
 const h=fixture();h.setExisting("school-a","admin",existingGroup(groupA,"幹部群"));const c=controller(h),body={...draft,audience:"schoolGroups",schoolGroupKeys:["school:cadres"]},p=await c.request(body);
 h.setExisting("school-a","admin",existingGroup(groupB,"新幹部群"));assert.equal((await c.request({...body,action:"send",preview:p.data.preview})).status,409);assert.equal(c.sends.length,0);
 const next=await c.request(body);c.setGroupName(groupB,null);assert.equal((await c.request({...body,action:"send",preview:next.data.preview})).status,409);assert.equal(c.sends.length,0);
});
test("school binding codes preserve the old platform group until replacement and signed group replies confirm the selected use",async()=>{
 const h=fixture();h.setExisting("school-a","admin",existingGroup(groupA,"原幹部群"));const c=controller(h);
 const binding=await c.request({action:"school-binding-code",schoolGroupKey:"school:cadres"});assert.equal(binding.status,200);assert.equal(binding.data.scope,"school");assert.equal(h.api.parseActivityLineBinding("#綁定學校通知 "+binding.data.code),binding.data.code);
 assert.equal((await h.api.getActivityLineGroup("school-a",bot,"school:cadres")).groupId,groupA);
 const handlers={},replies=[];runInNewContext(strip(read("api/src/functions/lineWebhook.js")),{app:{http:(name,config)=>{handlers[name]=config.handler}},json:(data,status=200)=>({data,status}),Buffer,console,verifyLineSignature,...h.api,tenantIdValue:x=>x,resolveTenantLineChannel:async()=>channel,replyLineMessage:async(_,text)=>replies.push(text),getLineGroupSummary:async()=>({groupName:"新幹部群"})});
 const raw=Buffer.from(JSON.stringify({destination:bot,events:[{type:"message",source:{type:"group",groupId:groupB},message:{type:"text",text:"#綁定學校通知 "+binding.data.code},replyToken:"reply"}]}));
 await handlers.tenantLineWebhook({params:{schoolId:"school-a"},headers:new Headers({"x-line-signature":createHmac("sha256",channel.channelSecret).update(raw).digest("base64")}),arrayBuffer:async()=>raw});
 assert.match(replies[0],/已綁定幹部群組/);assert.equal((await h.api.getActivityLineGroup("school-a",bot,"school:cadres")).groupId,groupB);
 assert.equal(await h.api.consumeActivityLineBinding(channel,binding.data.code,groupA,"重複"),null);assert.equal(h.tables.has("SystemSettings"),false);
});
test("mixed notices send member messages to people and staff messages only to the reused group",async()=>{
 const h=fixture();h.setExisting("school-a","admin",existingGroup(groupA,"幹部群"));const c=controller(h);
 const body={...draft,audience:"members",activityKey:"",roles:["parent"],groups:["A"],schoolGroupKeys:["school:cadres"]},p=await c.request(body),result=await c.request({...body,action:"send",preview:p.data.preview});
 assert.equal(result.data.deliveryMode,"mixed");assert.equal(result.data.accepted,2);assert.equal(result.data.groupAccepted,1);assert.equal(c.audiences.length,2);assert.deepEqual(Array.from(c.audiences[0].input.roles),["parent"]);
 assert.deepEqual(c.sends.map(x=>x.to).sort(),[groupA,"U"+"1".repeat(32)].sort());
});
