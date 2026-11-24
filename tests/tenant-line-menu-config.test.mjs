import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {tenantFacebookUrl, tenantFacebookMenuUrl} from "../api/src/lib/lineFacebookConfig.js";

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (path, globals, result) => runInNewContext(
  source(path).replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "") + result, globals
);
const hash = value => createHash("sha256").update(value).digest("hex");
const schoolId = "school-a", botId = "U" + "a".repeat(32), otherBot = "U" + "b".repeat(32);
const parentId = "richmenu-" + "1".repeat(32), staffId = "richmenu-" + "2".repeat(32);
const otherId = "richmenu-" + "3".repeat(32), origin = "https://production.example.invalid";
const menu = (richMenuId, action = {type: "message", text: "#今日課程"}, areaCount = richMenuId === parentId ? 4 : 6) => ({
  richMenuId, name: richMenuId === staffId ? "幹部選單" : "家長選單", chatBarText: "功能",
  size: {width: 2500, height: 1686}, areas: Array.from({length: areaCount}, () => ({action: {...action}}))
});

function fixture(options = {}) {
  const env = {
    STORAGE_CONNECTION_STRING: "storage-test",
    LINE_SCHOOL_A_CHANNEL_SECRET: "school-a-secret",
    LINE_SCHOOL_A_CHANNEL_ACCESS_TOKEN: "school-a-token",
    LINE_SCHOOL_A_APP_ORIGIN: origin,
    LINE_SCHOOL_A_PARENT_RICH_MENU_ID: parentId, LINE_SCHOOL_A_STAFF_RICH_MENU_ID: otherId,
    ...options.env
  };
  const initialRow = {
    partitionKey: "line", rowKey: "school-school-a", status: "active", botUserId: botId, etag: "v1",
    secretFingerprint: hash(env.LINE_SCHOOL_A_CHANNEL_SECRET), tokenFingerprint: hash(env.LINE_SCHOOL_A_CHANNEL_ACCESS_TOKEN),
    ...options.row
  };
  const rows = new Map(options.noRow ? [] : [[initialRow.rowKey, initialRow]]);
  const calls = [], writes = [], applyCalls = [], definitions = options.definitions || new Map([[parentId, menu(parentId)], [staffId, menu(staffId)]]);
  const client = {
    async getEntity(partition, key) {
      if (!rows.has(key)) throw Object.assign(Error("missing"), {statusCode: 404});
      return {...rows.get(key)};
    },
    async createTable() {},
    async updateEntity(row, mode, condition) {
      if (options.conflict || condition.etag !== rows.get(row.rowKey)?.etag) throw Object.assign(Error("changed"), {statusCode: 412});
      writes.push({row, mode, condition});
      rows.set(row.rowKey, {...rows.get(row.rowKey), ...row, etag: "v2"});
    },
    async submitTransaction(actions) {
      for (const [operation, row, mode, condition] of actions) {
        if (operation === "update" && condition.etag !== rows.get(row.rowKey)?.etag) throw Object.assign(Error("changed"), {statusCode: 412});
        writes.push({row, operation, mode, condition});
        rows.set(row.rowKey, {...row, etag: "v3"});
      }
    }
  };
  const api = load("api/src/lib/lineTenantConfig.js", {
    tenantFacebookUrl, tenantFacebookMenuUrl,
    applyTenantLineMenus: async input => {applyCalls.push(input); return {schoolId: input.schoolId, facebookUrl: input.facebookUrl, parentMenuId: parentId, staffMenuId: staffId, applied: true};},
    createHash, URL, process: {env}, defaultTenantId: () => "sacred-heart", tenantSchoolPartition: String,
    getTenantDirectory: async () => ({status: options.tenantStatus || "active"}),
    TableClient: {fromConnectionString: () => client},
    lineApi: async (path, request) => {
      calls.push({path, request});
      if (path === "/v2/bot/info") return {userId: options.botId || botId};
      if (path === "/v2/bot/richmenu/list") {
        if (options.listFailure) throw Error("token-secret-private-provider-body");
        return {richmenus: [...definitions.values()]};
      }
      const id = path.replace("/v2/bot/richmenu/", "");
      if (!definitions.has(id)) throw Object.assign(Error("foreign account"), {status: 404});
      return definitions.get(id);
    }
  }, ";({listTenantLineMenus,saveTenantLineMenus,resolveTenantLineChannel,saveTenantLineChannel,applyTenantLineMenuTemplates,LineConfigError})");
  return {api, env, rows, calls, writes, definitions, applyCalls};
}

