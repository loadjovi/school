import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createHash} from "node:crypto";
import {buildPrivateLessonNoticeCard} from "../api/src/lib/privateLessonLineCards.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const strip=source=>source.replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function screen({role="privateTeacher",configured=true,reply={configured:true,bound:false,authProvider:"google"},search="",loader=false,legacyRedirect=false}={}){
 const state={me:{role,schoolId:"school-a",identityId:"teacher-sub",email:"teacher@example.invalid",capabilities:{lineAccount:configured}},page:"teacherHome"};
 let html="";const calls=[],assigned=[],events={},storage=new Map(),app={innerHTML:""},frame={contentWindow:{},style:{}};
 const document={visibilityState:"visible",getElementById:id=>id==="app"?app:id==="teacherLineAccountFrame"&&app.innerHTML.includes("teacherLineAccountFrame")?frame:id==="teacherLineAccount"&&html?{remove(){html=""}}:null,querySelector:()=>({insertAdjacentHTML(_,value){html+=value}}),addEventListener(name,fn){events[name]=fn}};
 const window={__roleLoaderActive:loader,__roleModulesReady:!loader,addEventListener(name,fn){events[name]=fn}};
 const context={state,document,window,URL,URLSearchParams,history:{replaceState(){}},sessionStorage:{getItem:key=>storage.get(key)||"",setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},location:{search,pathname:"/",hash:"",origin:"https://school-a.example.invalid",assign:url=>assigned.push(url)},shell:content=>"<header>老師身分選單</header>"+content,esc,render(){html="";if(legacyRedirect)state.page="private"},api:async(path,options)=>{calls.push({path,options});return typeof reply==="function"?reply(path,options):reply}};
 runInNewContext(read("app/teacher-line-account.js"),context);
 return {state,window,context,calls,assigned,events,storage,app,frame,html:()=>html};
}

test("unbound authorized teachers see a Gmail-specific binding entry and start verified LINE OAuth",async()=>{
 const h=screen({reply:async(path,options)=>options?{url:"https://access.line.me/oauth2/v2.1/authorize?state=test"}:{configured:true,bound:false,authProvider:"google"}});
 await settle();
 assert.match(h.html(),/尚未完成 Gmail 與 LINE 綁定/);
 assert.match(h.html(),/teacher@example.invalid/);
 assert.equal((h.html().match(/id="teacherLineAccount"/g)||[]).length,1);
 await h.window.teacherLineAccount.bind();
 assert.equal(h.calls[1].path,"/api/line/tenant-login/school-a/start");
 assert.deepEqual(JSON.parse(h.calls[1].options.body),{mode:"link",returnTo:"teacher-account"});
 assert.equal(h.assigned.length,1);
 assert.equal(h.storage.get("teacher_line_account_return"),"school-a");
});

test("teacher callback opens only the same-school account frame and keeps the teacher shell",async()=>{
 const h=screen({search:"?teacherLineAccount=school-a&line_link=confirm&line_error=verification"});
 assert.equal(h.state.page,"teacherLineAccount");
 assert.match(h.app.innerHTML,/老師身分選單/);assert.match(h.app.innerHTML,/返回教學首頁/);
 const src=h.app.innerHTML.match(/src="([^"]+)"/)[1].replaceAll('&amp;','&'),query=new URL(src,'https://school-a.example.invalid').searchParams;
 assert.equal(query.get('embedded'),'teacher');assert.equal(query.get('schoolId'),'school-a');assert.equal(query.get('line_link'),'confirm');
 assert.equal(query.get('line_error'),'verification');assert.doesNotMatch(h.app.innerHTML,/學生姓名|送出綁定申請/);
 const same=h.app.innerHTML;h.context.render();assert.equal(h.app.innerHTML,same);
 h.events.message({origin:'https://evil.invalid',source:h.frame.contentWindow,data:{type:'teacher-line-account-height',height:900}});assert.equal(h.frame.style.height,undefined);
 h.events.message({origin:h.context.location.origin,source:{},data:{type:'teacher-line-account-height',height:900}});assert.equal(h.frame.style.height,undefined);
 h.events.message({origin:h.context.location.origin,source:h.frame.contentWindow,data:{type:'teacher-line-account-height',height:900}});assert.equal(h.frame.style.height,'900px');
 const other=screen({search:'?teacherLineAccount=school-b&line_link=confirm'});await settle();assert.equal(other.state.page,'teacherHome');assert.equal(other.app.innerHTML,'');
 const parent=screen({role:'parent',search:'?teacherLineAccount=school-a'});assert.equal(parent.app.innerHTML,'');
});

