import test from "node:test";
import assert from "node:assert/strict";
import {createHmac, randomInt} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {
  lineBindingCodeHash, lineNotificationModeLabel, normalizeLineNotificationMode,
  parseLineBindingCommand, verifyLineSignature, pushLineMessage
} from "../api/src/lib/lineMessaging.mjs";

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (path, globals, result = "") => runInNewContext(
  source(path).replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "") + result, globals
);
const defaultTenantId = () => "sacred-heart";
const tenantIdValue = value => String(value || "").toLowerCase();
const json = (jsonBody, status = 200) => ({status, jsonBody});
const botId = "U" + "a".repeat(32);
const channelA = {schoolId: "school-a", channelSecret: "secret-a", accessToken: "token-a", configured: true, botUserId: botId, legacy: false};
const channelB = {schoolId: "school-b", channelSecret: "secret-b", accessToken: "token-b", configured: true, botUserId: "U" + "b".repeat(32), legacy: false};

function webhookFixture(overrides = {}) {
  const handlers = {};
  const lookups = [], binds = [], replies = [];
  load("api/src/functions/lineWebhook.js", {
    app: {http: (name, route) => { handlers[name] = route.handler; }},
    json, Buffer, console, URL, defaultTenantId, tenantIdValue, randomInt,
    lineBindingCodeHash, lineNotificationModeLabel, normalizeLineNotificationMode, parseLineBindingCommand, verifyLineSignature,parseActivityLineBinding:()=>"",
    resolveTenantLineChannel: async school => school === channelA.schoolId ? channelA : school === channelB.schoolId ? channelB : {configured: false, legacy: false},
    findLineBindingRequest: async (school, hash, bot) => {
      lookups.push([school, hash, bot]);
      return {purpose: "absence"};
    },
    bindLineNotificationTarget: async target => { binds.push(target); return {}; },
    getLineGroupSummary: async () => ({groupName: "測試群組"}),
    replyLineMessage: async (...args) => { replies.push(args); },
    ...overrides
  });
  return {handlers, lookups, binds, replies};
}

function signedRequest(schoolId, signingChannel, destination = signingChannel.botUserId, event) {
  const raw = Buffer.from(JSON.stringify({
    destination,
    events: [event || {type: "message", message: {type: "text", text: "#綁定通知 123456"},
      replyToken: "reply-test", source: {type: "group", groupId: "group-a"}}]
  }));
  const signature = createHmac("sha256", signingChannel.channelSecret).update(raw).digest("base64");
  return {params: {schoolId}, arrayBuffer: async () => raw, headers: new Headers({"x-line-signature": signature})};
}

test("wrong school signature, wrong bot and unconfigured tenant cannot access binding storage", async () => {
  const {handlers, lookups, binds, replies} = webhookFixture();
  assert.equal((await handlers.tenantLineWebhook(signedRequest("school-b", channelA))).status, 401);
  assert.equal((await handlers.tenantLineWebhook(signedRequest("school-a", channelA, channelB.botUserId))).status, 401);
  assert.equal((await handlers.tenantLineWebhook(signedRequest("school-c", channelA))).status, 503);
  assert.equal(lookups.length + binds.length + replies.length, 0);
});

test("valid webhook looks up and consumes a binding in the selected school and replies with its token", async () => {
  const {handlers, binds, lookups, replies} = webhookFixture();
  assert.equal((await handlers.tenantLineWebhook(signedRequest("school-a", channelA))).status, 200);
  assert.deepEqual(lookups[0], ["school-a", lineBindingCodeHash("123456", "secret-a"), botId]);
  assert.equal(binds[0].schoolId, "school-a");
  assert.equal(binds[0].botUserId, botId);
  assert.equal(replies[0][2].accessToken, "token-a");
});

test("staff commands never fetch school data from a group chat and use the verified webhook school in direct chat", async () => {
  const reads=[];
  const {handlers,replies}=webhookFixture({
    resolveTenantLineChannel: async () => ({...channelA,loginConfigured:true}),
    tenantLineStaffReplyKind: () => "today",
    getTenantLineAccount: async (school,bot,user) => {reads.push([school,bot,user]);return {};},
    tenantLineStaffReply: async (kind,school) => `${school}:${kind}`
  });
  const msg={type:"message",message:{type:"text",text:"#幹部今日課程"},replyToken:"reply-test"};
  await handlers.tenantLineWebhook(signedRequest("school-a",channelA,botId,{...msg,source:{type:"group",groupId:"group-a"}}));
  assert.equal(reads.length,0);
  assert.match(replies[0][1], /一對一聊天室/);
  await handlers.tenantLineWebhook(signedRequest("school-a",channelA,botId,{...msg,source:{type:"user",userId:"test-user"}}));
  assert.deepEqual(reads,[["school-a",botId,"test-user"]]);
  assert.equal(replies[1][1],"school-a:today");
  assert.equal(replies[1][2].accessToken,"token-a");
});

