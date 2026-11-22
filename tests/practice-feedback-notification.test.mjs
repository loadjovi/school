import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createHash} from "node:crypto";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const strip=source=>source.replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
function harness(){
 const stores=new Map(),handlers={},pushes=[],mails=[],lookups=[];
 let school="school-a",role="teacher",allowed=true,privateOnly=false,temporary=false,active=true,revision=0,lineFailure=false,mailFailure=false,onClaim=null;
 const unbound=new Set(),error=code=>Object.assign(Error(String(code)),{statusCode:code}),key=(p,r)=>p+"/"+r;
 const rows=name=>{if(!stores.has(name))stores.set(name,new Map());return stores.get(name)};
 const put=(name,row)=>rows(name).set(key(row.partitionKey,row.rowKey),{...row,etag:"v"+(++revision)});
 const db=name=>({createTable:async()=>{},getEntity:async(p,r)=>{const row=rows(name).get(key(p,r));if(!row)throw error(404);return structuredClone(row)},
  upsertEntity:async row=>{put(name,row)},
  createEntity:async row=>{if(rows(name).has(key(row.partitionKey,row.rowKey)))throw error(409);put(name,row);if(name==="TenantNotificationDelivery")onClaim?.()},
  updateEntity:async(row,mode,options)=>{const old=rows(name).get(key(row.partitionKey,row.rowKey));if(!old)throw error(404);if(options?.etag&&options.etag!==old.etag)throw error(412);put(name,mode==="Merge"?{...old,...row}:row)},
  async *listEntities({queryOptions:{filter}}){
   if(name==="tenantUserStudentMap"){
    for(const [sid,mappings] of parents)for(const row of mappings)yield {...row,rowKey:row.studentId,schoolId:sid,partitionKey:sid+"|parent|"+row.parentEmail.toLowerCase()};
    return;
   }
   for(const row of rows(name).values())if([...filter.matchAll(/(PartitionKey|schoolId|feedbackMonth) eq '([^']*)'/g)].every(([,field,value])=>String(row[field==="PartitionKey"?"partitionKey":field])===value))yield structuredClone(row)
  }
 });
 const parents=new Map([["school-a",[{studentId:"student1",parentEmail:"one@example.test",status:"active"},{studentId:"old-id",parentEmail:"two@example.test",status:"active"},{studentId:"student1",parentEmail:"ONE@example.test",status:"active"},{studentId:"other-child",parentEmail:"other@example.test",status:"active"},{studentId:"student1",parentEmail:"removed@example.test",status:"inactive"}]], ["school-b",[{studentId:"student1",parentEmail:"school-b@example.test",status:"active"}]]]);
 const partition=(s,id)=>s+"|student|"+id;
 const scope={createHash,process:{env:{LAB_ENVIRONMENT:"functional-uat",STORAGE_CONNECTION_STRING:"test"}},console:{error(){}},
  app:{http:(name,config)=>{handlers[name]=config.handler}},getTenantContext:async()=>({schoolId:school,access:{role,email:"teacher@example.test",displayName:"陳老師",capabilities:{teacherSettings:role==="teacher",privateOnly},temporaryAssignment:temporary,students:["student1"]}}),json:(jsonBody,status=200)=>({jsonBody,status}),ensureStudentAccess:(_a,id)=>allowed&&id==="student1",ensureTenantTables:async()=>{},table:db,tenantSchoolPartition:String,tenantStudentPartition:partition,
  getStudentMaster:async(id,s)=>id==="student1"?{studentName:s==="school-a"?"甲同學":"乙同學",status:active?"active":"inactive"}:null,getStudentIdAliases:async id=>id==="student1"?["student1","old-id"]:[id],
  TableClient:{fromConnectionString:(_conn,name)=>db(name)},tenantEmailAddress:email=>String(email).includes("@")?email:"",tenantEmailConfig:()=>({connectionString:"test",senderAddress:"lab@example.test"}),getTenantLineParentContact:async()=>null,
  resolveTenantLineChannel:async s=>({loginConfigured:true,botUserId:"bot-"+s,accessToken:"token-"+s}),getTenantLineRecipient:async(s,email,bot)=>{lookups.push({s,email,bot});return unbound.has(email)?null:{lineUserId:s+"-"+email}},pushLineMessage:async(user,text,options)=>{if(lineFailure)throw error(400);pushes.push({user,text,options})},EmailClient:class{async beginSend(input){if(mailFailure)throw error(400);mails.push(input);return {}}}
 };
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/labNoticeDelivery.mjs")).replace("const buildEnablesLineFirstLab = false;","const buildEnablesLineFirstLab = true;")+";({deliverLabNotice,labNoticeLineResult,lineFirstLabEnabled})",{...scope}));
 Object.assign(scope,runInNewContext(strip(read("api/src/lib/practiceFeedbackNotification.js"))+";({notifyPracticeFeedback})",{...scope}));
 runInNewContext(strip(read("api/src/functions/practiceFeedback.js")),{...scope});
 const input=(extra={})=>({studentId:"student1",month:"2026-11",level:4,comment:"這週練習很穩定，繼續保持！",...extra});
 return {...scope,rows,parents,pushes,mails,lookups,unbound,put,input,post:(body=input())=>handlers.practiceFeedback({method:"POST",json:async()=>body}),setSchool:v=>{school=v},setRole:v=>{role=v},setAllowed:v=>{allowed=v},setPrivate:v=>{privateOnly=v},setTemporary:v=>{temporary=v},setActive:v=>{active=v},setLineFailure:v=>{lineFailure=v},setMailFailure:v=>{mailFailure=v},onClaim:fn=>{onClaim=fn}};
}

test("saving encouragement persists first and notifies both mapped parents, including a student alias, via this school's LINE",async()=>{
 const h=harness(),result=await h.post(h.input({parentEmail:"attacker@example.test",teacherName:"冒名老師"}));
 assert.equal(result.status,200);assert.equal(result.jsonBody.notification.status,"accepted");assert.equal(h.rows("tenantPracticeFeedback").size,1);assert.equal(h.pushes.length,2);assert.equal(h.mails.length,0);
 assert.deepEqual(h.lookups.map(x=>x.email).sort(),["one@example.test","two@example.test"]);
 for(const push of h.pushes){assert.match(push.text,/甲同學，你的努力被看見了！/);assert.match(push.text,/陳老師：🌟 很棒喔/);assert.match(push.text,/這週練習很穩定，繼續保持！/);assert.match(push.text,/不影響成績/);assert.equal(push.options.accessToken,"token-school-a");assert.ok(push.options.retryKey)}
 const feedback=[...h.rows("tenantPracticeFeedback").values()][0];assert.equal(feedback.teacherName,"陳老師");assert.equal(feedback.comment,h.input().comment);assert.equal(result.jsonBody.monthCount,1);assert.equal(h.rows("tenantPracticeMonthlyEvaluation").size,0);assert.equal(h.rows("tenantPractice").size,0);
});
test("each parent's channel is independent: an accepted LINE skips mail and an unbound parent receives fallback mail",async()=>{
 const h=harness();h.unbound.add("two@example.test");const result=await h.post();assert.equal(result.jsonBody.notification.status,"mixed_sent");assert.equal(h.pushes.length,1);assert.equal(h.mails.length,1);assert.equal(h.mails[0].recipients.to[0].address,"two@example.test");assert.match(h.mails[0].content.plainText,/陳老師：🌟 很棒喔/);
 await h.post();assert.equal(h.pushes.length,1);assert.equal(h.mails.length,1);
});
test("unchanged and concurrent saves keep one daily feedback and do not repeat notices; changed text or level sends an update",async()=>{
 const h=harness();await Promise.all([h.post(),h.post(),h.post()]);assert.equal(h.pushes.length,2);assert.equal(h.rows("tenantPracticeFeedback").size,1);
 await h.post(h.input({comment:"換把有進步，繼續加油！"}));assert.equal(h.pushes.length,4);await h.post(h.input({comment:"換把有進步，繼續加油！"}));assert.equal(h.pushes.length,4);
 await h.post(h.input({level:5,comment:"換把有進步，繼續加油！"}));assert.equal(h.pushes.length,6);assert.match(h.pushes[4].text,/🏆 超級投入/);assert.equal(h.rows("tenantPracticeFeedback").size,1);
});
test("failed delivery preserves saved encouragement, and retry sends only parents whose notice failed",async()=>{
 const h=harness();h.unbound.add("two@example.test");h.setMailFailure(true);let result=await h.post();assert.equal(result.status,200);assert.equal(result.jsonBody.notification.status,"partial");assert.equal(h.rows("tenantPracticeFeedback").size,1);assert.equal(h.pushes.length,1);
 h.setMailFailure(false);result=await h.post();assert.equal(result.jsonBody.notification.status,"mixed_sent");assert.equal(h.pushes.length,1);assert.equal(h.mails.length,1);
 const f=harness();f.setLineFailure(true);await f.post();assert.equal(f.pushes.length,0);assert.equal(f.mails.length,2);
});
test("parents, admins, private-only, temporary and unassigned teachers cannot save or notify",async()=>{
 for(const [setter,value] of [["setRole","parent"],["setRole","admin"],["setPrivate",true],["setTemporary",true],["setAllowed",false]]){
  const h=harness();h[setter](value);assert.equal((await h.post()).status,403);assert.equal(h.rows("tenantPracticeFeedback").size,0);assert.equal(h.pushes.length,0);assert.equal(h.mails.length,0);
 }
 const h=harness();h.setActive(false);assert.equal((await h.post()).status,404);assert.equal(h.pushes.length,0);
});
test("invalid encouragement is rejected; icon-only encouragement is valid and still notifies parents",async()=>{
 for(const body of [{level:0},{level:6},{level:1.5},{studentId:""}]){const h=harness();assert.equal((await h.post(h.input(body))).status,400);assert.equal(h.pushes.length,0)}
 const h=harness();assert.equal((await h.post(h.input({level:1,comment:""}))).status,200);assert.match(h.pushes[0].text,/🌱 起步中/);assert.doesNotMatch(h.pushes[0].text,/undefined|null/);
});
test("schools with identical student and feedback IDs have separate bindings, ledgers and messages",async()=>{
 const h=harness();await h.post();h.setSchool("school-b");await h.post();assert.equal(h.rows("tenantPracticeFeedback").size,2);assert.equal(h.pushes.length,3);assert.equal(h.pushes[2].user,"school-b-school-b@example.test");assert.match(h.pushes[2].text,/乙同學/);assert.doesNotMatch(h.pushes[2].text,/甲同學/);assert.equal(h.lookups[2].bot,"bot-school-b");assert.notEqual(h.pushes[0].options.retryKey,h.pushes[2].options.retryKey);
 const row=[...h.rows("tenantPracticeFeedback").values()][0];assert.equal((await h.notifyPracticeFeedback("school-b",row)).status,"ineligible");assert.equal(h.pushes.length,3);
});
test("deleted or superseded feedback cannot send stale content, and parent binding revocation is checked per recipient",async()=>{
 const h=harness();h.onClaim(()=>h.parents.set("school-a",h.parents.get("school-a").filter(x=>x.parentEmail!=="one@example.test"&&x.parentEmail!=="ONE@example.test")));await h.post();assert.equal(h.pushes.length,1);assert.match(h.pushes[0].user,/two@example.test/);assert.equal(h.mails.length,0);
 const changed=harness();changed.onClaim(()=>{for(const [key,row] of changed.rows("tenantPracticeFeedback"))changed.rows("tenantPracticeFeedback").set(key,{...row,comment:"已被老師修改"})});await changed.post();assert.equal(changed.pushes.length,0);assert.equal(changed.mails.length,0);
 const removed=harness();removed.onClaim(()=>removed.rows("tenantPracticeFeedback").clear());await removed.post();assert.equal(removed.pushes.length,0);assert.equal(removed.mails.length,0);
});
test("no mapped parent is reported honestly; inactive mappings and other students never receive a notice",async()=>{
 const h=harness();h.parents.set("school-a",h.parents.get("school-a").filter(x=>x.studentId==="other-child"||x.status==="inactive"));const result=await h.post();assert.equal(result.status,200);assert.equal(result.jsonBody.notification.status,"no_recipients");assert.equal(h.pushes.length,0);assert.equal(h.mails.length,0);
});
test("the notification feature is disabled outside the independent LINE LAB",async()=>{
 const h=harness();h.process.env.LAB_ENVIRONMENT="production";const result=await h.post();assert.equal(result.status,200);assert.equal(result.jsonBody.notification.status,"disabled");assert.equal(h.rows("tenantPracticeFeedback").size,1);assert.equal(h.pushes.length,0);assert.equal(h.mails.length,0);
});

function uiHarness({notice={status:"accepted"},saveFails=false,refreshFails=false}={}){
 const source=read("app/practice-progress.js"),start=source.indexOf("  function feedbackNoticeMessage("),end=source.indexOf("  window.changePracticeProgressStatus=",start),messages=[],calls=[],button={disabled:false,textContent:"儲存"},comment={value:"老師留言"},option={checked:true};let renders=0;
 const state={practiceProgressMonth:"2026-11",practiceFeedbackSaving:""},scope={window:{},state,isTeacher:()=>true,CSS:{escape:String},document:{querySelector:()=>({value:"4"}),getElementById:id=>id.startsWith("pfSave_")?button:id.startsWith("pfComment_")?comment:option},api:async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});if(saveFails)throw Error("儲存失敗");return {notification:notice}},loadPracticeProgress:async()=>{if(refreshFails)throw Error("載入失敗")},toast:text=>messages.push(text),render:()=>{renders++;comment.value="";option.checked=false}};
 runInNewContext(source.slice(start,end),scope);return {save:()=>scope.window.savePracticeFeedback("student1"),messages,calls,comment,option,button,state,renders:()=>renders};
}
test("save UI prevents duplicate clicks and shows actual channel outcome without claiming actual LINE receipt",async()=>{
 const h=uiHarness(),pending=h.save();assert.equal(h.button.disabled,true);assert.equal(h.renders(),0);await h.save();await pending;assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.comment,"老師留言");assert.match(h.messages[0],/LINE 通知已受理/);assert.equal(h.state.practiceFeedbackSaving,"");
 for(const [status,expected] of [["email_sent",/改寄 Email/],["mixed_sent",/LINE／Email/],["no_recipients",/尚無綁定/],["unconfirmed",/待確認/],["partial",/未完成/]]){const u=uiHarness({notice:{status}});await u.save();assert.match(u.messages[0],expected)}
});
test("a failed save or notice preserves the typed draft for retry, and a refresh failure does not claim saving failed",async()=>{
 for(const config of [{saveFails:true},{notice:{status:"failed"}}]){const h=uiHarness(config);await h.save();assert.equal(h.comment.value,"老師留言");assert.equal(h.option.checked,true)}
 const h=uiHarness({refreshFails:true});await h.save();assert.match(h.messages[0],/已儲存.*重新整理進度/);assert.doesNotMatch(h.messages[0],/儲存失敗/);
});