test("teacher binding rejects an unexpected authorization destination",async()=>{
 for(const url of ['https://evil.invalid/','https://user:password@access.line.me/oauth2/v2.1/authorize','https://user@access.line.me/oauth2/v2.1/authorize']){
  const h=screen({reply:async(_path,options)=>options?{url}:{configured:true,bound:false,authProvider:'google'}});
  await settle();await h.window.teacherLineAccount.bind();assert.equal(h.assigned.length,0);assert.equal(h.storage.has('teacher_line_account_return'),false);
 }
});

test("a late teacher OAuth response cannot write return hints or navigate after a token or context switch",async()=>{
 for(const change of [h=>{h.state.token='new-google-token'},h=>{h.storage.set('google_id_token','new-google-token')},h=>{h.storage.set('school_context_id','school-b')},h=>{h.storage.set('role_context','parent')}]){
  let release;const h=screen({reply:async(_path,options)=>options?new Promise(resolve=>{release=resolve}):{configured:true,bound:false,authProvider:'google'}});
  await settle();const request=h.window.teacherLineAccount.bind();change(h);release({url:'https://access.line.me/oauth2/v2.1/authorize?state=stale'});await request;
  assert.equal(h.assigned.length,0);assert.equal(h.storage.has('teacher_line_account_return'),false);assert.equal(h.calls.filter(call=>call.options?.method==='POST').length,1);
 }
});
test("teacher friendship callbacks stay in the teacher shell and forward only known check results",()=>{
 for(const result of ['checked','unavailable','mismatch','confirm','https://evil.invalid']){
  const h=screen({search:'?teacherLineAccount=school-a&line_friend='+encodeURIComponent(result)});
  assert.equal(h.state.page,'teacherLineAccount');assert.match(h.app.innerHTML,/老師身分選單/);
  const src=h.app.innerHTML.match(/src="([^"]+)"/)[1].replaceAll('&amp;','&'),query=new URL(src,'https://school-a.example.invalid').searchParams;
  assert.equal(query.get('line_friend'),['checked','unavailable','mismatch'].includes(result)?result:null);assert.equal(query.get('line_link'),null);
  assert.equal(h.calls.length,0);assert.doesNotMatch(h.app.innerHTML,/學生姓名|送出綁定申請/);
 }
});

test("teacher callback survives role-module loading without legacy render redirecting it to attendance",()=>{
 const h=screen({search:'?teacherLineAccount=school-a&line_link=confirm',loader:true,legacyRedirect:true});
 assert.equal(h.state.page,'teacherLineAccount');assert.match(h.app.innerHTML,/正在準備老師 LINE 綁定/);assert.doesNotMatch(h.app.innerHTML,/iframe/);
 h.window.__roleLoaderActive=false;h.window.__roleModulesReady=true;h.context.render();
 assert.equal(h.state.page,'teacherLineAccount');assert.match(h.app.innerHTML,/teacherLineAccountFrame/);
});

test("bound teacher status is kept in settings and removed from the teaching home",async()=>{
 const h=screen({reply:{configured:true,bound:true,googleLinked:true,authProvider:"google",lineDisplayName:'老師<script>alert(1)</script>'}});
 await settle();
 assert.equal(h.html(),"");
 h.state.page="teacherSettings";h.context.render();
 assert.match(h.html(),/✅ LINE 已綁定/);
 assert.match(h.html(),/&lt;script&gt;/);
 assert.doesNotMatch(h.html(),/<script>|綁定我的 LINE 帳號/);
 h.state.page="teacherSettings";h.context.render();
 assert.match(h.html(),/✅ LINE 已綁定/);
 assert.equal(h.calls.length,1);
 h.state.page="private";h.context.render();assert.equal(h.html(),"");
});

