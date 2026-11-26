import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {validateParentLessonReview} from "../api/src/lib/privateLessonReview.mjs";

const root = "../api/src/lib/";
const load = (name, globals, result, transform = source => source) => runInNewContext(
  transform(readFileSync(new URL(root + name, import.meta.url), "utf8"))
    .replace(/^import .+;$/gm, "").replace(/^export /gm, "") + ";(" + result + ")", globals
);
const defaultTenantId = () => "sacred-heart";
const otherSchools = Array.from({length: 5}, (_, i) => "demo-school-" + (i + 2));
const schoolIds = [defaultTenantId(), ...otherSchools];

test("six tenants use only their own mail settings, with legacy mail reserved for Sacred Heart", async () => {
  const env = {ACS_EMAIL_CONNECTION_STRING: "legacy-transport", ACS_EMAIL_SENDER: "sacred@example.test"};
  for (const [i, sid] of otherSchools.slice(0, 3).entries()) {
    const prefix = "ACS_EMAIL_" + sid.replaceAll("-", "_").toUpperCase() + "_";
    env[prefix + "CONNECTION_STRING"] = "mock-connection-" + i;
    env[prefix + "SENDER"] = sid + "@example.test";
    env[prefix + "APP_URL"] = "https://" + sid + ".example.test/portal";
  }
  env.ACS_EMAIL_DEMO_SCHOOL_5_ENABLED = "false";
  env.ACS_EMAIL_DEMO_SCHOOL_6_SENDER = "partial@example.test";
  const config = load("tenantEmailConfig.mjs", {process:{env}, URL, defaultTenantId}, "{tenantEmailConfig,tenantEmailAddress}");
  const outbound = [];
  class EmailClient {
    constructor(connection) {this.connection = connection;}
    async beginSend(message) {
      outbound.push({...message, connection: this.connection});
      return {pollUntilDone: async () => ({status:"succeeded", id:"mock"})};
    }
  }
  const getTenantLineParentContact = async sid => sid === otherSchools[0] ? "verified@example.test" : "";
  const send = load("email.js", {
    ...config, getTenantLineParentContact, EmailClient, URL, console
  }, "sendPaymentRequiredEmail");
  const options = {appUrl:"https://portal.example.test/", title:"團 T"};
  for (const [i, sid] of schoolIds.entries()) {
    const result = await send({...options, schoolId:sid, recipient:"parent" + i + "@example.test"});
    assert.equal(result.status, i < 4 ? "sent" : "not_configured");
  }
  assert.deepEqual(outbound.map(row => row.senderAddress), [
    "sacred@example.test", ...otherSchools.slice(0, 3).map(sid => sid + "@example.test")
  ]);
  assert.deepEqual(outbound.map(row => row.connection), ["legacy-transport", "mock-connection-0", "mock-connection-1", "mock-connection-2"]);
  assert.match(outbound[1].content.plainText, /https:\/\/demo-school-2\.example\.test\/portal/);
  const synthetic = "line-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@line.invalid";
  assert.equal((await send({...options, schoolId:otherSchools[0], recipient:synthetic})).status, "sent");
  assert.equal(outbound.at(-1).recipients.to[0].address, "verified@example.test");
  assert.equal((await send({...options, schoolId:otherSchools[1], recipient:synthetic})).status, "failed");
  assert.equal((await send({...options, recipient:"parent@example.test"})).status, "not_configured");
  env.ACS_EMAIL_SACRED_HEART_SENDER = "partial@example.test";
  assert.equal(config.tenantEmailConfig(defaultTenantId()).mode, "unconfigured");
  env.LAB_ENVIRONMENT = "functional-uat";
  assert.equal(config.tenantEmailConfig(otherSchools[0]).mode, "lab_suppressed");
  assert.equal((await send({...options, schoolId:otherSchools[0], recipient:"parent@example.test"})).status, "not_configured");
  assert.equal(outbound.length, 5);
});

