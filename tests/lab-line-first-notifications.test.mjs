import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {financeRecipients} from "../api/src/lib/financeNoticeRules.mjs";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const withoutImports=source=>source.replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
function harness(){
 const records=new Map(),lines=[],mails=[],bindings=new Map(),contacts=new Map(),failLine=new Set(),failMail=new Set();let configured=true,finishFailure=false,mailUnknown=false,version=0;
 const db={createTable:async()=>{},getEntity:async(p,r)=>{const row=records.get(p+":"+r);if(!row)throw Object.assign(Error("missing"),{statusCode:404});return {...row}},
  createEntity:async row=>{const key=row.partitionKey+":"+row.rowKey;if(records.has(key))throw Object.assign(Error("exists"),{statusCode:409});records.set(key,{...row,etag:"e"+(++version)})},
  updateEntity:async(row,mode,options)=>{const key=row.partitionKey+":"+row.rowKey,old=records.get(key);if(options?.etag&&old?.etag!==options.etag)throw Object.assign(Error("changed"),{statusCode:412});if(finishFailure&&row.status==="accepted")throw Error("ledger timeout");records.set(key,{...(mode==="Replace"?{}:old),...row,etag:"e"+(++version)})}
 };
 class EmailClient{constructor(connection){this.connection=connection}async beginSend(message){mails.push({connection:this.connection,...message});if(mailUnknown)throw Error("network timeout");if(failMail.has(message.recipients.to[0].address))throw Object.assign(Error("bad recipient"),{statusCode:400});return {}}}
 const env={LAB_ENVIRONMENT:"functional-uat"};
 const scope={createHash,URL,TableClient:{fromConnectionString:(connection,name)=>{assert.equal(name,"TenantNotificationDelivery");return db}},EmailClient,process:{env},
  tenantEmailAddress:value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value||"")&&!String(value).endsWith(".invalid")?String(value).toLowerCase():"",
  tenantEmailConfig:(school,options)=>{assert.equal(options.fallback,true);return configured?{connectionString:"mail-"+school,senderAddress:"sender@"+school+".example.invalid"}:{}},
  getTenantLineParentContact:async(school,email)=>contacts.get(school+":"+email)||"",
  getTenantLineRecipient:async(school,email,bot)=>{assert.equal(bot,"bot-"+school);const id=bindings.get(school+":"+email);return id?{lineUserId:id}:null},
  resolveTenantLineChannel:async school=>({loginConfigured:true,botUserId:"bot-"+school,accessToken:"token-"+school}),
  pushLineMessage:async(user,text,options)=>{lines.push({user,text,options});if(failLine.has(user))throw Error("LINE rejected")}
 };
 const policy=read("api/src/lib/labNoticeDelivery.mjs").replace("const buildEnablesLineFirstLab = false;","const buildEnablesLineFirstLab = true;");
 const functions=runInNewContext(withoutImports(policy)+";({lineFirstLabEnabled,deliverLabNotice,labNoticeLineResult,labNoticeStates,labNoticeUrl})",scope);
 const notice={schoolId:"school-a",eventId:"event-one",recipients:["alice@example.test"],subject:"團 T 核准",text:"應繳 NT$ 400"};
 return {...functions,scope,notice,records,lines,mails,bindings,contacts,failLine,failMail,setConfigured:value=>{configured=value},setFinishFailure:value=>{finishFailure=value},setMailUnknown:value=>{mailUnknown=value},env};
}
test("accepted LINE suppresses Email and repeated delivery preserves the first chosen channel",async()=>{
 const h=harness();h.bindings.set("school-a:alice@example.test","user-a");const result=await h.deliverLabNotice(h.notice);
 assert.equal(result.status,"sent");assert.equal(result.channel,"line");assert.equal(h.lines.length,1);assert.equal(h.mails.length,0);
 const again=await h.deliverLabNotice(h.notice);assert.equal(again.channel,"line");assert.equal(h.lines.length,1);assert.equal(h.mails.length,0);
 assert.equal(h.lines[0].options.accessToken,"token-school-a");assert.ok(h.lines[0].options.retryKey);
});
test("an unbound recipient gets one Email fallback and does not get a second channel after later binding",async()=>{
 const h=harness();const result=await h.deliverLabNotice(h.notice);assert.equal(result.channel,"email");assert.equal(result.mailAcceptedCount,1);
 assert.equal(h.lines.length,0);assert.equal(h.mails.length,1);assert.equal(h.mails[0].recipients.to[0].address,"alice@example.test");
 h.bindings.set("school-a:alice@example.test","user-a");await h.deliverLabNotice(h.notice);assert.equal(h.lines.length,0);assert.equal(h.mails.length,1);
});
test("mixed recipients are decided individually: only missing or failed LINE deliveries fall back to Email",async()=>{
 const h=harness();h.bindings.set("school-a:alice@example.test","user-a");h.bindings.set("school-a:carol@example.test","user-c");h.failLine.add("user-c");
 const result=await h.deliverLabNotice({...h.notice,recipients:["alice@example.test","bob@example.test","carol@example.test"]});
 assert.equal(result.channel,"mixed");assert.equal(result.lineAcceptedCount,1);assert.equal(result.mailAcceptedCount,2);
 assert.deepEqual(h.mails.map(m=>m.recipients.to[0].address).sort(),["bob@example.test","carol@example.test"]);
});
test("verified LINE aliases and Gmail are deduplicated before choosing fallback transport",async()=>{
 const h=harness(),alias="line-11111111-1111-1111-1111-111111111111@line.invalid";h.contacts.set("school-a:"+alias,"alice@example.test");
 const result=await h.deliverLabNotice({...h.notice,recipients:[alias,"ALICE@example.test","alice@example.test"]});
 assert.equal(result.recipientCount,1);assert.equal(h.mails.length,1);assert.equal(h.mails[0].recipients.to[0].address,"alice@example.test");
});
test("a synthetic LINE login without a verified Email is not sent to an invented address",async()=>{
 const h=harness();const result=await h.deliverLabNotice({...h.notice,recipients:["line-11111111-1111-1111-1111-111111111111@line.invalid"]});
 assert.equal(result.status,"failed");assert.equal(h.labNoticeLineResult(result).status,"email_missing");assert.equal(h.mails.length,0);
});
test("missing mail configuration is visible and remains retryable after configuration is supplied",async()=>{
 const h=harness();h.setConfigured(false);assert.equal(h.labNoticeLineResult(await h.deliverLabNotice(h.notice)).status,"email_not_configured");assert.equal(h.mails.length,0);
 h.setConfigured(true);assert.equal((await h.deliverLabNotice(h.notice)).channel,"email");assert.equal(h.mails.length,1);
});
test("a provider-unknown Email result is never treated as success or automatically repeated",async()=>{
 const h=harness();h.setMailUnknown(true);assert.equal((await h.deliverLabNotice(h.notice)).status,"unconfirmed");
 h.setMailUnknown(false);assert.equal((await h.deliverLabNotice(h.notice)).status,"unconfirmed");assert.equal(h.mails.length,1);
});
test("an accepted LINE response followed by a ledger failure cannot cause an Email duplicate",async()=>{
 const h=harness();h.bindings.set("school-a:alice@example.test","user-a");h.setFinishFailure(true);
 assert.equal((await h.deliverLabNotice(h.notice)).status,"unconfirmed");h.setFinishFailure(false);
 assert.equal((await h.deliverLabNotice(h.notice)).status,"unconfirmed");assert.equal(h.lines.length,1);assert.equal(h.mails.length,0);
});
test("obsolete payment notifications stop both transports, including after LINE setup",async()=>{
 const h=harness();assert.equal((await h.deliverLabNotice({...h.notice,stillDue:async()=>false})).status,"obsolete");assert.equal(h.lines.length,0);assert.equal(h.mails.length,0);
 const later=await h.deliverLabNotice({...h.notice,eventId:"event-two",lineSender:async()=>"ineligible"});assert.equal(later.status,"obsolete");assert.equal(h.mails.length,0);
});
test("school-scoped configuration, recipient lookup and delivery records cannot cross tenants",async()=>{
 const h=harness();h.bindings.set("school-b:alice@example.test","user-b");
 await h.deliverLabNotice(h.notice);await h.deliverLabNotice({...h.notice,schoolId:"school-b"});
 assert.equal(h.mails[0].connection,"mail-school-a");assert.equal(h.lines[0].options.accessToken,"token-school-b");assert.equal(h.records.size,2);
 h.env.LAB_ENVIRONMENT="production";assert.equal((await h.deliverLabNotice({...h.notice,eventId:"event-three"})).status,"disabled");assert.equal(h.mails.length,1);
});
test("LAB mail is allowed only for the generated fallback path and honors the tenant's explicit disable",()=>{
 const env={LAB_ENVIRONMENT:"functional-uat",ACS_EMAIL_SCHOOL_A_CONNECTION_STRING:"mail-a",ACS_EMAIL_SCHOOL_A_SENDER:"sender@example.test"};
 const raw=read("api/src/lib/tenantEmailConfig.mjs").replace("const buildSuppressesExternalEmail = false;","const buildSuppressesExternalEmail = true;").replace("const buildEnablesLabEmailFallback = false;","const buildEnablesLabEmailFallback = true;");
 const config=runInNewContext(withoutImports(raw)+";tenantEmailConfig",{process:{env},URL,defaultTenantId:()=>"school-a"});
 assert.equal(config("school-a").mode,"lab_suppressed");assert.equal(config("school-a",{fallback:true}).connectionString,"mail-a");
 assert.equal(config("school-b",{fallback:true}).connectionString,"");env.ACS_EMAIL_SCHOOL_A_ENABLED="false";assert.equal(config("school-a",{fallback:true}).mode,"disabled");
});
test("payment, teacher-account and uniform-status Email entry points follow the same LINE-first policy",async()=>{
 const h=harness();h.bindings.set("school-a:alice@example.test","user-a");
 const api=runInNewContext(withoutImports(read("api/src/lib/email.js"))+";({sendPaymentRequiredEmail,sendUniformRequestStatusEmail,sendTeacherAccessEnabledEmail})",{...h.scope,...h});
 const paid=await api.sendPaymentRequiredEmail({schoolId:"school-a",recipient:"alice@example.test",title:"團 T",amount:400});assert.equal(paid.channel,"line");assert.equal(h.mails.length,0);
 const teacher=await api.sendTeacherAccessEnabledEmail({schoolId:"school-a",recipient:"bob@example.test",teacherName:"老師乙"});assert.equal(teacher.channel,"email");assert.match(h.mails[0].content.plainText,/老師乙[\s\S]*LINE 綁定/);
 const status=await api.sendUniformRequestStatusEmail({schoolId:"school-a",recipients:["alice@example.test"],studentName:"學生甲",kind:"regularUniform",status:"READY_FOR_PICKUP",size:"S"});assert.equal(status.channel,"line");assert.equal(h.mails.length,1);
 assert.ok(h.lines.every(line=>line.text.includes("icy-ocean-0a2602100-lineuat")));
});
test("private lessons route each guardian separately while retaining the specialized LINE review sender",async()=>{
 const h=harness();const email=runInNewContext(withoutImports(read("api/src/lib/email.js"))+";({sendPrivateLessonWorkflowEmail,formatPrivateLessonNotice})",{...h.scope,...h});
 const source=read("api/src/functions/privateLesson.js"),part=source.slice(source.indexOf("async function notifyWorkflow("),source.indexOf("function emailResponse("));
 const calls=[];
 const workflow=runInNewContext(part+";notifyWorkflow",{...email,lineFirstLabEnabled:h.lineFirstLabEnabled,clean:v=>String(v||""),getSystemSettings:async()=>({emailNotificationsEnabled:false}),parentEmailsForStudent:async()=>["alice@example.test","bob@example.test"],activityStudentId:()=>"student-one",publicAppUrl:()=>h.labNoticeUrl("school-a"),readWeeklyGoals:()=>[],notifyPrivateLessonLine:async(school,options)=>{calls.push(options);return options.recipients[0]==="alice@example.test"?"accepted":"not_bound"},console});
 const result=await workflow({request:{},schoolId:"school-a",schoolName:"學校",entity:{rowKey:"lesson-one",updatedAt:"2026-11-21T12:00:00Z",eventDate:"2026-11-21",teacher:"teacher@example.test"},eventType:"completed",studentName:"學生甲",teacherName:"老師甲"});
 assert.equal(calls.length,2);assert.equal(h.mails.length,1);assert.equal(h.mails[0].recipients.to[0].address,"bob@example.test");assert.equal(result.status,"accepted");assert.equal(result.recipientCount,1);assert.equal(result.lineStatus,"partial");
});
test("activity invitations use Email only for missing LINE accounts and never send either channel before opening",async()=>{
 const h=harness();h.bindings.set("school-a:alice@example.test","user-a");
 const source=withoutImports(read("api/src/lib/paidActivityLine.js"));
 const notify=runInNewContext(source+";notifyPaidActivityOpened",{...h.scope,...h,workflowLineEnabled:()=>true,
  resolveTenantLineChannel:async()=>({loginConfigured:true,botUserId:"bot-school-a",appOrigin:"https://icy-ocean-0a2602100-lineuat.eastasia.6.azurestaticapps.net"}),
  lineAudienceStudents:async()=>[{groupName:"A"}],resolveLineAudience:async()=>({targets:["user-a"],unbound:1,contacts:[{email:"alice@example.test",userId:"user-a"},{email:"bob@example.test",userId:""}]})});
 const activity={id:"dinner-one",module:"yearEndDinner",title:"期末餐會",enabled:true,targetGroups:"A"};
 assert.equal((await notify("school-a",{...activity,openAt:new Date(Date.now()+60000).toISOString()},"version-one","registration")).status,"scheduled");assert.equal(h.mails.length,0);assert.equal(h.lines.length,0);
 const result=await notify("school-a",activity,"version-one","registration");assert.equal(result.accepted,1);assert.equal(result.emailAccepted,1);assert.equal(result.failed,0);
 assert.equal(h.mails[0].recipients.to[0].address,"bob@example.test");assert.equal(h.lines.length,1);
});
test("notification-center preview and send include unbound members in Email fallback and record the chosen channel",async()=>{
 const h=harness(),user="U"+"a".repeat(32),history=[];h.bindings.set("school-a:alice@example.test",user);let handler;
 const context={...h.scope,...h,app:{http:(name,config)=>{handler=config.handler}},getTenantContext:async()=>({schoolId:"school-a",access:{role:"admin",email:"admin@example.test"},tenant:{schoolName:"學校"}}),
  json:(body,status=200)=>({status,jsonBody:body}),resolveTenantLineChannel:async()=>({configured:true,loginConfigured:true,botUserId:"bot-school-a",appOrigin:"https://lab.example.test"}),workflowLineEnabled:()=>true,
  lineAudienceRoles:["parent","teacher","staff","finance"],lineAudienceStudents:async()=>[],lineAudienceGroups:()=>["A"],
  resolveLineAudience:async()=>({targets:[user],recipients:[{userId:user,name:"Alice"}],matched:2,unbound:1,contacts:[{email:"alice@example.test",userId:user},{email:"bob@example.test",userId:""}]}),
  recordLineAnnouncement:async(school,entry)=>history.push({school,...entry}),console};
 runInNewContext(withoutImports(read("api/src/functions/lineAnnouncements.js")),context);
 const body={action:"preview",audience:"members",roles:["parent"],groups:["A"],text:"活動通知",requestId:"11111111-1111-1111-1111-111111111111"};
 const call=data=>handler({method:"POST",headers:{get:key=>key==="origin"?"https://lab.example.test":""},json:async()=>data});
 const preview=await call(body);assert.equal(preview.status,200);assert.equal(preview.jsonBody.emailFallbackCandidates,1);
 const sent=await call({...body,action:"send",preview:preview.jsonBody.preview});assert.equal(sent.status,200);assert.equal(sent.jsonBody.accepted,1);assert.equal(sent.jsonBody.emailAccepted,1);assert.equal(sent.jsonBody.failed,0);
 assert.equal(history[0].emailAccepted,1);assert.ok(sent.jsonBody.recipientResults.some(result=>result.status==="email_accepted"));
 assert.doesNotMatch(JSON.stringify(sent.jsonBody),/bob@example\.test|token-school-a/);
 await call({...body,action:"send",preview:preview.jsonBody.preview});assert.equal(h.mails.length,1);assert.equal(h.lines.length,1);
});
test("payment verification uses its original LINE callback and falls back to Email without changing the receipt",async()=>{
 const h=harness(),raw=read("api/src/lib/tenantLineFeeNotice.js"),start=raw.indexOf("const paymentLabels"),end=raw.indexOf("// The retry key");
 const verified=runInNewContext(withoutImports(raw.slice(start,end))+";notifyTenantPaymentVerified",{...h.scope,...h,workflowLineEnabled:()=>true,sendTenantFeeLine:async(school,notice)=>notice.parentEmail==="alice@example.test"?{status:"accepted"}:{status:"not_bound"}});
 const event={kind:"regularUniform",id:"receipt-one",at:new Date().toISOString(),parentEmail:"alice@example.test",requestStatus:"APPROVED"};
 assert.equal((await verified("school-a",event)).status,"accepted");assert.equal(h.mails.length,0);
 assert.equal((await verified("school-a",{...event,id:"receipt-two",parentEmail:"bob@example.test"})).status,"email_sent");assert.equal(h.mails.length,1);assert.match(h.mails[0].content.plainText,/財務已確認[\s\S]*備貨／採購/);
});
test("finance fallback is evaluated per authorized finance recipient and excludes ordinary admins",async()=>{
 const h=harness();h.bindings.set("school-a:alice@example.test","user-a");
 const source=withoutImports(read("api/src/lib/lineAdminTodoNotification.mjs").replace("const buildEnablesLabAdminTodos = false;","const buildEnablesLabAdminTodos = true;"));
 const notify=runInNewContext(source+";notifyFinanceTransfer",{...h.scope,...h,financeRecipients,
  listTenantAdmins:async()=>["alice@example.test","bob@example.test","ordinary@example.test"].map(email=>({partitionKey:email,status:"active",role:"schoolAdmin"})),
  financeAssignments:async()=>["alice@example.test","bob@example.test"].map(email=>({email,status:"active"})),
  resolveTenantLineChannel:async()=>({loginConfigured:true,botUserId:"bot-school-a",financeTransferLineEnabled:true,accessToken:"token-school-a"}),console});
 const result=await notify("school-a",{kind:"uniform",id:"request-one",reportedAt:"2026-11-21T12:00:00Z"});
 assert.equal(result,"mixed_sent");assert.equal(h.lines.length,1);assert.equal(h.mails.length,1);assert.equal(h.mails[0].recipients.to[0].address,"bob@example.test");
 await notify("school-a",{kind:"uniform",id:"request-one",reportedAt:"2026-11-21T12:00:00Z"});assert.equal(h.lines.length,1);assert.equal(h.mails.length,1);
});
test("an admin todo uses LINE for bound admins and Email for unbound admins without notifying teachers",async()=>{
 const h=harness();h.bindings.set("school-a:alice@example.test","user-a");
 const source=withoutImports(read("api/src/lib/lineAdminTodoNotification.mjs").replace("const buildEnablesLabAdminTodos = false;","const buildEnablesLabAdminTodos = true;"));
 const notify=runInNewContext(source+";notifyAdminTodo",{...h.scope,...h,getLineNotificationTarget:async()=>({mode:"instant_only",targetType:"user"}),
  listTenantAdmins:async()=>[{partitionKey:"alice@example.test",status:"active",role:"schoolAdmin"},{partitionKey:"bob@example.test",status:"active",role:"schoolAdmin"},{partitionKey:"teacher@example.test",status:"active",role:"teacher"}],console});
 assert.equal(await notify("school-a",{id:"uniform:request-one",text:"團 T 申請待審"}),"mixed_sent");assert.equal(h.lines.length,1);assert.equal(h.mails.length,1);
 assert.equal(h.mails[0].recipients.to[0].address,"bob@example.test");
});
test("accepted absence-group LINE suppresses Email; failed LINE falls back to the authorized school contacts",async()=>{
 const h=harness(),logs=new Map();
 h.env.STORAGE_CONNECTION_STRING="test-storage";
 const log={createEntity:async row=>{const key=row.partitionKey+":"+row.rowKey;if(logs.has(key))throw Object.assign(Error("exists"),{statusCode:409});logs.set(key,{...row})},updateEntity:async row=>{const key=row.partitionKey+":"+row.rowKey;logs.set(key,{...logs.get(key),...row})}};
 class EmailClient{async beginSend(message){h.mails.push(message);return {pollUntilDone:async()=>({status:"Succeeded",id:"mail-one"})}}}
 const source=withoutImports(read("api/src/lib/schoolAbsenceMail.mjs"));
 const dispatch=runInNewContext(source+";dispatchSchoolAbsenceEmails",{...h.scope,...h,EmailClient,TableClient:{fromConnectionString:(connection,name)=>name==="SystemSettings"?{getEntity:async()=>({emailsJson:'["school@example.test"]'})}:log},TableServiceClient:{fromConnectionString:()=>({createTable:async()=>{}})},
  tenantSchoolPartition:value=>value,defaultTenantId:()=>"school-a",getTenantDirectory:async()=>({schoolName:"學校"}),getSystemSettings:async()=>({emailNotificationsEnabled:false}),console});
 const event={schoolId:"school-a",date:"2026-11-21",items:[{date:"2026-11-21",studentId:"student-one",name:"學生甲",classType:"section",status:"absent",groupName:"A"}]};
 await dispatch({...event,lineNotification:{sent:true}});assert.equal(h.mails.length,0);assert.equal([...logs.values()][0].status,"line_accepted");
 await dispatch({...event,date:"2026-11-22",items:[{...event.items[0],date:"2026-11-22"}],lineNotification:{sent:false}});
 assert.equal(h.mails.length,1);assert.equal(h.mails[0].recipients.to[0].address,"school@example.test");assert.equal([...logs.values()][1].status,"sent");
});