test("all teacher types use the same status while parent and admin contexts do not show teacher binding",async()=>{
 for(const role of ["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]){
  const h=screen({role});await settle();assert.match(h.html(),/綁定我的 LINE 帳號/);
 }
 for(const role of ["parent","admin","unassigned"]){
  const h=screen({role});await settle();assert.equal(h.calls.length,0);assert.equal(h.html(),"");
 }
});

test("pending identity confirmation is not treated as completed binding",async()=>{
 const h=screen({reply:{configured:true,bound:false,authProvider:"google",pendingLink:{confirmationId:"pending"}}});
 await settle();assert.match(h.html(),/核對並確認綁定/);assert.doesNotMatch(h.html(),/✅ LINE 已綁定/);
 await h.window.teacherLineAccount.bind();assert.equal(h.calls.length,1);
 const line=screen({reply:{configured:true,bound:true,googleLinked:false,authProvider:"line"}});
 await settle();assert.match(line.html(),/連結我的 Gmail 與 LINE/);assert.doesNotMatch(line.html(),/✅ LINE 已綁定/);
});

test("failed reads can retry, and an unconfigured school cannot initiate binding",async()=>{
 let fails=true;
 const h=screen({reply:()=>{if(fails)throw new Error("暫時無法讀取");return {configured:true,bound:true,googleLinked:true}}});
 await settle();h.state.page="teacherSettings";h.context.render();assert.match(h.html(),/暫時無法讀取/);assert.doesNotMatch(h.html(),/尚未完成 Gmail/);
 fails=false;await h.window.teacherLineAccount.refresh();assert.match(h.html(),/✅ LINE 已綁定/);
 const disabled=screen({configured:false});await settle();assert.equal(disabled.html(),"");disabled.state.page="teacherSettings";disabled.context.render();assert.match(disabled.html(),/尚未開啟/);assert.equal(disabled.calls.length,0);
 await disabled.window.teacherLineAccount.bind();assert.equal(disabled.calls.length,0);
});

test("account and school switches ignore stale in-flight binding status",async()=>{
 const deferred=[];
 const h=screen({reply:()=>new Promise(resolve=>deferred.push(resolve))});
 h.state.me={...h.state.me,schoolId:"school-b",identityId:"other-sub",email:"other@example.invalid"};h.context.render();
 deferred[0]({configured:true,bound:true,googleLinked:true,lineDisplayName:"舊帳號"});await settle();
 assert.doesNotMatch(h.html(),/舊帳號|✅ LINE 已綁定/);
 deferred[1]({configured:true,bound:false,authProvider:"google"});await settle();
 assert.match(h.html(),/other@example.invalid/);assert.doesNotMatch(h.html(),/teacher@example.invalid/);
 h.state.me.role="parent";h.context.render();assert.equal(h.html(),"");
});

test("returning from account management refreshes status without reloading teaching records",async()=>{
 let bound=false;
 const h=screen({reply:()=>({configured:true,bound,googleLinked:bound,authProvider:"google"})});
 await settle();bound=true;h.events.visibilitychange();await settle();
 assert.equal(h.html(),"");h.state.page="teacherSettings";h.context.render();assert.match(h.html(),/✅ LINE 已綁定/);assert.equal(h.calls.length,2);
});

function endpoints({role="privateTeacher",schoolId="school-a",link=null,lineSession=null,google={sub:"teacher-sub",email:"teacher@example.invalid"}}={}){
 const handlers={},txn=[];
 runInNewContext(strip(read("api/src/functions/tenantLineLogin.js")),{
  app:{http:(name,entry)=>{handlers[name]=entry.handler}},createHash,URL,URLSearchParams,console,
  json:(data,status=200)=>({data,status}),tenantIdValue:x=>x,
  getTenantContext:async()=>({schoolId,access:{role}}),verifyGoogle:async()=>google,
  resolveTenantLineChannel:async()=>({schoolId,loginConfigured:true,botUserId:"bot-a",loginId:"login-a",appOrigin:"https://school-a.example.invalid"}),
  getTenantGoogleLink:async(school,sub)=>{assert.equal(school,schoolId);assert.equal(sub,google.sub);return link},
  tenantLineSession:async()=>lineSession,readTenantLineLinkConfirmation:async()=>null,
  createTenantLineOAuth:async(school,channel,identity)=>{txn.push({school,identity});return {state:"state",nonce:"nonce",verifier:"verifier",cookie:{}}},
  clearTenantLineLinkConfirmation:()=>({})
 });
 const request={method:"GET",params:{schoolId},headers:new Headers({origin:"https://school-a.example.invalid"}),json:async()=>({mode:"link"})};
 return {handlers,request,txn};
}

test("teacher account API reads only the verified Gmail identity and current school bot",async()=>{
 for(const role of ["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]){
  const h=endpoints({role,link:{botUserId:"bot-a",lineUserId:"line-teacher",googleSub:"teacher-sub",displayName:"老師"}});
  const result=await h.handlers.tenantLineAccount(h.request);
  assert.equal(result.data.bound,true);assert.equal(result.data.googleLinked,true);assert.equal(result.data.lineDisplayName,"老師");
  assert.equal(result.headers["Cache-Control"],"no-store");
 }
 const wrongBot=endpoints({link:{botUserId:"other-bot",lineUserId:"line-teacher",googleSub:"teacher-sub"}});
 assert.equal((await wrongBot.handlers.tenantLineAccount(wrongBot.request)).data.bound,false);
 const unbound=endpoints();assert.equal((await unbound.handlers.tenantLineAccount(unbound.request)).data.bound,false);
 const denied=endpoints({role:"contextDenied"});assert.equal((await denied.handlers.tenantLineAccount(denied.request)).status,403);
});

test("teacher binding starts only with authenticated Gmail and the matching school context",async()=>{
 const h=endpoints(),result=await h.handlers.tenantLineLoginStart(h.request);
 assert.equal(result.status,200);assert.equal(h.txn[0].identity.email,"teacher@example.invalid");
 assert.equal(new URL(result.data.url).searchParams.get("redirect_uri"),"https://school-a.example.invalid/api/line/tenant-login/school-a/callback");
 const mismatch=endpoints();mismatch.request.params.schoolId="school-b";
 assert.equal((await mismatch.handlers.tenantLineLoginStart(mismatch.request)).status,403);assert.equal(mismatch.txn.length,0);
 const noGoogle=endpoints({google:null});assert.equal((await noGoogle.handlers.tenantLineLoginStart(noGoogle.request)).status,401);
});

// Exercise the real authorization path used by LINE sessions and /me.
import {teacherCourseAccess} from "../api/src/lib/teacherAccountType.js";
test("a verified LINE teacher retains their Gmail teaching scope and loses it after revocation",async()=>{
 const account={botUserId:"bot-a",lineUserId:"line-teacher",googleSub:"teacher-sub",googleEmail:"teacher@example.invalid",parentEmail:"line-alias@example.invalid",displayName:"LINE 名稱"};
 let link={...account},active=true,reads=0;
 const context={OAuth2Client:class{},process:{env:{}},console,createHash,teacherCourseAccess,
  tenantIdValue:x=>x,defaultTenantId:()=>"school-a",
  tenantLineSession:async()=>({schoolId:"school-a",account}),
  resolveTenantLineChannel:async()=>({loginConfigured:true,botUserId:"bot-a"}),
  getTenantDirectory:async()=>({status:"active",schoolName:"甲校"}),
  getTenantGoogleLink:async(school,sub)=>{assert.equal(school,"school-a");assert.equal(sub,"teacher-sub");return link},
  listTenantRolesByEmail:async()=>[],
  getTeacherDirectory:async(email,school)=>{reads++;assert.equal(email,account.googleEmail);assert.equal(school,"school-a");return {status:active?"active":"inactive",privateOnly:true,teacherName:"授權老師"}},
  getTeacherProfile:async()=>({privateStudentIds:JSON.stringify(["990101"])}),
  listStudentMaster:async()=>[{rowKey:"990101",studentName:"可授課學生",groupName:"A"},{rowKey:"990102",studentName:"非授課學生",groupName:"B"}],
  listUserStudentMappings:async()=>[],tenantLineParentStudents:async()=>[]
 };
 const {lineParentAccess,teacherAccessForIdentity}=runInNewContext(strip(read("api/src/lib/auth.js"))+";({lineParentAccess,teacherAccessForIdentity})",context);
 const request={headers:new Headers({"X-School-Id":"school-a","X-Role-Context":"teacher"})};
 const teacher=await lineParentAccess(request,true);
 assert.equal(teacher.role,"privateTeacher");assert.equal(teacher.email,account.googleEmail);
 assert.equal(teacher.capabilities.private,true);assert.equal(teacher.capabilities.privateOnly,true);
 assert.equal(teacher.capabilities.financeVerifier,undefined);
 assert.deepEqual(Array.from(teacher.students,x=>x.studentId),["990101"]);
 assert.equal(teacher.activeContextKey,"teacher:school-a");
 assert.deepEqual(Array.from(teacher.contexts,x=>x.type),["teacher"]);
 const gmail=await teacherAccessForIdentity({email:account.googleEmail},{status:"active",privateOnly:true,teacherName:"授權老師"},"school-a",{status:"active",schoolName:"甲校"});
 assert.deepEqual(JSON.parse(JSON.stringify(teacher.capabilities)),JSON.parse(JSON.stringify(gmail.capabilities)));
 assert.deepEqual(Array.from(teacher.privateStudentIds),Array.from(gmail.privateStudentIds));
 let me;
 runInNewContext(strip(read("api/src/functions/me.js")),{app:{http:(_,entry)=>{me=entry.handler}},getAccess:async()=>teacher,json:data=>data,tenantFeeEnabled:()=>false});
 const profile=await me(request);
 assert.equal(profile.authProvider,"line");assert.equal(profile.email,account.googleEmail);
 assert.deepEqual(Array.from(profile.privateStudentIds),["990101"]);
 assert.equal(profile.capabilities.lineAccount,true);
 active=false;assert.equal((await lineParentAccess(request)).role,"contextDenied");
 active=true;link={...account,lineUserId:"someone-else"};assert.equal((await lineParentAccess(request)).role,"contextDenied");
 const before=reads;request.headers.set("X-School-Id","school-b");
 assert.equal((await lineParentAccess(request)).role,"contextDenied");assert.equal(reads,before);
});

test("parent lesson status changes reach only that lesson's bound teacher LINE in the same school",async()=>{
 const calls=[],lookups=[];let linked=true;
 const notifier=runInNewContext(strip(read("api/src/lib/linePrivateLesson.js"))+";notifyPrivateLessonLine",{
  process:{env:{}},console,workflowLineEnabled:()=>true,workflowLineRetryKey:()=>"retry",buildPrivateLessonNoticeCard,
  resolveTenantLineChannel:async school=>{assert.equal(school,"school-a");return {loginConfigured:true,botUserId:"bot-a",appOrigin:"https://school-a.example.invalid",accessToken:"test"}},
  getTenantLineRecipient:async(school,email,bot)=>{lookups.push({school,email,bot});return linked&&school==="school-a"&&email==="teacher@example.invalid"&&bot==="bot-a"?{lineUserId:"line-teacher"}:null},
  pushLineMessage:async(userId,text)=>calls.push({userId,text})
 });
 const mail=read("api/src/lib/email.js");
 const formatter=runInNewContext('const clean=(x,max=300)=>String(x??"").trim().slice(0,max),esc=x=>String(x);\n'+mail.slice(mail.indexOf("const privateLessonMailCopy="),mail.indexOf("export async function sendPrivateLessonWorkflowEmail(")).replace(/^export /gm,"")+";formatPrivateLessonNotice");
 const notify=runInNewContext(strip(read("api/src/functions/privateLesson.js"))+";notifyWorkflow",{
  app:{http(){}},process:{env:{}},URL,console,activityStudentId:x=>x.studentId,
  getSystemSettings:async()=>({emailNotificationsEnabled:false}),notifyPrivateLessonLine:notifier,formatPrivateLessonNotice:formatter
 });
 for(const eventType of ["rescheduled","cancelled","confirmed","issue"]){
  const result=await notify({request:{headers:new Headers({origin:"https://school-a.example.invalid"})},schoolId:"school-a",schoolName:"甲校",entity:{rowKey:"lesson-1",studentId:"990101",teacher:"teacher@example.invalid",eventDate:"2099-11-20",startTime:"18:00",endTime:"19:00",parentNote:"家長回應"},studentName:"測試學生",teacherName:"授權老師",eventType,target:"teacher",actorEmail:"parent@example.invalid"});
  assert.equal(result.lineStatus,"accepted");
 }
 assert.equal(calls.length,4);
 assert.ok(calls.every(x=>x.text.type==="flex"&&JSON.stringify(x.text.contents).includes("授權老師")));
 assert.ok(calls.every(x=>x.userId==="line-teacher"));
 assert.ok(lookups.every(x=>x.email==="teacher@example.invalid"&&x.school==="school-a"&&x.bot==="bot-a"));
 linked=false;
 const unbound=await notify({request:{headers:new Headers({origin:"https://school-a.example.invalid"})},schoolId:"school-a",entity:{teacher:"teacher@example.invalid"},eventType:"confirmed",target:"teacher",actorEmail:"parent@example.invalid"});
 assert.equal(unbound.lineStatus,"not_bound");assert.equal(calls.length,4);
});