test("Facebook template apply validates the address and uses only this active school's verified configuration", async () => {
  const f = fixture(), facebookUrl = "https://www.facebook.com/groups/school-a/";
  const result = await f.api.applyTenantLineMenuTemplates(schoolId, facebookUrl, "global@example.invalid");
  assert.equal(result.applied, true); assert.equal(f.applyCalls.length, 1);
  assert.equal(f.applyCalls[0].channel.schoolId, schoolId); assert.equal(f.applyCalls[0].channel.botUserId, botId);
  assert.equal(f.applyCalls[0].configRow.etag, "v1"); assert.equal(f.applyCalls[0].facebookUrl, facebookUrl);
  assert.equal(f.writes.length, 0);
  for (const address of ["http://www.facebook.com/example", "https://facebook.com.evil.invalid/", "javascript:alert(1)", ""]) {
    await assert.rejects(f.api.applyTenantLineMenuTemplates(schoolId, address, "global"), /Facebook/);
  }
  assert.equal(f.applyCalls.length, 1);
  const disabled = fixture({row: {status: "disabled"}});
  await assert.rejects(disabled.api.applyTenantLineMenuTemplates(schoolId, facebookUrl, "global"), /先驗證並啟用/);
  assert.equal(disabled.applyCalls.length, 0);
});

