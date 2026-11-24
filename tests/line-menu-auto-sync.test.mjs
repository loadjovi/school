import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "");
const schoolId = "school-a", origin = "https://school-a.example.test";
const userId = "U" + "a".repeat(32), botUserId = "U" + "b".repeat(32);

function confirmation(outcome, {reread} = {}) {
  const handlers = {}, effects = [], warnings = [];
  const google = {sub: "verified-sub", email: "verified@example.test"};
  const account = {lineUserId: userId, botUserId, displayName: "本人", parentEmail: "approved@example.test"};
  let current = account, reads = 0, attempts = 0;
  class LineMenuSyncError extends Error {}
  const scope = {
    app: {http: (name, options) => handlers[name] = options.handler},
    json: (data, status = 200) => ({data, status}), URL, URLSearchParams,
    console: {warn: (...args) => warnings.push(args)},
    getTenantContext: async () => ({schoolId, access: {role: "admin"}}),
    resolveTenantLineChannel: async () => ({schoolId, botUserId, appOrigin: origin, loginConfigured: true}),
    verifyGoogle: async () => google, getTenantGoogleLink: async () => null,
    readTenantLineLinkConfirmation: async () => ({rowKey: "pending", googleSub: google.sub, googleEmail: google.email, lineUserId: userId}),
    clearTenantLineLinkConfirmation: () => ({name: "pending", value: ""}),
    getTenantLineAccount: async () => {reads++;return reads > 1 && reread ? reread(current) : current;},
    linkTenantGoogle: async (id, line, identity) => {
      assert.equal(id, schoolId); assert.equal(line, account); assert.equal(identity.sub, google.sub);
      effects.push("linked");current = {...account, googleEmail: identity.email, googleSub: identity.sub}; return current;
    },
    refreshTenantLineMenu: async (channel, linked) => {
      assert.equal(channel.schoolId, schoolId); assert.equal(linked.googleEmail, google.email);
      effects.push("menu");attempts++;if (typeof outcome === "function") return outcome(attempts);if (outcome instanceof Error) throw outcome; return outcome;
    }, LineMenuSyncError
  };
  runInNewContext(source("api/src/functions/tenantLineLogin.js"), scope);
  return {
    effects, warnings, reads: () => reads,
    confirm: () => handlers.tenantLineAccount({method: "POST", headers: new Headers({origin}), json: async () => ({action: "confirm-link", confirmationId: "pending"})})
  };
}

test("confirmed LINE/Gmail pairing automatically applies the existing roster's menu without another action", async () => {
  for (const audience of ["staff", "parent", "default"]) {
    const h = confirmation(audience), result = await h.confirm();
    assert.equal(result.status, 200); assert.equal(result.data.bound, true);
    assert.equal(result.data.googleLinked, true); assert.equal(result.data.menuSync.status, "synced");
    assert.equal(result.data.menuSync.audience, audience); assert.deepEqual(h.effects, ["linked", "menu"]);
  }
});

test("parent binding retries one transient menu failure automatically and returns the validated five-entry result", async () => {
  const h = confirmation(attempt => {
    if (attempt === 1) throw Object.assign(Error("temporary-private-provider-body"), {status: 503});
    return {audience: "parent", areaCount: 5};
  });
  const result = await h.confirm();
  assert.equal(result.data.bound, true); assert.equal(result.data.menuSync.status, "synced");
  assert.equal(result.data.menuSync.audience, "parent"); assert.equal(result.data.menuSync.areaCount, 5);
  assert.equal(h.reads(), 2); assert.deepEqual(h.effects, ["linked", "menu", "menu"]);
  assert.doesNotMatch(JSON.stringify({result, warnings: h.warnings}), /private-provider-body/);
});

test("automatic retry stops when the live LINE/Gmail link changed or the failure is permanent", async () => {
  for (const reread of [account => ({...account, googleSub: "different-user"}), () => null, account => ({...account, botUserId: "other-bot"})]) {
    const h = confirmation(Object.assign(Error("transient"), {status: 503}), {reread}), result = await h.confirm();
    assert.equal(result.data.bound, true); assert.equal(result.data.menuSync.status, "pending");
    assert.deepEqual(h.effects, ["linked", "menu"]); assert.equal(h.reads(), 2);
  }
  const h = confirmation(Object.assign(Error("permanent"), {status: 400})), result = await h.confirm();
  assert.equal(result.data.menuSync.status, "pending"); assert.equal(h.reads(), 1); assert.deepEqual(h.effects, ["linked", "menu"]);
});