test("login discovery uses one config query for six tenants and omits disabled or incomplete channels", async () => {
  const env = {};
  const configs = [];
  let queries = 0;
  const fingerprint = value => createHash("sha256").update(value).digest("hex");
  for (const [i, sid] of schoolIds.entries()) {
    const prefix = "LINE_" + sid.toUpperCase().replaceAll("-", "_") + "_";
    Object.assign(env, {
      [prefix + "CHANNEL_SECRET"]:"secret" + i, [prefix + "CHANNEL_ACCESS_TOKEN"]:"token" + i,
      [prefix + "LOGIN_CHANNEL_ID"]:String(123456 + i), [prefix + "LOGIN_CHANNEL_SECRET"]:"login-secret" + i,
      [prefix + "APP_ORIGIN"]:"https://portal.example.test"
    });
    if (i !== 5) configs.push({
      rowKey:"school-" + sid, status:i === 4 ? "disabled" : "active", botUserId:"U" + String(i).repeat(32),
      secretFingerprint:fingerprint("secret" + i), tokenFingerprint:fingerprint("token" + i),
      loginFingerprint:fingerprint(JSON.stringify([String(123456 + i), "login-secret" + i, "https://portal.example.test"]))
    });
  }
  const discover = load("lineTenantConfig.js", {
    createHash, defaultTenantId, URL, process:{env},
    TableClient:{fromConnectionString:() => ({
      async *listEntities(){queries++;yield* configs;}
    })}
  }, "listTenantLineLoginSchools");
  const tenants = schoolIds.map((schoolId, i) => ({schoolId, schoolName:"DEMO " + i, status:i === 3 ? "setup" : "active"}));
  const choices = await discover(tenants);
  assert.deepEqual(Array.from(choices, row => row.schoolId), schoolIds.slice(0, 3));
  assert.equal(queries, 1);
});


test("webhook links use configured public origin or a relative path",()=>{
  const links=load("lineTenantConfig.js",{createHash,URL,process:{env:{}}},"tenantWebhookLinks");
  const channel={schoolId:"sacred-heart",legacy:false};
  assert.equal(links(channel).webhookPath,"/api/line/webhook/sacred-heart");
  assert.equal(links(channel).webhookUrl,"");
  assert.equal(links({...channel,appOrigin:"https://school.example.test"}).webhookUrl,
    "https://school.example.test/api/line/webhook/sacred-heart");
});

test("pending uniforms notify the same school's group and active bound administrators in immediate modes", async () => {
  const env = {};
  const outbound = [];
  const target = {targetId:"group-a", targetType:"group", botUserId:"bot-a", mode:"important_and_daily"};
  const channel = {configured:true, loginConfigured:true, botUserId:"bot-a", accessToken:"token-a"};
  let admins = [];
  const notify = load("lineAdminTodoNotification.mjs", {
    process:{env},createHash,
    getLineNotificationTarget: async school => {assert.equal(school,"sacred-heart");return target;},
    resolveTenantLineChannel: async school => {assert.equal(school,"sacred-heart");return channel;},
    listTenantAdmins: async (school,status) => {assert.deepEqual([school,status],["sacred-heart","active"]);return admins;},
    getTenantLineRecipient: async (school,email,bot) => {
      assert.deepEqual([school,email,bot],["sacred-heart","active@example.test","bot-a"]);
      return {lineUserId:"staff-user"};
    },
    lineTargetMatchesChannel:(group, bot) => group.botUserId === bot.botUserId,
    pushLineMessage: async (...args) => outbound.push(args)
  }, "notifyUniformReview");
  const request = {kind:"competitionUniform", status:"PENDING", id:"test-request", studentId:"private-id"};
  assert.equal(await notify("sacred-heart", {...request, status:"APPROVED"}), undefined);
  target.mode = "daily_only";
  assert.equal(await notify("sacred-heart", request), "daily_only");
  target.mode = "off";
  assert.equal(await notify("sacred-heart", request), "off");
  target.mode = "instant_only";
  target.botUserId = "other-bot";
  assert.equal(await notify("sacred-heart", request), "rebind_required");
  target.botUserId = "bot-a";
  env.LAB_ENVIRONMENT = "functional-uat";
  assert.equal(await notify("sacred-heart", request), "lab_suppressed");
  assert.equal(outbound.length, 0);
  delete env.LAB_ENVIRONMENT;
  assert.equal(await notify("sacred-heart", request), "sent");
  assert.equal(outbound.length, 1);
  const [[group, text, options]] = outbound;
  assert.equal(group, "group-a");
  assert.match(text, /比賽服申請待審/);
  assert.doesNotMatch(text, /private-id/);
  assert.equal(options.accessToken, "token-a");
  assert.equal(options.retryKey, request.id);
  const shirt = {...request, kind:"regularUniform", id:"shirt-request"};
  assert.equal(await notify("sacred-heart", {...shirt, status:"APPROVED"}), undefined);
  assert.equal(await notify("sacred-heart", {...shirt, kind:"fieldTrip"}), undefined);
  admins = [{status:"active",role:"schoolAdmin",partitionKey:"active@example.test"},{status:"inactive",role:"schoolAdmin",partitionKey:"inactive@example.test"}];
  assert.equal(await notify("sacred-heart", shirt), "sent");
  assert.equal(outbound.length, 3);
  assert.equal(outbound[1][0], group);
  assert.match(outbound[1][1], /團 T 申請待審/);
  assert.equal(outbound[1][2].retryKey, shirt.id);
  assert.equal(outbound[2][0],"staff-user");
  assert.match(outbound[2][2].retryKey,/^[0-9a-f-]{36}$/);
});