test("Facebook family five-entry menus require this school's activated redirect while legacy four entries remain valid", async () => {
  const facebookUrl = "https://www.facebook.com/groups/school-a/";
  const five = menu(parentId, undefined, 5);
  five.areas[4].action = {type: "uri", uri: origin + "/api/line/facebook/school-a?openExternalBrowser=1"};
  const f = fixture({row: {facebookUrl}, definitions: new Map([[parentId, five], [staffId, menu(staffId)]])});
  const choices = await f.api.listTenantLineMenus(schoolId);
  assert.equal(choices.facebookUrl, facebookUrl); assert.equal(choices.menus[0].parentSelectable, true);
  await f.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global");
  assert.equal(f.writes.length, 1);
  const notActivated = fixture({definitions: new Map([[parentId, five], [staffId, menu(staffId)]])});
  await assert.rejects(notActivated.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global"), /Facebook/);
  const foreign = structuredClone(five); foreign.areas[4].action.uri = origin + "/api/line/facebook/school-b?openExternalBrowser=1";
  const other = fixture({row: {facebookUrl}, definitions: new Map([[parentId, foreign], [staffId, menu(staffId)]])});
  await assert.rejects(other.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global"), /Facebook/);
});

test("school Facebook addresses survive channel reverification and replacement without inheriting old menu IDs", async () => {
  const facebookUrl = "https://www.facebook.com/groups/school-a/";
  for (const botIdChange of [botId, otherBot]) {
    const f = fixture({botId: botIdChange, row: {facebookUrl, menuBotUserId: botId, menuAppOrigin: origin, parentMenuId: parentId, staffMenuId: staffId, menuTemplateVersion: "facebook-v1", menuApplyOperationId: "old-operation"}});
    await f.api.saveTenantLineChannel(schoolId, "active", "global");
    const row = f.rows.get("school-school-a"); assert.equal(row.facebookUrl, facebookUrl);
    assert.equal((await f.api.resolveTenantLineChannel(schoolId)).facebookUrl, facebookUrl);
    assert.equal(row.menuTemplateVersion, botIdChange === botId ? "facebook-v1" : undefined);
  }
});

test("advanced menu selection cannot adopt an asset while a Global apply operation still owns its lease", async () => {
  const f = fixture();
  f.rows.set("menu-apply-" + schoolId, {partitionKey: "line", rowKey: "menu-apply-" + schoolId, operationId: "applying", leaseExpiresAt: new Date(Date.now() + 90000).toISOString(), etag: "lease"});
  await assert.rejects(f.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global"), /正在套用/);
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
  f.rows.get("menu-apply-" + schoolId).leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
  await f.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global");
  assert.equal(f.writes.length, 1);
});

test("Global menu discovery exposes safe display metadata from the selected school's token without changing LINE", async () => {
  const f = fixture();
  const data = await f.api.listTenantLineMenus(schoolId);
  assert.equal(data.schoolId, schoolId);
  assert.equal(data.parentMenuId, parentId); assert.equal(data.staffMenuId, otherId);
  assert.equal(data.menus.length, 2);
  assert.equal(data.menus[1].selectable, true); assert.equal(data.menus[1].areaCount, 6);
  assert.equal(data.menus[0].parentSelectable, true); assert.equal(data.menus[0].staffSelectable, false);
  assert.equal(data.menus[0].parentValidationError, ""); assert.match(data.menus[0].staffValidationError, /六宮格/);
  assert.equal(data.menus[1].parentSelectable, false); assert.equal(data.menus[1].staffSelectable, true);
  assert.match(data.menus[1].parentValidationError, /四宮格/); assert.equal(data.menus[1].staffValidationError, "");
  assert.deepEqual(JSON.parse(JSON.stringify(data.menus[1].size)), {width: 2500, height: 1686});
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, "/v2/bot/richmenu/list");
  assert.equal(f.calls[0].request.accessToken, "school-a-token"); assert.equal(f.calls[0].request.method, "GET");
  assert.doesNotMatch(JSON.stringify(data), /school-a-token|school-a-secret|areas|action/);
  assert.equal(f.writes.length, 0);
});

test("saving distinct same-bot menus only conditionally persists nonsecret IDs and overrides environment IDs", async () => {
  const f = fixture();
  const result = await f.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global@example.invalid");
  assert.equal(result.staffMenuId, staffId); assert.equal(f.writes.length, 1);
  const write = f.writes[0];
  assert.equal(write.mode, "Merge"); assert.equal(write.condition.etag, "v1");
  assert.equal(write.row.menuBotUserId, botId); assert.equal(write.row.menuUpdatedBy, "global@example.invalid");
  assert.equal(write.row.menuAppOrigin, origin);
  assert.doesNotMatch(JSON.stringify(write), /school-a-token|school-a-secret/);
  assert.ok(f.calls.every(call => call.request.method === "GET" && call.request.accessToken === "school-a-token"));
  assert.equal((await f.api.resolveTenantLineChannel(schoolId)).staffMenuId, staffId);
  assert.equal((await f.api.resolveTenantLineChannel(schoolId)).parentMenuId, parentId);
});

test("menu configuration requires an active verified modern school channel and never creates a legacy override row", async () => {
  for (const options of [{noRow: true}, {row: {status: "disabled"}}, {row: {tokenFingerprint: "stale"}}, {tenantStatus: "disabled"}]) {
    const f = fixture(options);
    await assert.rejects(f.api.listTenantLineMenus(schoolId), /先驗證並啟用/);
    await assert.rejects(f.api.saveTenantLineMenus(schoolId, {parentMenuId: "", staffMenuId: staffId}, "global"), /先驗證並啟用/);
    assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0);
  }
});

test("invalid, duplicate, foreign or wrong-audience menu selections cannot be saved", async () => {
  for (const selection of [{parentMenuId: "", staffMenuId: ""}, {parentMenuId: parentId, staffMenuId: "bad"}, {parentMenuId: staffId, staffMenuId: staffId}]) {
    const f = fixture();
    await assert.rejects(f.api.saveTenantLineMenus(schoolId, selection, "global"));
    assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0);
  }
  const foreign = fixture();
  await assert.rejects(foreign.api.saveTenantLineMenus(schoolId, {parentMenuId: "", staffMenuId: otherId}, "global"), /不屬於此校/);
  assert.equal(foreign.writes.length, 0);
  const short = menu(staffId); short.areas.pop();
  const f = fixture({definitions: new Map([[staffId, short]])});
  await assert.rejects(f.api.saveTenantLineMenus(schoolId, {parentMenuId: "", staffMenuId: staffId}, "global"), /六宮格/);
  assert.equal(f.writes.length, 0);
});

