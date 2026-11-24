import test from "node:test";
import assert from "node:assert/strict";
import {applyTenantLineMenus, LineMenuApplyError} from "../api/src/lib/lineMenuApply.js";
import {buildLineMenuTemplate, inspectLineMenuAsset, normalizeLineFacebookUrl} from "../api/src/lib/lineMenuTemplates.js";

const schoolId = "school-a", botUserId = "U" + "a".repeat(32), appOrigin = "https://school-a.example.test";
const facebookUrl = "https://www.facebook.com/profile.php?id=100075610947066";
const jpeg = () => Buffer.from([255, 216, 255, 192, 0, 17, 8, 4, 0, 6, 0, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const configRow = {partitionKey: "line", rowKey: "school-" + schoolId, status: "active", botUserId, etag: "v1", parentMenuId: "old-parent", staffMenuId: "old-staff"};
  const rows = new Map([[configRow.rowKey, {...configRow}]]), menus = new Map(), contents = new Map(), calls = [], writes = [];
  let version = 1, sequence = 0, uploads = 0, ambiguous = options.ambiguous, loseCreateResponse = options.loseFirstCreateResponse;
  const channel = {schoolId, botUserId, appOrigin, accessToken: "school-private-token", configured: true};
  const client = {
    async getEntity(_partition, key) {if (!rows.has(key)) throw Object.assign(Error("missing"), {statusCode: 404});return {...rows.get(key)};},
    async createEntity(row) {if (rows.has(row.rowKey)) throw Object.assign(Error("exists"), {statusCode: 409});rows.set(row.rowKey, {...row, etag: "v" + ++version});writes.push({kind: "create", row});},
    async updateEntity(row, mode, condition) {
      const old = rows.get(row.rowKey);
      if (options.takeoverBeforeCommit && row.rowKey === configRow.rowKey) {
        rows.set("menu-apply-" + schoolId, {partitionKey: "line", rowKey: "menu-apply-" + schoolId, operationId: "next-operation", etag: "next-lease", leaseExpiresAt: "2026-11-24T09:00:00Z"});
        throw Object.assign(Error("changed"), {statusCode: 412});
      }
      if (!old || old.etag !== condition.etag || options.conflict && row.rowKey === configRow.rowKey) throw Object.assign(Error("changed"), {statusCode: 412});
      rows.set(row.rowKey, {...(mode === "Merge" ? old : {}), ...row, etag: "v" + ++version});writes.push({kind: "update", row, mode, condition});
      if (ambiguous && row.rowKey === configRow.rowKey) {ambiguous = false;throw Error("private-network-body");}
    },
    async deleteEntity(_partition, key, condition) {
      if (rows.get(key)?.etag !== condition.etag) throw Object.assign(Error("changed"), {statusCode: 412});rows.delete(key);writes.push({kind: "delete", key});
    }
  };
  const dependencies = {
    now: () => Date.parse("2026-11-24T08:00:00Z"), uuid: () => "operation-id",
    readAsset: async () => options.invalidAsset ? Buffer.from("invalid") : jpeg(),
    lineRequest: async (path, request) => {
      calls.push({path, ...request});assert.equal(request.accessToken, channel.accessToken);
      if (path === "/v2/bot/richmenu/list") return {richmenus: [...menus.values()]};
      if (path === "/v2/bot/richmenu") {
        const richMenuId = "richmenu-" + (++sequence).toString(16).padStart(32, "0");menus.set(richMenuId, {...clone(request.body), richMenuId});
        if (loseCreateResponse) {loseCreateResponse = false;throw Error("private-lost-create-response");}
        return {richMenuId};
      }
      const richMenuId = path.split("/").at(-1);
      if (request.method === "DELETE") {menus.delete(richMenuId);contents.delete(richMenuId);return {};}
      if (request.method === "GET") return menus.get(richMenuId);
      throw Error("Unexpected LINE action");
    },
    fetchImpl: async (url, request) => {
      assert.match(url, /^https:\/\/api-data\.line\.me\/v2\/bot\/richmenu\/richmenu-[0-9a-f]{32}\/content$/);
      assert.equal(request.headers.Authorization, "Bearer " + channel.accessToken);
      const richMenuId = url.split("/").at(-2);
      if (request.method === "POST") {
        uploads++;assert.equal(request.headers["Content-Type"], "image/jpeg");
        if (options.failSecondUpload && uploads === 2) return {ok: false};
        contents.set(richMenuId, Buffer.from(request.body));return {ok: true};
      }
      return {ok: contents.has(richMenuId), status: contents.has(richMenuId) ? 200 : 404, arrayBuffer: async () => contents.get(richMenuId)};
    }
  };
  const input = () => ({schoolId, facebookUrl, actor: "global@example.test", channel, configRow: {...rows.get(configRow.rowKey)}, configClient: client});
  return {rows, menus, contents, calls, writes, channel, configRow, dependencies, run: () => applyTenantLineMenus(input(), dependencies)};
}

test("template assets use actual JPEG dimensions and create the intended five/six semantic areas", () => {
  const asset = inspectLineMenuAsset(jpeg());assert.equal(asset.width, 1536);assert.equal(asset.height, 1024);assert.equal(asset.contentType, "image/jpeg");
  const channel = {schoolId, botUserId, appOrigin};
  const parent = buildLineMenuTemplate(channel, "parent", asset, facebookUrl), staff = buildLineMenuTemplate(channel, "staff", asset, facebookUrl);
  assert.equal(parent.areas.length, 5);assert.deepEqual(parent.areas.slice(0, 3).map(area => area.action.text), ["今日課程", "最新公告", "活動行事曆"]);
  assert.equal(parent.areas[3].action.label, "開啟家長平台");assert.equal(staff.areas.length, 6);assert.equal(staff.areas[5].action.label, "活動影音");
  assert.equal(new URL(parent.areas[4].action.uri).pathname, "/api/line/facebook/school-a");
  assert.equal(new URL(staff.areas[5].action.uri).origin, appOrigin);assert.equal(JSON.stringify(staff).includes("staff_portal"), false);
  assert.notEqual(parent.name, buildLineMenuTemplate({...channel, schoolId: "school-b"}, "parent", asset, facebookUrl).name);
  for (const url of ["http://www.facebook.com/test", "https://facebook.com.evil.test/", "https://evil.test/", "https://user:secret@www.facebook.com/", "https://www.facebook.com/l.php?u=https://evil.test", "https://www.facebook.com/?next=https://evil.test"]) assert.equal(normalizeLineFacebookUrl(url), "");
});

test("Global apply creates/uploads both menus before one conditional nonsecret configuration update", async () => {
  const h = fixture(), result = await h.run();
  assert.equal(result.applied, true);assert.equal(result.templateVersion, "facebook-v1");assert.equal(h.menus.size, 2);assert.equal(h.contents.size, 2);
  const update = h.writes.find(write => write.kind === "update" && write.row.rowKey === h.configRow.rowKey);
  assert.equal(update.condition.etag, "v1");assert.equal(update.mode, "Merge");assert.equal(update.row.facebookUrl, facebookUrl);
  assert.equal(update.row.menuBotUserId, botUserId);assert.equal(update.row.menuAppOrigin, appOrigin);assert.equal(update.row.menuApplyOperationId, "operation-id");
  assert.doesNotMatch(JSON.stringify(update), /school-private-token/);assert.equal(h.rows.has("menu-apply-" + schoolId), false);
  assert.equal(h.calls.some(call => /\/user\//.test(call.path) || /\/user\/all/.test(call.path)), false);
});

test("repeat apply reuses exact versioned definitions and image hashes without creating more LINE menus", async () => {
  const h = fixture();await h.run();const before = h.calls.filter(call => call.path === "/v2/bot/richmenu").length;
  const result = await h.run();assert.equal(h.menus.size, 2);assert.equal(h.calls.filter(call => call.path === "/v2/bot/richmenu").length, before);
  assert.deepEqual(result.reused, {parent: true, staff: true});
});

test("retry recovers an exact versioned menu left without an image after an unknown create response", async () => {
  const h = fixture({loseFirstCreateResponse: true});
  await assert.rejects(h.run(), error => error instanceof LineMenuApplyError && !/private-lost-create-response/.test(error.message));
  assert.equal(h.menus.size, 1);assert.equal(h.contents.size, 0);assert.equal(h.rows.get(h.configRow.rowKey).parentMenuId, "old-parent");
  const incompleteId = [...h.menus.keys()][0], before = h.calls.filter(call => call.path === "/v2/bot/richmenu").length;
  const result = await h.run();assert.equal(result.parentMenuId, incompleteId);assert.equal(result.reused.parent, true);
  assert.equal(h.contents.has(incompleteId), true);assert.equal(h.menus.size, 2);
  assert.equal(h.calls.filter(call => call.path === "/v2/bot/richmenu").length, before + 1);
  assert.equal(h.calls.some(call => call.method === "DELETE" && call.path.endsWith(incompleteId)), false);
});

test("an existing different image is never replaced and excessive matching versions remain bounded", async () => {
  const mismatch = fixture();await mismatch.run();const id = mismatch.rows.get(mismatch.configRow.rowKey).parentMenuId;
  mismatch.contents.set(id, Buffer.from("different-existing-image"));
  await assert.rejects(mismatch.run(), /圖片不一致/);assert.equal(mismatch.contents.get(id).toString(), "different-existing-image");
  const duplicate = fixture();await duplicate.run();const parent = clone(duplicate.menus.get(duplicate.rows.get(duplicate.configRow.rowKey).parentMenuId));
  for (let i = 10; i < 14; i++) {const richMenuId = "richmenu-" + i.toString(16).padStart(32, "0");duplicate.menus.set(richMenuId, {...parent, richMenuId});}
  await assert.rejects(duplicate.run(), /重複過多/);assert.equal(duplicate.menus.size, 6);
});

test("an image upload failure removes only this operation's new menus and preserves previous school settings", async () => {
  const h = fixture({failSecondUpload: true});await assert.rejects(h.run(), LineMenuApplyError);
  assert.equal(h.menus.size, 0);assert.equal(h.rows.get(h.configRow.rowKey).parentMenuId, "old-parent");
  assert.equal(h.calls.filter(call => call.method === "DELETE").length, 2);assert.equal(h.rows.has("menu-apply-" + schoolId), false);
});

test("conditional configuration races roll back new assets while a lost successful commit response remains safe", async () => {
  const conflict = fixture({conflict: true});await assert.rejects(conflict.run(), /設定已變更/);assert.equal(conflict.menus.size, 0);
  const committed = fixture({ambiguous: true}), result = await committed.run();assert.equal(result.applied, true);assert.equal(committed.menus.size, 2);
  assert.equal(committed.calls.some(call => call.method === "DELETE"), false);
});

test("a superseded lease never deletes new assets that the next apply may already be reusing", async () => {
  const h = fixture({takeoverBeforeCommit: true});
  await assert.rejects(h.run(), /設定已變更/);
  assert.equal(h.menus.size, 2);assert.equal(h.contents.size, 2);
  assert.equal(h.calls.some(call => call.method === "DELETE"), false);
  assert.equal(h.rows.get(h.configRow.rowKey).parentMenuId, "old-parent");
  assert.equal(h.rows.get(h.configRow.rowKey).staffMenuId, "old-staff");
  assert.equal(h.rows.get("menu-apply-" + schoolId).operationId, "next-operation");
});

test("active leases block duplicate apply and expired leases are conditionally recovered", async () => {
  for (const expired of [false, true]) {
    const h = fixture();h.rows.set("menu-apply-" + schoolId, {partitionKey: "line", rowKey: "menu-apply-" + schoolId, operationId: "other-operation", etag: "lease-v1", leaseExpiresAt: expired ? "2026-11-24T07:00:00Z" : "2026-11-24T09:00:00Z"});
    if (expired) {assert.equal((await h.run()).applied, true);assert.ok(h.writes.some(write => write.mode === "Replace" && write.condition.etag === "lease-v1"));}
    else {await assert.rejects(h.run(), /正在套用/);assert.equal(h.calls.length, 0);assert.equal(h.rows.get("menu-apply-" + schoolId).operationId, "other-operation");}
  }
});

test("invalid or oversized assets and unrelated school context fail before any LINE or lease mutation", async () => {
  const invalid = fixture({invalidAsset: true});await assert.rejects(invalid.run(), /圖片/);assert.equal(invalid.calls.length, 0);assert.equal(invalid.writes.length, 0);
  const foreign = fixture();foreign.channel.schoolId = "school-b";await assert.rejects(foreign.run(), /此校/);assert.equal(foreign.calls.length, 0);assert.equal(foreign.writes.length, 0);
  assert.throws(() => inspectLineMenuAsset(Buffer.alloc(1024 * 1024 + 1)), /1 MB/);
});