test("the named LINE UAT enables Sacred Heart finance transfer and parent confirmation LINE notifications", () => {
  const source = readFileSync(new URL(root + "lineTenantConfig.js", import.meta.url),"utf8");
  const config = source.replace(/^import .+;$/gm,"").replace(/^export /gm,"");
  const env = {LAB_ENVIRONMENT:"functional-uat"};
  const get = (builtForLineUat) => runInNewContext(
    config.replace("const buildEnablesLabPaymentNotifications = false;", "const buildEnablesLabPaymentNotifications = " + builtForLineUat + ";") + ";credentials",
    {process:{env},defaultTenantId,URL}
  );
  const namedLab = get(true), defaultLab = get(false);
  assert.equal(defaultLab("sacred-heart").financeTransferLineEnabled,false);
  assert.equal(namedLab("sacred-heart").financeTransferLineEnabled,true);
  assert.equal(namedLab("sacred-heart").paymentLineEnabled,false);
  assert.equal(defaultLab("sacred-heart").paymentConfirmationLineEnabled,false);
  assert.equal(namedLab("sacred-heart").paymentConfirmationLineEnabled,true);
  assert.equal(namedLab("other-school").paymentConfirmationLineEnabled,false);
  assert.equal(namedLab("sacred-heart",true).financeTransferLineEnabled,false);
  assert.equal(namedLab("other-school").financeTransferLineEnabled,false);
  env.LINE_SACRED_HEART_PAYMENT_NOTIFICATIONS_ENABLED="false";
  assert.equal(namedLab("sacred-heart").financeTransferLineEnabled,false);
  assert.equal(namedLab("sacred-heart").paymentConfirmationLineEnabled,false);
  delete env.LINE_SACRED_HEART_PAYMENT_NOTIFICATIONS_ENABLED;
  delete env.LAB_ENVIRONMENT;
  assert.equal(namedLab("sacred-heart").financeTransferLineEnabled,false);
  env.LINE_SACRED_HEART_PAYMENT_NOTIFICATIONS_ENABLED="true";
  assert.equal(namedLab("sacred-heart").financeTransferLineEnabled,true);
});

