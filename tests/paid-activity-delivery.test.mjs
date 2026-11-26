import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const run=(path,context,expression)=>runInNewContext(read(path).replace(/^import .*;$/gm,"").replace(/^export /gm,"")+"\n"+expression,context);
const user=n=>"U"+String(n).padStart(32,"0"),bot=user(999);
const now=Date.now(),stamp=new Date(now).toISOString();
const activity={module:"yearEndDinner",id:"dinner",enabled:true,title:"測試餐會",targetGroups:"ALL",paymentOpen:true,feeStatus:"PUBLISHED",firstAdultFee:800,openAt:new Date(now-3600000).toISOString(),closeAt:new Date(now+3600000).toISOString()};
const schedule=run("api/src/lib/paidActivitySchedule.js",{isPaidActivityOpen:(a,n)=>!!a?.enabled&&(!a.closeAt||Date.parse(a.closeAt)>n),collectingTrip:()=>false},"({queuePaidActivityResend,paidActivityNoticeSummary})");

function sender(){
 const calls=[],lookups=[],mappings=[{studentId:"100001",parentEmail:"dad@test.invalid"},{studentId:"100001",parentEmail:"mom@test.invalid"},{studentId:"100002",parentEmail:"dad@test.invalid"}];
 const students=[{rowKey:"100001",groupName:"A 團"},{rowKey:"100002",groupName:"新團"}];
 const audience=run("api/src/lib/lineAudience.js",{
  resolveTenantLineChannel:async school=>({schoolId:school,botUserId:bot,configured:true}),
  listUserStudentMappings:async(status,school)=>{assert.equal(status,"active");assert.equal(school,"school-a");return mappings},
  getApprovedParentStudent:async(school,_email,id)=>{assert.equal(school,"school-a");return {studentId:id}},
  getTenantLineDeliveryRecipient:async(school,email,channel)=>{const botId=channel.botUserId;assert.deepEqual([school,botId],["school-a",bot]);lookups.push(email);return {parentEmail:email,lineUserId:email.startsWith("dad")?user(1):user(2)}}
 },"({resolveLineAudience})");
 const context={console,URL,process:{env:{}},workflowLineEnabled:()=>true,
  workflowLineRetryKey:(...parts)=>parts.join("/"),resolveTenantLineChannel:async school=>{assert.equal(school,"school-a");return {schoolId:school,loginConfigured:true,botUserId:bot,accessToken:"test-school-token",appOrigin:"https://school.invalid"}},
  lineAudienceStudents:async school=>{assert.equal(school,"school-a");return students},resolveLineAudience:audience.resolveLineAudience,
  lineApi:async(path,options)=>{calls.push({path,options})}
 };
 const logic=run("api/src/lib/paidActivityLine.js",context,"({notifyPaidActivityOpened})");
 return {context,calls,lookups,notify:logic.notifyPaidActivityOpened};
}

test("ALL includes both parents, a future group and a sibling without mixing identities or duplicate sends",async()=>{
 const h=sender(),result=await h.notify("school-a",activity,stamp,"registration");
 assert.equal(result.accepted,2);assert.equal(result.failed,0);assert.equal(result.deliveryMode,"push");
 assert.deepEqual(h.lookups.sort(),["dad@test.invalid","mom@test.invalid"]);
 assert.deepEqual(h.calls.map(x=>x.options.body.to).sort(),[user(1),user(2)]);
 for(const call of h.calls){assert.equal(call.path,"/v2/bot/message/push");assert.equal(call.options.accessToken,"test-school-token");assert.match(call.options.body.messages[0].text,/測試餐會/)}
 assert.notEqual(h.calls[0].options.retryKey,h.calls[1].options.retryKey);
 const keys=h.calls.map(x=>x.options.retryKey);await h.notify("school-a",activity,stamp,"registration");
 assert.deepEqual(h.calls.slice(2).map(x=>x.options.retryKey),keys);
});

test("one recipient failure is isolated and a transient retry retains that recipient's idempotency key",async()=>{
 const h=sender(),attempts=new Map(),keys=new Map();
 h.context.lineApi=async(path,options)=>{
  assert.equal(path,"/v2/bot/message/push");const id=options.body.to,n=(attempts.get(id)||0)+1;attempts.set(id,n);
  if(keys.has(id))assert.equal(options.retryKey,keys.get(id));else keys.set(id,options.retryKey);
  if(id===user(1)&&n===1)throw Object.assign(Error("temporary"),{status:503});
  if(id===user(2))throw Object.assign(Error("rejected"),{status:400});
 };
 const result=await h.notify("school-a",activity,stamp,"registration");
 assert.equal(result.status,"partial");assert.equal(result.accepted,1);assert.equal(result.failed,1);
 assert.equal(attempts.get(user(1)),2);assert.equal(attempts.get(user(2)),1);
});

test("a specific group accepts a spaced display label and still resolves both of that child's parents",async()=>{
 const h=sender();await h.notify("school-a",{...activity,targetGroups:"A"},stamp,"registration");
 assert.deepEqual(h.lookups.sort(),["dad@test.invalid","mom@test.invalid"]);
 assert.deepEqual(h.calls.map(x=>x.options.body.to).sort(),[user(1),user(2)]);
});