test("menu setup and provider failures never undo a successful pairing or request another identity binding", async () => {
  for (const outcome of ["unavailable", new Error("private-provider-body-token")]) {
    const h = confirmation(outcome), result = await h.confirm();
    assert.equal(result.status, 200); assert.equal(result.data.bound, true);
    assert.equal(result.data.menuSync.status, "pending"); assert.match(result.data.menuSync.message, /不需重新綁定/);
    assert.doesNotMatch(JSON.stringify({result, warnings: h.warnings}), /private-provider-body-token/);
    assert.deepEqual(h.effects, ["linked", "menu"]);
  }
});

function staffWebhook({menuFails = false, group = false} = {}) {
  const handlers = {}, effects = [];
  const account = {lineUserId: userId, googleEmail: "former-admin@example.test"};
  const scope = {
    app: {http: (name, options) => handlers[name] = options.handler}, Buffer,
    json: (data, status = 200) => ({data, status}),
    tenantIdValue: value => value,
    resolveTenantLineChannel: async () => ({schoolId, botUserId, configured: true, loginConfigured: true, legacy: false}),
    verifyLineSignature: () => true, parseActivityLineBinding: () => null,
    tenantLineStaffReplyKind: () => "today", getTenantLineAccount: async () => account,
    tenantLineStaffReply: async (_kind, id, linked) => {
      assert.equal(id, schoolId); assert.equal(linked, account); effects.push("authorize"); return "目前無本校管理員權限";
    },
    replyLineMessage: async (_token, text) => {effects.push("reply"); assert.match(text, /權限|一對一聊天室/);},
    refreshTenantLineMenu: async (channel, linked, id) => {
      assert.equal(channel.schoolId, schoolId); assert.equal(linked, account); assert.equal(id, userId);
      effects.push("reconcile"); if (menuFails) throw Error("provider-private-response");
    }, console: {warn: () => effects.push("deferred"), error: () => effects.push("error")}
  };
  runInNewContext(source("api/src/functions/lineWebhook.js"), scope);
  const payload = {destination: botUserId, events: [{type: "message", replyToken: "reply", source: group ? {type: "group"} : {type: "user", userId}, message: {type: "text", text: "#幹部今日課程"}}]};
  return {effects, run: () => handlers.tenantLineWebhook({params: {schoolId}, headers: new Headers(), arrayBuffer: async () => Buffer.from(JSON.stringify(payload))})};
}

test("old staff-menu taps keep the independent authorization denial and then reconcile the current roster", async () => {
  const h = staffWebhook(), result = await h.run();
  assert.equal(result.status, 200); assert.deepEqual(h.effects, ["authorize", "reply", "reconcile"]);
  const unavailable = staffWebhook({menuFails: true}); assert.equal((await unavailable.run()).status, 200);
  assert.deepEqual(unavailable.effects, ["authorize", "reply", "reconcile", "deferred"]);
  const group = staffWebhook({group: true}); assert.equal((await group.run()).status, 200); assert.deepEqual(group.effects, ["reply"]);
});

test("only a missing approved-role template triggers same-channel discovery after the authoritative roster check", async () => {
  const parentId = "richmenu-" + "1".repeat(32), staffId = "richmenu-" + "2".repeat(32);
  for (const audience of ["staff", "parent"]) {
    const discoveries = [], writes = [];
    const sync = runInNewContext(source("api/src/lib/tenantLineMenu.js").replace(/^export /gm, "") + ";refreshTenantLineMenu", {
      listTenantRolesByEmail: async () => audience === "staff" ? [{role: "schoolAdmin", schoolId}] : [],
      getTeacherDirectory: async () => null,
      getMappedStudentsByEmail: async () => [{studentId: "approved-student"}],
      defaultTenantId: () => "sacred-heart",
      discoverTenantLineRoleMenu: async (channel, role) => {
        assert.equal(channel.schoolId, schoolId); assert.equal(role, audience); discoveries.push(role);
        return role === "staff" ? staffId : parentId;
      },
      lineApi: async (path, options) => {
        if (options.method === "GET") return {areas: Array.from({length: path.endsWith(parentId) ? 4 : 6}, () => ({}))};
        writes.push({path, options}); return {};
      }
    });
    const channel = {schoolId, configured: true, accessToken: "this-school-token", parentMenuId: "", staffMenuId: ""};
    const account = {googleEmail: "verified@example.test", parentEmail: "approved@example.test", lineUserId: userId};
    assert.equal(await sync(channel, account), audience); assert.deepEqual(discoveries, [audience]);
    assert.equal(writes[0].path.endsWith(audience === "staff" ? staffId : parentId), true);
    assert.equal(writes[0].options.accessToken, channel.accessToken);
    const configured = {...channel, parentMenuId: parentId, staffMenuId: staffId};
    assert.equal(await sync(configured, account), audience); assert.equal(discoveries.length, 1);
    assert.equal(await sync({...configured, [audience === "staff" ? "staffMenuId" : "parentMenuId"]: "invalid"}, account), "unavailable");
    assert.equal(discoveries.length, 1); assert.equal(writes.length, 2);
  }
});