test("finance LINE dispatch contains no transfer details and only reaches assigned, active staff",async()=>{
  const outbound=[];
  const registered=[
    {status:"active",role:"schoolAdmin",partitionKey:"finance@example.test"},
    {status:"active",role:"schoolAdmin",partitionKey:"staff@example.test"}
  ];
  const {financeRecipients}=await import("../api/src/lib/financeNoticeRules.mjs");
  const channel={loginConfigured:true,financeTransferLineEnabled:true,botUserId:"bot-a",accessToken:"token-a"};
  const env={};
  const globals={
    process:{env},createHash,financeRecipients,
    resolveTenantLineChannel:async()=>channel,
    listTenantAdmins:async()=>registered,
    financeAssignments:async()=>[{email:"finance@example.test",status:"active"},{email:"staff@example.test",status:"inactive"}],
    getTenantLineRecipient:async (school,email,bot)=>{
      assert.deepEqual([school,email,bot],["sacred-heart","finance@example.test","bot-a"]);
      return {lineUserId:"finance-user"};
    },
    pushLineMessage:async (...args)=>outbound.push(args)
  };
  const bind=(namedLab=false)=>load("lineAdminTodoNotification.mjs",{...globals},"{notifyFinanceTransfer,retryFinanceTransfer}",source=>
    namedLab?source.replace("const buildEnablesLabAdminTodos = false;","const buildEnablesLabAdminTodos = true;"):source
  );
  const {notifyFinanceTransfer:notify,retryFinanceTransfer:retryProduction}=bind();
  const {retryFinanceTransfer:retryNamedLab}=bind(true);
  const event={kind:"uniform",id:"private-request-id",reportedAt:new Date(Date.now()-1000).toISOString()};
  channel.financeTransferLineEnabled=false;
  assert.equal(await notify("sacred-heart",event),"not_configured");
  assert.equal(outbound.length,0);
  channel.financeTransferLineEnabled=true;
  assert.equal(await notify("sacred-heart",event),"sent");
  const record={paymentStatus:"REPORTED_UNVERIFIED",transferReport:{reportedAt:event.reportedAt}};
  assert.equal(await retryProduction("sacred-heart",event.kind,event.id,record),"sent");
  assert.equal(await retryNamedLab("sacred-heart",event.kind,event.id,record),"sent");
  env.LAB_ENVIRONMENT="functional-uat";
  assert.equal(await retryProduction("sacred-heart",event.kind,event.id,record),"lab_suppressed");
  assert.equal(outbound.length,3);
  assert.equal(await retryNamedLab("sacred-heart",event.kind,event.id,{...record,paymentStatus:"VERIFIED"}),"ineligible");
  assert.equal(await retryNamedLab("sacred-heart",event.kind,event.id,{...record,transferReport:{reportedAt:"2020-01-01T00:00:00Z"}}),"ineligible");
  assert.equal(await retryNamedLab("sacred-heart",event.kind,event.id,record),"sent");
  assert.equal(outbound[0][0],"finance-user");
  assert.match(outbound[0][1],/財務待辦/);
  assert.doesNotMatch(outbound[0][1],/private-request-id/);
  assert.ok(outbound.every(row=>row[2].retryKey===outbound[0][2].retryKey));
});

test("uniform cancellation sends the stored reason only to the original applicant's school LINE account", async () => {
  const outbound = [];
  const applicant = "original@example.test";
  const request = {id:"request", kind:"regularUniform", status:"CANCELLED", parentEmail:applicant, cancelReason:"尺寸請重新確認"};
  let account = null;
  const cancel = load("lineAdminTodoNotification.mjs", {
    process:{env:{}},
    resolveTenantLineChannel:async school => {
      assert.equal(school,"sacred-heart");
      return {loginConfigured:true, botUserId:"school-bot", accessToken:"school-token"};
    },
    getTenantLineRecipient:async (school, email, bot) => {
      assert.deepEqual([school,email,bot],["sacred-heart",applicant,"school-bot"]);
      return account;
    },
    pushLineMessage:async (...args) => outbound.push(args)
  }, "notifyUniformCancellation");
  assert.equal(await cancel("sacred-heart",{...request,status:"PENDING"}),undefined);
  assert.equal(await cancel("sacred-heart",{...request,parentEmail:""}),"applicant_unknown");
  assert.equal(await cancel("sacred-heart",request),"not_bound");
  assert.equal(outbound.length,0);
  account = {lineUserId:"applicant-line"};
  assert.equal(await cancel("sacred-heart",request),"accepted");
  assert.equal(outbound.length,1);
  assert.equal(outbound[0][0],"applicant-line");
  assert.match(outbound[0][1],/團 T 申請。\n原因：尺寸請重新確認/);
  assert.equal(outbound[0][2].accessToken,"school-token");
});