test("group binding checks school partition, bot and conditional update for a one-use code", async () => {
  const schoolId = "school-a";
  const row = {
    partitionKey: schoolId, rowKey: "notifications", etag: "v1",
    lineAbsenceBindingCodeHash: "hash", lineAbsenceBindingBotUserId: botId,
    lineAbsenceBindingCodeExpiresAt: new Date(Date.now() + 60000).toISOString()
  };
  const client = {
    async getEntity(partition) {
      if (partition !== schoolId) throw Object.assign(new Error(), {statusCode: 404});
      return {...row};
    },
    async updateEntity(entity, mode, options) {
      if (options.etag !== row.etag) throw Object.assign(new Error(), {statusCode: 412});
      Object.assign(row, entity, {etag: "v2"});
    }
  };
  const {findLineBindingRequest, bindLineNotificationTarget} = load("api/src/lib/settings.js", {
    TableClient: {fromConnectionString: () => client},
    TableServiceClient: {fromConnectionString: () => ({createTable: async () => {}})},
    process: {env: {STORAGE_CONNECTION_STRING: "mock"}},
    tenantSchoolPartition: value => value, defaultTenantId, normalizeLineNotificationMode
  }, ";({findLineBindingRequest,bindLineNotificationTarget})");
  assert.equal(await findLineBindingRequest("school-b", "hash", botId), null);
  assert.equal(await findLineBindingRequest(schoolId, "hash", channelB.botUserId), null);
  const requestRow = await findLineBindingRequest(schoolId, "hash", botId);
  const input = {schoolId, targetId: "group-a", requestRow, botUserId: botId};
  assert.ok(await bindLineNotificationTarget(input));
  assert.equal(await bindLineNotificationTarget({...input, targetId: "group-b"}), null);
  assert.equal(await findLineBindingRequest(schoolId, "hash", botId), null);
  assert.equal(row.lineAbsenceTargetId, "group-a");
});

test("legacy token is available to Sacred Heart only and explicit sends fail without a token", async () => {
  const env = {LINE_CHANNEL_SECRET: "legacy-secret", LINE_CHANNEL_ACCESS_TOKEN: "legacy-token"};
  const {resolveTenantLineChannel, lineTargetMatchesChannel} = load("api/src/lib/lineTenantConfig.js", {
    process: {env}, defaultTenantId, tenantSchoolPartition: value => value,
    getTenantDirectory: async () => ({status: "active"}),
    TableClient: {fromConnectionString: () => ({getEntity: async () => {throw Object.assign(new Error(), {statusCode: 404});}})}
  }, ";({resolveTenantLineChannel,lineTargetMatchesChannel})");
  const sacredHeart = await resolveTenantLineChannel("sacred-heart");
  assert.equal(sacredHeart.accessToken, "legacy-token");
  assert.equal(lineTargetMatchesChannel({targetId: "group-a"}, sacredHeart), true);
  assert.equal(lineTargetMatchesChannel({targetId: "group-a"}, channelA), false);
  assert.equal(lineTargetMatchesChannel({targetId: "group-a", botUserId: channelB.botUserId}, channelA), false);
  assert.equal((await resolveTenantLineChannel("school-b")).accessToken, "");
  await assert.rejects(pushLineMessage("group-a", "test"), /LINE_CHANNEL_ACCESS_TOKEN/);
});

test("only the same verified Sacred Heart bot can inherit existing groups", async () => {
  const {createHash} = await import("node:crypto");
  const rows = new Map();
  const client = {
    async createTable() {},
    async getEntity(partition, rowKey) {
      if (!rows.has(rowKey)) throw Object.assign(new Error(), {statusCode: 404});
      return rows.get(rowKey);
    },
    async submitTransaction(actions) {
      for (const [, row] of actions) rows.set(row.rowKey, {...row, etag: "test-etag"});
    }
  };
  const {saveTenantLineChannel, resolveTenantLineChannel, lineTargetMatchesChannel} = load(
    "api/src/lib/lineTenantConfig.js", {
      createHash, defaultTenantId, tenantSchoolPartition: value => value,
      getTenantDirectory: async () => ({status: "active"}),
      TableClient: {fromConnectionString: () => client},
      process: {env: {
        LINE_CHANNEL_SECRET: "legacy-secret", LINE_CHANNEL_ACCESS_TOKEN: "legacy-token",
        LINE_SACRED_HEART_CHANNEL_SECRET: "sacred-secret", LINE_SACRED_HEART_CHANNEL_ACCESS_TOKEN: "sacred-token",
        LINE_SCHOOL_B_CHANNEL_SECRET: "school-b-secret", LINE_SCHOOL_B_CHANNEL_ACCESS_TOKEN: "duplicate-bot-token"
      }},
      lineApi: async () => ({userId: botId})
    }, ";({saveTenantLineChannel,resolveTenantLineChannel,lineTargetMatchesChannel})"
  );
  await assert.rejects(saveTenantLineChannel("school-b", "active", "admin"), /已用於聖心/);
  assert.equal(rows.size, 0);
  await saveTenantLineChannel("sacred-heart", "active", "admin");
  const channel = await resolveTenantLineChannel("sacred-heart");
  assert.equal(channel.legacy, false);
  assert.equal(channel.acceptsLegacy, true);
  assert.equal(channel.accessToken, "sacred-token");
  assert.equal(lineTargetMatchesChannel({targetId: "original-group"}, channel), true);
});