test("manual resend uses the persisted activity window and prevents simultaneous or rapid repeats",()=>{
 const row={partitionKey:"school-a",rowKey:"yearEndDinner:dinner",etag:"old",payload:JSON.stringify(activity),paidLineNotices:JSON.stringify({registration:{state:"accepted",key:"original",lastAttemptAt:new Date(now-120000).toISOString()},payment:{state:"accepted",key:"payment-original"}})};
 const queued=schedule.queuePaidActivityResend(row,now,"new-delivery");assert.ok(queued.row);
 assert.equal(queued.row.payload,row.payload);assert.equal(queued.row.etag,undefined);
 const notices=JSON.parse(queued.row.paidLineNotices);assert.equal(notices.registration.key,"new-delivery");assert.equal(notices.payment.key,"payment-original");
 assert.equal(schedule.queuePaidActivityResend(queued.row,now,"duplicate").status,409);
 for(const patch of [{enabled:false},{openAt:new Date(now+1000).toISOString()},{closeAt:stamp}])assert.equal(schedule.queuePaidActivityResend({...row,payload:JSON.stringify({...activity,...patch})},now,"forbidden").status,409);
 row.paidLineNotices=JSON.stringify({registration:{state:"accepted",lastAttemptAt:stamp}});assert.equal(schedule.queuePaidActivityResend(row,now+59000,"too-soon").status,409);
});

test("stored notification summaries expose counts, not recipient identities or request credentials",()=>{
 const row={paidLineNotices:JSON.stringify({registration:{state:"accepted",key:"secret-key",lastAttemptAt:stamp,result:{accepted:2,failed:0,unbound:1,deliveryMode:"push",email:"private",accessToken:"secret"}},payment:{state:"queued",at:stamp}})};
 const view=schedule.paidActivityNoticeSummary(row);assert.equal(view[0].accepted,2);assert.equal(view[0].deliveryMode,"push");
 assert.doesNotMatch(JSON.stringify(view),/private|secret|email|accessToken/);
 const text=read("api/src/functions/uniformEventConfig.js"),code=text.slice(text.indexOf("function publicValue("),text.indexOf('app.http("uniformEventConfig"'));
 const publicValue=runInNewContext(code+";publicValue",{fixedUniformModules:new Set(),paidActivityNoticeSummary:schedule.paidActivityNoticeSummary});
 const item={...row,rowKey:"yearEndDinner:dinner",payload:JSON.stringify(activity)};
 assert.equal(publicValue(item).activityLineNotifications,undefined);assert.equal(publicValue(item,true).activityLineNotifications[0].accepted,2);
});

test("resend API requires a school admin and never takes audience or fee settings from the resend request",async()=>{
 let handler,role="parent",writes=0,reads=0,dispatches=0;
 let row={partitionKey:"school-a",rowKey:"yearEndDinner:dinner",etag:"1",payload:JSON.stringify(activity),paidLineNotices:'{"registration":{"state":"accepted"}}'};
 const db={async createTable(){},async getEntity(school,key){assert.deepEqual([school,key],["school-a","yearEndDinner:dinner"]);reads++;return {...row}},async updateEntity(next,mode,{etag}){assert.equal(etag,row.etag);row={...next,etag:String(Number(etag)+1)};writes++}};
 run("api/src/functions/uniformEventConfig.js",{
  app:{http:(_,route)=>{handler=route.handler}},process:{env:{STORAGE_CONNECTION_STRING:"test"}},console,
  TableClient:{fromConnectionString:(_,name)=>name==="TenantUniformEventAudit"?{async createTable(){},async createEntity(){}}:db},
  getTenantContext:async()=>({schoolId:"school-a",access:{role,email:"admin@test.invalid"}}),json:(data,status=200)=>({data,status}),randomUUID:()=>"new-delivery",
  queuePaidActivityResend:schedule.queuePaidActivityResend,paidActivityNoticeSummary:schedule.paidActivityNoticeSummary,
  dispatchPaidActivityNotices:async(table,current)=>{assert.equal(table,db);assert.equal(JSON.parse(current.payload).targetGroups,"ALL");dispatches++;return [{kind:"registration",status:"accepted",accepted:2,failed:0,unbound:0}]}
 },"");
 const request={method:"POST",json:async()=>({action:"RESEND_LINE",module:"yearEndDinner",id:"dinner",targetGroups:"B",enabled:true})};
 assert.equal((await handler(request)).status,403);assert.equal(reads,0);assert.equal(writes,0);
 role="admin";assert.equal((await handler(request)).data.activityLineNotification.accepted,2);assert.equal(dispatches,1);
 assert.equal((await handler(request)).status,409);assert.equal(dispatches,1);
});

test("admin display distinguishes old batch notices and hides resend before opening or after the deadline",()=>{
 const text=read("app/uniform-event-admin.js"),code=text.slice(text.indexOf("function activityLineNoticeHtml("),text.indexOf("function renderConfigSummary("));
 const render=runInNewContext(code+";activityLineNoticeHtml",{esc:x=>String(x).replaceAll("<","&lt;")});
 assert.match(render(activity),/重新發送活動 LINE 通知/);
 assert.match(render({...activity,activityLineNotifications:[{kind:"registration",status:"accepted"}]}),/舊版批次通知/);
 for(const patch of [{enabled:false},{openAt:new Date(now+60000).toISOString()},{closeAt:new Date(now-1).toISOString()}])assert.doesNotMatch(render({...activity,...patch}),/data-line-resend-id/);
});
