import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const root = "../api/src/lib/";
const load = (name, globals, result) => runInNewContext(
  readFileSync(new URL(root + name, import.meta.url), "utf8")
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

test("pending competition uniforms notify only the school's bound admin group in immediate modes", async () => {
  const env = {};
  const outbound = [];
  const target = {targetId:"group-a", targetType:"group", botUserId:"bot-a", mode:"important_and_daily"};
  const channel = {configured:true, loginConfigured:true, botUserId:"bot-a", accessToken:"token-a"};
  const notify = load("lineAdminTodoNotification.mjs", {
    process:{env},
    getLineNotificationTarget: async school => {assert.equal(school,"sacred-heart");return target;},
    resolveTenantLineChannel: async school => {assert.equal(school,"sacred-heart");return channel;},
    lineTargetMatchesChannel:(group, bot) => group.botUserId === bot.botUserId,
    pushLineMessage: async (...args) => outbound.push(args)
  }, "notifyCompetitionUniformReview");
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
});