test("announcement previews support a new group and deduplicate households and roles",async()=>{
  const students=[{rowKey:"100001",groupName:"新團"},{rowKey:"100002",groupName:"新團"},{rowKey:"100003",groupName:"A"}];
  const target="U"+"a".repeat(32);
  const audience=load("lineAudience.js",{
    resolveTenantLineChannel:async school=>({schoolId:school,botUserId:"bot-one",configured:true}),
    listUserStudentMappings:async schoolStatus=>{
      assert.equal(schoolStatus,"active");
      return [{studentId:"100001",parentEmail:"same@example.test"},{studentId:"100002",parentEmail:"same@example.test"},{studentId:"100003",parentEmail:"other@example.test"}];
    },
    getApprovedParentStudent:async(school,email,id)=>{assert.equal(school,"sacred-heart");assert.equal(email,"same@example.test");return {studentId:id}},
    listTenantAdmins:async()=>[{role:"schoolAdmin",status:"active",partitionKey:"same@example.test"}],
    getTenantLineDeliveryRecipient:async(school,email,channel)=>{
      const bot=channel.botUserId;
      assert.deepEqual([school,email,bot],["sacred-heart","same@example.test","bot-one"]);
      return {lineUserId:target,parentEmail:email};
    }
  },"{lineAudienceGroups,resolveLineAudience}");
  assert.ok(audience.lineAudienceGroups(students).includes("新團"));
  const result=await audience.resolveLineAudience("sacred-heart","bot-one",{students,groups:["新團"],roles:["parent","staff"]});
  assert.equal(result.matched,1);
  assert.deepEqual([...result.targets],[target]);
  assert.equal(result.recipients.length,1);assert.equal(result.recipients[0].userId,target);assert.equal(result.recipients[0].name,"same@example.test");
});

test("a LINE review is restricted to the original recipient, active family link and completed lesson",async()=>{
  const code="0123456789ABCD",owner="U"+"b".repeat(32),bot="U"+"a".repeat(32);
  const lesson={completedAt:"lesson-version",status:"teacher_completed",eventDate:"2026-11-17",etag:"v1"};
  const row={userId:owner,email:"parent@example.test",studentId:"student1",lessonId:"lesson1",
    completedAt:lesson.completedAt,expiresAt:Date.now()+60_000};
  let authorized=true,saved;
  const receive=load("linePrivateLesson.js",{
    process:{env:{STORAGE_CONNECTION_STRING:"mock"}},workflowLineEnabled:()=>true,validateParentLessonReview,
    TableClient:{fromConnectionString:()=>({getEntity:async(partition,key)=>{
      assert.deepEqual([partition,key],[`sacred-heart|${bot}`,code]);return row;
    }})},
    getTenantLineRecipient:async()=>({lineUserId:owner}),
    getMappedStudentsByEmail:async()=>authorized?[{studentId:"student1"}]:[],
    getStudentAliasInfo:async id=>({canonicalStudentId:id}),
    ensureTenantTables:async()=>{},
    tenantStudentPartition:(school,student)=>`${school}|${student}`,
    table:()=>({getEntity:async()=>lesson,updateEntity:async(patch,_mode,constraints)=>{
      assert.equal(constraints.etag,"v1");saved=patch;Object.assign(lesson,patch);
    }})
  },"receivePrivateLessonReview");
  const channel={schoolId:"sacred-heart",botUserId:bot};
  const message="#個課評鑑 "+code+" 5 感謝老師耐心指導";
  assert.match(await receive(channel,"U"+"c".repeat(32),message),/失效/);
  authorized=false;
  assert.match(await receive(channel,owner,message),/失效/);
  authorized=true;
  assert.match(await receive(channel,owner,message),/已記錄.*5 星/);
  assert.equal(saved.teacherRating,5);
  assert.equal(saved.teacherReview,"感謝老師耐心指導");
  assert.equal(saved.parentConfirmation,"confirmed");
  assert.equal(saved.parentConfirmedBy,row.email);
  assert.equal(saved.parentConfirmedVia,"line");
  assert.equal(saved.status,"present");
  assert.ok(saved.finalizedAt);
  assert.match(await receive(channel,owner,message),/已收到評鑑/);
});