test("logged-in parent four-grid and staff six-grid are independently enforced while the unbound default remains unchanged", async () => {
  const accepted = fixture();
  await accepted.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global");
  assert.equal(accepted.writes.length, 1);
  assert.ok(accepted.calls.every(call => call.request.method === "GET"));
  for (const [parentCount, staffCount, error] of [[3, 6, /家長.*四宮格/], [6, 6, /家長.*四宮格/], [4, 3, /幹部與老師.*六宮格/], [4, 4, /幹部與老師.*六宮格/]]) {
    const f = fixture({definitions: new Map([[parentId, menu(parentId, undefined, parentCount)], [staffId, menu(staffId, undefined, staffCount)]])});
    await assert.rejects(f.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global"), error);
    assert.equal(f.writes.length, 0);
  }
  const unsafeParent = fixture({definitions: new Map([[parentId, menu(parentId, {type: "uri", uri: "https://lab.example.invalid/"})], [staffId, menu(staffId)]])});
  const choice = (await unsafeParent.api.listTenantLineMenus(schoolId)).menus[0];
  assert.equal(choice.parentSelectable, false); assert.match(choice.parentValidationError, /其他環境/);
  await assert.rejects(unsafeParent.api.saveTenantLineMenus(schoolId, {parentMenuId: parentId, staffMenuId: staffId}, "global"), /其他環境/);
  assert.equal(unsafeParent.writes.length, 0);
});

test("discovery marks LAB, other-school, alternate desktop and unsupported switch destinations unavailable and save rechecks", async () => {
  const cases = [
    [{type: "uri", uri: "https://icy-ocean-0a2602100-lineuat.eastasia.6.azurestaticapps.net/?schoolId=school-a"}, /其他環境/],
    [{type: "uri", uri: `${origin}/?schoolId=school-b`}, /其他學校/],
    [{type: "uri", uri: `${origin}/?schoolId=school-a&schoolId=school-b`}, /其他學校/],
    [{type: "uri", uri: `${origin}/`, altUri: {desktop: "https://other.example.invalid/"}}, /其他環境/],
    [{type: "richmenuswitch", richMenuAliasId: "lab-menu"}, /尚未支援/],
    [{type: "uri", uri: "javascript:alert(1)"}, /其他環境/],
    [{type: "uri", uri: "not a URL"}, /無效連結/]
  ];
  for (const [action, expected] of cases) {
    const f = fixture({definitions: new Map([[staffId, menu(staffId, action)]])});
    const data = await f.api.listTenantLineMenus(schoolId);
    assert.equal(data.menus[0].selectable, false); assert.match(data.menus[0].validationError, expected);
    assert.doesNotMatch(JSON.stringify(data), /icy-ocean|javascript|richMenuAliasId/);
    await assert.rejects(f.api.saveTenantLineMenus(schoolId, {parentMenuId: "", staffMenuId: staffId}, "global"), expected);
    assert.equal(f.writes.length, 0);
  }
  const valid = fixture({definitions: new Map([[staffId, menu(staffId, {type: "uri", uri: `${origin}/?line_menu=staff_portal&schoolId=school-a`, altUri: {desktop: `${origin}/?schoolId=school-a`}})]])});
  assert.equal((await valid.api.listTenantLineMenus(schoolId)).menus[0].selectable, true);
  await valid.api.saveTenantLineMenus(schoolId, {parentMenuId: "", staffMenuId: staffId}, "global");
});

test("stale etags and LINE list errors fail safely without assignment or credential disclosure", async () => {
  const conflict = fixture({conflict: true});
  await assert.rejects(conflict.api.saveTenantLineMenus(schoolId, {parentMenuId: "", staffMenuId: staffId}, "global"), /重新載入/);
  assert.equal(conflict.writes.length, 0); assert.equal(conflict.rows.get("school-school-a").staffMenuId, undefined);
  const unavailable = fixture({listFailure: true});
  await assert.rejects(unavailable.api.listTenantLineMenus(schoolId), error => /無法讀取/.test(error.message) && !/private|secret/.test(error.message));
  assert.equal(unavailable.writes.length, 0);
});

test("same-bot verification retains menu selections while official-account changes discard them", async () => {
  const override = {menuBotUserId: botId, menuAppOrigin: origin, parentMenuId: "", staffMenuId: staffId, menuUpdatedBy: "global", menuUpdatedAt: "2026-11-24"};
  const same = fixture({row: override});
  same.env.LINE_SCHOOL_A_CHANNEL_ACCESS_TOKEN = "rotated-token";
  await same.api.saveTenantLineChannel(schoolId, "active", "global");
  assert.equal((await same.api.resolveTenantLineChannel(schoolId)).staffMenuId, staffId);
  assert.equal((await same.api.resolveTenantLineChannel(schoolId)).parentMenuId, "");
  const changed = fixture({row: override, botId: otherBot});
  await changed.api.saveTenantLineChannel(schoolId, "active", "global");
  const row = changed.rows.get("school-school-a");
  assert.equal(row.botUserId, otherBot); assert.equal(row.menuBotUserId, undefined); assert.equal(row.staffMenuId, undefined);
  assert.equal((await changed.api.resolveTenantLineChannel(schoolId)).staffMenuId, otherId);
  const stale = fixture({row: {...override, menuBotUserId: otherBot}});
  assert.equal((await stale.api.resolveTenantLineChannel(schoolId)).staffMenuId, otherId);
});

test("changing the platform origin invalidates persisted menu overrides until they are selected for the current environment", async () => {
  const f = fixture({row: {menuBotUserId: botId, menuAppOrigin: origin, parentMenuId: "", staffMenuId: staffId}});
  assert.equal((await f.api.resolveTenantLineChannel(schoolId)).staffMenuId, staffId);
  f.env.LINE_SCHOOL_A_APP_ORIGIN = "https://new-production.example.invalid";
  assert.equal((await f.api.resolveTenantLineChannel(schoolId)).staffMenuId, otherId);
  await f.api.saveTenantLineChannel(schoolId, "active", "global");
  assert.equal(f.rows.get("school-school-a").menuAppOrigin, origin);
  assert.equal((await f.api.resolveTenantLineChannel(schoolId)).staffMenuId, otherId);
  await f.api.saveTenantLineMenus(schoolId, {parentMenuId: "", staffMenuId: staffId}, "global");
  assert.equal((await f.api.resolveTenantLineChannel(schoolId)).staffMenuId, staffId);
  assert.equal(f.rows.get("school-school-a").menuAppOrigin, "https://new-production.example.invalid");
});

test("Global menu route rejects school admins and malformed requests before listing or saving", async () => {
  const handlers = {}, calls = [];
  const json = (jsonBody, status = 200) => ({status, jsonBody});
  class LineConfigError extends Error {}
  load("api/src/functions/lineTenantManagement.js", {
    app: {http: (name, options) => {handlers[name] = options.handler;}}, json, console,
    getAccess: async request => request.access,
    tenantIdValue: value => String(value).toLowerCase(), getTenantDirectory: async id => id === schoolId ? {} : null,
    listTenantLineMenus: async id => {calls.push(["list", id]); return {schoolId: id, menus: []};},
    saveTenantLineMenus: async (id, selection, actor) => {calls.push(["save", id, selection, actor]); return {schoolId: id, ...selection, menus: []};},
    LineConfigError
  }, ";0");
  const route = handlers.tenantLineChannelMenus;
  const req = (access, method = "GET", body, id = schoolId) => ({access, method, params: {schoolId: id}, json: async () => body});
  const unauthenticated = await route(req({authenticated: false}));
  assert.equal(unauthenticated.status, 401); assert.equal(unauthenticated.headers["Cache-Control"], "no-store");
  assert.equal((await route(req({authenticated: true, capabilities: {schoolAdmin: true}}))).status, 403);
  const global = {authenticated: true, capabilities: {globalAdmin: true}, email: "global@example.invalid"};
  assert.equal((await route(req(global, "GET", null, "SCHOOL-A"))).status, 404);
  assert.equal((await route(req(global, "GET", null, "missing"))).status, 404);
  for (const body of [null, {status: "active"}, {parentMenuId: "", staffMenuId: staffId, accessToken: "never-accept"}]) {
    assert.equal((await route(req(global, "PATCH", body))).status, 400);
  }
  assert.equal(calls.length, 0);
  const listed = await route(req(global));
  assert.equal(listed.status, 200); assert.equal(listed.headers["Cache-Control"], "no-store");
  const saved = await route(req(global, "PATCH", {parentMenuId: "", staffMenuId: staffId}));
  assert.equal(saved.status, 200); assert.equal(saved.headers["Cache-Control"], "no-store");
  assert.deepEqual(calls[1], ["save", schoolId, {parentMenuId: "", staffMenuId: staffId}, global.email]);
});
