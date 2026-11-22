import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createHash} from "node:crypto";
import {uniformNeedsPayment} from "../api/src/lib/paymentNoticeRules.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const strip=source=>source.replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
const workspace=read("app/school-admin-workspace.js"),adminSource=read("app/uniform-event-admin.js");
function harness(){
 const stores=new Map(),outbound=[],mails=[],parentNotices=[];let role="parent",schoolId="school-a",seq=0,version=0,groupFailure=false,adminFailure=false,blocked=false,groupBot="",mode="instant_only",admins=[{partitionKey:"admin@example.test",role:"schoolAdmin",status:"active"}];
 const db=name=>{
  if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name);
  const get=(p,r)=>{const row=rows.get(p+"|"+r);if(!row)throw Object.assign(Error("missing"),{statusCode:404});return structuredClone(row)};
  return {createTable:async()=>{},getEntity:async(p,r)=>get(p,r),createEntity:async row=>{const key=row.partitionKey+"|"+row.rowKey;if(rows.has(key))throw Object.assign(Error("exists"),{statusCode:409});rows.set(key,{...row,etag:"v"+(++version)})},
   updateEntity:async(row,type,options)=>{const old=get(row.partitionKey,row.rowKey);if(options?.etag&&old.etag!==options.etag)throw Object.assign(Error("changed"),{statusCode:412});rows.set(row.partitionKey+"|"+row.rowKey,{...(type==="Replace"?{}:old),...row,etag:"v"+(++version)})},
   listEntities:async function*({queryOptions}={}){for(const row of rows.values())if(!queryOptions||queryOptions.filter.includes("'"+row.partitionKey+"'"))yield structuredClone(row)}
  };
 };
 const scope={createHash,URL,console:{info(){},warn(){},error(){}},process:{env:{LAB_ENVIRONMENT:"functional-uat",STORAGE_CONNECTION_STRING:"test"}},TableClient:{fromConnectionString:(_conn,name)=>db(name)},
  tenantEmailAddress:value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value||"")?String(value):"",tenantEmailConfig:school=>({connectionString:"mail-"+school,senderAddress:"school@example.test"}),
  EmailClient:class{async beginSend(message){mails.push(message);return {}}},getTenantLineParentContact:async()=>null,getTenantLineRecipient:async()=>({lineUserId:"individual-admin"}),
  resolveTenantLineChannel:async school=>({configured:true,loginConfigured:true,botUserId:"bot-"+school,accessToken:"token-"+school}),
  getLineNotificationTarget:async school=>({mode,targetId:"group-"+school,targetType:"group",botUserId:groupBot||"bot-"+school}),lineTargetMatchesChannel:(target,channel)=>target.botUserId===channel.botUserId,
  listTenantAdmins:async()=>{if(adminFailure)throw Error("directory unavailable");return admins},pushLineMessage:async(target,text,options)=>{if(groupFailure&&target.startsWith("group-"))throw Error("group rejected");outbound.push({target,text,options})}
 };
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/labNoticeDelivery.mjs")).replace("const buildEnablesLineFirstLab = false;","const buildEnablesLineFirstLab = true;")+";({lineFirstLabEnabled,deliverLabNotice,labNoticeLineResult,labNoticeUrl})",scope));
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/lineAdminTodoNotification.mjs")).replace("const buildEnablesLabAdminTodos = false;","const buildEnablesLabAdminTodos = true;")+";({notifyUniformReview,notifyUniformCancellation,uniformReviewNotice})",scope));
 let handler;
 const apiScope={...scope,app:{http:(_name,config)=>{handler=config.handler}},randomUUID:()=>"request-"+(++seq),getTenantContext:async()=>({schoolId,access:{role,email:role==="parent"?"parent@example.test":"admin@example.test",capabilities:{financeVerifier:true}}}),ensureStudentAccess:(_a,id)=>id==="student-one"&&!blocked,
  getStudentAliasInfo:async id=>({canonicalStudentId:id}),getStudentMaster:async id=>id==="student-one"?{studentName:"甲同學",groupName:"A"}:null,listUserStudentMappings:async()=>[],json:(jsonBody,status=200)=>({status,jsonBody}),
  upsertCurrentCompetitionMaster:async()=>{},latestCompetitionRequest:items=>items[0],getUniformPrice:async()=>({unitPrice:2625}),activeTshirtClaim:async()=>null,paymentOnHold:()=>false,
  uniformNeedsPayment,safePaymentNotifications:async()=>({status:"disabled"}),paymentNotificationStatus:result=>result?.status,uniformPaymentLineStates:async()=>({}),uniformPaymentLineEligible:uniformNeedsPayment,notifyUniformPaymentRequired:async(_school,item)=>{parentNotices.push(item);return {status:"accepted"}}
 };
 runInNewContext(strip(read("api/src/functions/uniformEventRequests.js")),apiScope);
 const input={kind:"competitionUniform",studentId:"student-one",style:"女",size:"XS",acquisition:"PURCHASE"};
 const call=(method,body)=>handler({method,query:new URLSearchParams(),json:async()=>body});
 const setBank=async school=>db("TenantUniformPaymentAccounts").createEntity({partitionKey:school,rowKey:"uniform:competitionUniform",payload:'{"templateId":"bank"}'});
 const get=async()=>{const result=await call("GET");return result.jsonBody.items?.[0]};
 return {...scope,db,stores,outbound,mails,parentNotices,input,call,setBank,get,post:async(body=input)=>{await setBank(schoolId).catch(()=>{});return call("POST",body)},admin:()=>{role="admin"},setRole:value=>{role=value},setSchool:value=>{schoolId=value},setAdmins:value=>{admins=value},setAdminFailure:()=>{adminFailure=true},setGroupFailure:()=>{groupFailure=true},setGroupBot:value=>{groupBot=value},setMode:value=>{mode=value},setBlocked:()=>{blocked=true}};
}
test("a self-funded A-group application persists its original payable stage and notifies the same school's existing group",async()=>{
 const h=harness(),created=await h.post(),item=created.jsonBody.item;
 assert.equal(created.status,201);assert.equal(item.status,"APPROVED");assert.equal(item.paymentStatus,"AWAITING_TRANSFER");assert.equal(item.amount,2625);assert.equal(created.jsonBody.staffLineStatus,"sent");assert.equal(h.parentNotices.length,1);
 assert.equal(h.outbound.length,1);assert.equal(h.outbound[0].target,"group-school-a");assert.equal(h.outbound[0].options.accessToken,"token-school-a");assert.match(h.outbound[0].text,/A 團比賽服自費買斷申請，待家長匯款/);assert.doesNotMatch(h.outbound[0].text,/申請待審|parent@example|student-one/);assert.equal(h.mails.length,0);
 const saved=await h.get();assert.equal(saved.id,item.id);assert.equal(saved.status,item.status);assert.equal(saved.paymentStatus,item.paymentStatus);
});
test("public competition applications and shirt applications retain pending review notices without a payment prerequisite",async()=>{
 const h=harness();const publicResult=await h.post({...h.input,acquisition:"PUBLIC"});assert.equal(publicResult.jsonBody.item.status,"PENDING");assert.equal(publicResult.jsonBody.item.amount,0);assert.match(h.outbound[0].text,/A 團比賽服申請待審/);
 const shirt=await h.call("POST",{kind:"regularUniform",studentId:"student-one",size:"S",quantity:1});assert.equal(shirt.jsonBody.item.status,"PENDING");assert.match(h.outbound[1].text,/團 T 申請待審/);assert.equal(h.parentNotices.length,0);
});
test("a successfully notified group does not depend on individual admin accounts and never also sends email",async()=>{
 const h=harness();h.setAdmins([]);h.setAdminFailure();const result=await h.post();assert.equal(result.jsonBody.staffLineStatus,"sent");assert.equal(h.outbound.length,1);assert.equal(h.mails.length,0);
});
test("replaying an existing application notice changes neither request nor finances and never repeats the accepted group message",async()=>{
 const h=harness();await h.post();h.admin();const item=await h.get(),before=JSON.stringify(item);
 for(let i=0;i<2;i++){const result=await h.call("PATCH",{action:"SEND_STAFF_NOTICE",id:item.id,etag:item.etag});assert.equal(result.status,200);assert.equal(result.jsonBody.staffLineStatus,"sent")}
 assert.equal(h.outbound.length,1);assert.equal(h.mails.length,0);assert.equal(h.parentNotices.length,1);assert.equal(JSON.stringify(await h.get()),before);
});
test("missing older application notifications can be replayed from the persisted row without creating a second application",async()=>{
 const h=harness();h.admin();await h.db("TenantUniformEventRequest").createEntity({partitionKey:"school-a",rowKey:"old-buyout",updatedAt:"2026-11-22T10:00:00Z",payload:JSON.stringify({...h.input,status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",amount:2625,parentEmail:"parent@example.test"})});
 const item=await h.get(),result=await h.call("PATCH",{action:"SEND_STAFF_NOTICE",id:item.id,etag:item.etag});assert.equal(result.status,200);assert.equal(result.jsonBody.staffLineStatus,"sent");assert.equal(h.outbound.length,1);assert.equal(h.stores.get("TenantUniformEventRequest").size,1);assert.equal(h.parentNotices.length,0);
});
test("a failed group notification falls back to authorized admin email instead of sending individual LINE messages",async()=>{
 const h=harness();h.setGroupFailure();h.setAdmins([{partitionKey:"admin@example.test",status:"active",role:"schoolAdmin"},{partitionKey:"teacher@example.test",status:"active",role:"teacher"},{partitionKey:"inactive@example.test",status:"inactive",role:"schoolAdmin"}]);const created=await h.post();
 assert.equal(created.status,201);assert.equal(created.jsonBody.staffLineStatus,"email_sent");assert.equal(h.outbound.length,0);assert.equal(h.mails.length,1);assert.equal(h.mails[0].recipients.to[0].address,"admin@example.test");assert.equal((await h.get()).paymentStatus,"AWAITING_TRANSFER");
});
test("the same request ID and recipient in another school cannot share a notification or bot",async()=>{
 const h=harness(),item={...h.input,id:"same-id",status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",amount:2625};await h.notifyUniformReview("school-a",item);await h.notifyUniformReview("school-b",item);assert.equal(h.outbound.length,2);assert.equal(h.outbound[1].target,"group-school-b");assert.equal(h.outbound[1].options.accessToken,"token-school-b");assert.notEqual(h.outbound[0].options.retryKey,h.outbound[1].options.retryKey);
});
test("parents, foreign schools, stale versions and non-payable stages cannot replay staff notices",async()=>{
 const h=harness();await h.post();const item=await h.get(),body={action:"SEND_STAFF_NOTICE",id:item.id,etag:item.etag};assert.equal((await h.call("PATCH",body)).status,403);
 h.admin();h.setSchool("school-b");assert.equal((await h.call("PATCH",body)).status,404);h.setSchool("school-a");assert.equal((await h.call("PATCH",{...body,etag:"stale"})).status,409);
 for(const extra of [{status:"CANCELLED"},{status:"FULFILLED"},{status:"ORDERED"},{paymentStatus:"REPORTED_UNVERIFIED"},{paymentStatus:"VERIFIED"},{paymentStatus:"REFUND_REQUESTED"},{acquisition:"PUBLIC"},{amount:0}])assert.equal(h.uniformReviewNotice({...item,...extra}),"");
 await h.db("TenantUniformEventRequest").updateEntity({partitionKey:"school-a",rowKey:item.id,payload:JSON.stringify({...item,status:"CANCELLED"})},"Replace",{etag:item.etag});const cancelled=await h.get();assert.equal((await h.call("PATCH",{...body,etag:cancelled.etag})).status,409);assert.equal(h.outbound.length,1);
});
test("an unauthorized parent's attempt cannot create a request or trigger notifications",async()=>{
 const h=harness();h.setBlocked();const result=await h.post();assert.equal(result.status,403);assert.equal(h.outbound.length,0);assert.equal(h.mails.length,0);assert.equal(h.stores.get("TenantUniformEventRequest").size,0);
});
function todoRuntime(items){
 const scope={state:{me:{role:"admin",capabilities:{}}},summary:{uniform:items,family:null,attendance:null,loadedAt:1,error:false,loading:false}};
 const start=workspace.indexOf(" function todoHtml(){"),end=workspace.indexOf(" function mountGuide",start);return runInNewContext(workspace.slice(start,end)+";todoHtml",scope);
}
test("school home lists buyouts awaiting transfer separately from public review and finance verification",()=>{
 const buyout={kind:"competitionUniform",acquisition:"PURCHASE",status:"APPROVED",paymentStatus:"AWAITING_TRANSFER",amount:2625};
 const html=todoRuntime([buyout,{...buyout,id:"public",acquisition:"PUBLIC",status:"PENDING"},{...buyout,paymentStatus:"VERIFIED"},{...buyout,paymentStatus:"REPORTED_UNVERIFIED"},{...buyout,status:"CANCELLED"},{...buyout,status:"FULFILLED"}])();
 assert.match(html,/data-admin-todo="competitionPayment"[\s\S]*?比賽服買斷｜待家長匯款<\/span><b>1 筆/);assert.match(html,/data-admin-todo="competition"[\s\S]*?比賽服申請待審<\/span><b>1 筆/);assert.doesNotMatch(html,/匯款待核帳/);
 const empty=todoRuntime([{...buyout,status:"FULFILLED"},{...buyout,paymentStatus:"VERIFIED"}])();assert.doesNotMatch(empty,/competitionPayment/);
});
test("buyout todo clicks open the competition application list in the existing school workspace",async()=>{
 const start=workspace.indexOf(" document.addEventListener('click',async e=>{"),end=workspace.indexOf(" document.addEventListener('click',e=>{",start);let click;const calls=[],frame={src:""};
 runInNewContext(workspace.slice(start,end),{document:{addEventListener:(_event,fn)=>{click=fn},getElementById:()=>frame},window:{openSchoolAdminWorkspace:async group=>calls.push(group)},encodeURIComponent,toast:message=>{throw Error(message)}});
 await click({preventDefault(){},target:{closest:()=>({dataset:{adminTodo:"competitionPayment"},hasAttribute:()=>false})}});assert.deepEqual(calls,["uniformAdmin"]);assert.match(frame.src,/uniform-event-admin.html\?embedded=school.*task=competition/);
});
test("uniform todos become visible while attendance is still loading instead of hiding behind that request",async()=>{
 let attendanceResolve;const attendance=new Promise(resolve=>{attendanceResolve=resolve}),scope={state:{me:{role:"admin",capabilities:{}}},summary:{key:"",loading:false,loadedAt:0},taskScopeKey:()=>"school-a",taipeiClock:()=>({date:"2026-11-22"}),organize(){},api:async path=>path.includes("daily-followup")?attendance:{items:[{kind:"competitionUniform",status:"APPROVED"}]}},start=workspace.indexOf(" async function loadTasks("),end=workspace.indexOf(" window.refreshSchoolAdminTodos",start);
 const load=runInNewContext(workspace.slice(start,end)+";loadTasks",scope),pending=load();await new Promise(resolve=>setImmediate(resolve));assert.equal(scope.summary.loading,true);assert.equal(scope.summary.uniform.length,1);attendanceResolve({date:"2026-11-22",items:[]});await pending;assert.equal(scope.summary.loading,false);assert.equal(scope.summary.error,false);
});
test("staff notice replay is visible only on an active parent application, with an explicit action and a scoped result",async()=>{
 const nodes={requests:{innerHTML:"",addEventListener:(_event,fn)=>{nodes.click=fn}},status:{textContent:""}},row={id:"order-one",etag:"v1",kind:"competitionUniform",parentEmail:"parent@example.test",status:"APPROVED",acquisition:"PURCHASE",paymentStatus:"AWAITING_TRANSFER",amount:2625},calls=[],scope={el:id=>nodes[id],esc:String,cachedStock:[],issueErrors:new Map(),requestUpdateFeedback:new Map(),hasFinanceAccess:false,window:{},visibleModuleRequests:[row],pendingRequestIds:new Set(),confirm:()=>true,renderModuleRequests(){},showRequestUpdateFeedback:(_row,text)=>calls.push(text),api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return {staffLineStatus:"sent"}}};
 const start=adminSource.indexOf("function table("),end=adminSource.indexOf("function csv(",start);runInNewContext(adminSource.slice(start,end),scope);
 scope.table("requests",[{...row,kind:"A 團比賽服"}],[["status","狀態"]],true);assert.match(nodes.requests.innerHTML,/data-staff-notice='0'>補送幹部通知/);
 scope.table("requests",[{...row,kind:"A 團比賽服",status:"FULFILLED"}],[["status","狀態"]],true);assert.doesNotMatch(nodes.requests.innerHTML,/data-staff-notice/);
 const from=adminSource.indexOf('el("requests").addEventListener("click",async e=>{'),to=adminSource.indexOf('el("inventoryForm").onsubmit=',from);runInNewContext(adminSource.slice(from,to),scope);
 const button={dataset:{staffNotice:"0"}};await nodes.click({target:{dataset:{},closest:selector=>selector==="button[data-staff-notice]"?button:null}});const mutation=calls.find(value=>value.body);assert.deepEqual(mutation.body,{action:"SEND_STAFF_NOTICE",id:row.id,etag:row.etag});assert.match(calls.at(-1),/幹部 LINE 通知已受理/);assert.equal(scope.pendingRequestIds.size,0);
});
