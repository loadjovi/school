import test from "node:test";
import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const strip = value => value.replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const origin = "https://school-a.example.test";
const botId = "U" + "a".repeat(32), userId = "U" + "b".repeat(32), otherUserId = "U" + "c".repeat(32);
const google = {sub: "current-google-sub", email: "parent@example.test"};
const missing = statusCode => Object.assign(new Error(), {statusCode});

function identityStore() {
  const rows = new Map(), reads = [], writes = [];
  let version = 0;
  const key = (partition, row) => partition + "|" + row;
  const db = {
    createTable: async () => {},
    createEntity: async row => {
      if (rows.has(key(row.partitionKey, row.rowKey))) throw missing(409);
      rows.set(key(row.partitionKey, row.rowKey), {...row, etag: String(++version)});
      writes.push({kind: "create", row: {...row}});
    },
    getEntity: async (partition, row) => {
      reads.push({partition, row});
      const value = rows.get(key(partition, row));
      if (!value) throw missing(404);
      return {...value};
    },
    updateEntity: async (row, _mode, options = {}) => {
      const old = rows.get(key(row.partitionKey, row.rowKey));
      if (!old) throw missing(404);
      if (options.etag && old.etag !== options.etag) throw missing(412);
      rows.set(key(row.partitionKey, row.rowKey), {...old, ...row, etag: String(++version)});
      writes.push({kind: "update", row: {...row}});
    },
    deleteEntity: async (partition, row, options = {}) => {
      const old = rows.get(key(partition, row));
      if (!old) throw missing(404);
      if (options.etag && old.etag !== options.etag) throw missing(412);
      rows.delete(key(partition, row));
      writes.push({kind: "delete", row: {partitionKey: partition, rowKey: row}});
    }
  };
  const api = runInNewContext(strip(read("api/src/lib/tenantLineAccounts.js")) +
    ";({createTenantLineOAuth,useTenantLineOAuth,lineCookie,recordTenantLineFriendship,getTenantLineFriendship})", {
    createHash, randomBytes, randomUUID, process: {env: {STORAGE_CONNECTION_STRING: "test"}},
    TableClient: {fromConnectionString: () => db}, tenantSchoolPartition: value => value
  });
  return {...api, rows, reads, writes};
}

function harness({provider = "google", role = "parent", identity = google} = {}) {
  const handlers = {}, store = identityStore(), transactions = [], mutations = [], lookups = [], requests = [];
  const account = {partitionKey: "school-a", botUserId: botId, lineUserId: userId, parentEmail: google.email,
    googleSub: google.sub, googleEmail: google.email, displayName: "已綁定家長"};
  const state = {contextSchool: "school-a", role, provider, identity, account, link: {...account},
    session: {schoolId: "school-a", account}, lineSub: userId, friendFlag: true, friendHttp: 200,
    tokenHttp: 200, accessToken: "short-lived-line-user-token", statusUnavailable: false};
  const channel = {schoolId: "school-a", appOrigin: origin, loginConfigured: true, loginId: "1234567890",
    loginSecret: "channel-secret", botUserId: botId, oauthVersion: "v1"};
  let googleVerifications = 0;
  const mutation = name => async () => {mutations.push(name); throw new Error("Unexpected identity mutation: " + name);};
  class LineAccountConflict extends Error {}
  class LineMenuSyncError extends Error {}
  runInNewContext(strip(read("api/src/functions/tenantLineLogin.js")), {
    app: {http: (name, options) => handlers[name] = options.handler}, createHash, URL, URLSearchParams, AbortSignal,
    console: {warn() {}, error() {}}, json: (data, status = 200) => ({data, status}), tenantIdValue: value => value,
    resolveTenantLineChannel: async () => channel,
    getTenantContext: async () => ({schoolId: state.contextSchool, access: {role: state.role, authProvider: state.provider}}),
    verifyGoogle: async () => {googleVerifications++; return state.identity;},
    tenantLineSession: async () => state.session,
    getTenantGoogleLink: async (...args) => {lookups.push({kind: "google", args}); return state.link;},
    getTenantLineAccount: async (...args) => {lookups.push({kind: "line", args}); return state.account;},
    getTenantLineFriendship: async (...args) => {
      lookups.push({kind: "friend", args});
      if (state.statusUnavailable) throw new Error("Storage unavailable");
      return store.getTenantLineFriendship(...args);
    },
    createTenantLineOAuth: async (...args) => {
      const created = await store.createTenantLineOAuth(...args);
      transactions.push({args, created}); return created;
    },
    useTenantLineOAuth: store.useTenantLineOAuth, lineCookie: store.lineCookie,
    recordTenantLineFriendship: store.recordTenantLineFriendship,
    clearOAuthCookie: () => ({name: "__Host-school-line-oauth", value: ""}),
    clearTenantLineLinkConfirmation: () => ({name: "__Host-school-line-link", value: ""}),
    readTenantLineLinkConfirmation: async () => null,
    restoreLabGoogleLineLink: async (_school, _channel, _identity, link) => link,
    getOrCreateTenantLineAccount: mutation("create-account"), linkTenantGoogle: mutation("link-google"),
    createTenantLineLinkConfirmation: mutation("pending-link"), createTenantLineSession: mutation("create-session"),
    clearTenantLineSession: mutation("clear-session"), unlinkTenantGoogle: mutation("unlink-google"),
    refreshTenantLineMenu: mutation("menu"), LineAccountConflict, LineMenuSyncError,
    fetch: async (url, options) => {
      requests.push({url: String(url), options});
      if (String(url).endsWith("/friendship/v1/status")) {
        if (state.friendFailure) throw new Error("Friendship API unavailable");
        if (state.friendshipHook) await state.friendshipHook();
        return {ok: state.friendHttp === 200, status: state.friendHttp, json: async () => ({friendFlag: state.friendFlag})};
      }
      if (String(url).endsWith("/token")) return {ok: state.tokenHttp === 200, status: state.tokenHttp,
        json: async () => state.tokenHttp === 200 ? {id_token: "verified-id-token", access_token: state.accessToken} : {error: "invalid_client"}};
      return {ok: true, status: 200, json: async () => ({iss: "https://access.line.me", aud: channel.loginId,
        nonce: transactions.at(-1).created.nonce, sub: state.lineSub, name: "本次登入 LINE"})};
    }
  });
  const start = (input = {mode: "friendship"}, {schoolId = "school-a", headers = {}} = {}) =>
    handlers.tenantLineLoginStart({params: {schoolId}, headers: new Headers({origin, ...headers}), json: async () => input});
  const callback = (started, {schoolId = "school-a", cookie = true, code = "valid-code", extra = {}} = {}) => {
    const query = new URLSearchParams({state: new URL(started.data.url).searchParams.get("state"), ...extra});
    if (code !== null) query.set("code", code);
    const savedCookie = started.cookies.find(item => item.name === "__Host-school-line-oauth");
    return handlers.tenantLineLoginCallback({params: {schoolId}, query,
      headers: new Headers(cookie ? {cookie: savedCookie.name + "=" + savedCookie.value} : {})});
  };
  const get = (headers = {}, query = {}) => handlers.tenantLineAccount({method: "GET", headers: new Headers(headers), query: new URLSearchParams(query)});
  return {start, callback, get, state, store, channel, transactions, mutations, lookups, requests,
    googleVerifications: () => googleVerifications};
}

function assertNoIdentityMutation(h, result) {
  assert.deepEqual(h.mutations, []);
  assert.equal(result.cookies.some(cookie => ["__Host-school-line-session", "orchestra_google_id_token", "__Host-school-line-link"].includes(cookie.name)), false);
  assert.equal(h.store.writes.some(write => !write.row.partitionKey.startsWith("oauth-") && !write.row.rowKey.startsWith("friend-")), false);
}

test("friendship start derives the existing same-school LINE identity and ignores client target IDs", async () => {
  for (const provider of ["google", "line"]) {
    const h = harness({provider}), result = await h.start({mode: "friendship", expectedLineUserId: otherUserId,
      expectedParentEmail: "someone-else@example.test", googleSub: "untrusted-sub"});
    assert.equal(result.status, 200);
    const stored = [...h.store.rows.values()][0];
    assert.equal(stored.purpose, "friendship"); assert.equal(stored.expectedLineUserId, userId);
    assert.equal(stored.expectedParentEmail, google.email); assert.equal(stored.expectedGoogleSub, google.sub);
    assert.equal(stored.friendshipInitiator, provider);
    assert.equal(stored.googleSub, provider === "google" ? google.sub : "");
    assert.equal(new URL(result.data.url).searchParams.get("bot_prompt"), "aggressive");
    assert.equal(result.cookies.some(cookie => cookie.name === "__Host-school-line-link"), false);
    assert.doesNotMatch(JSON.stringify({url: result.data.url, row: stored}), /short-lived-line-user-token|someone-else|untrusted-sub/);
    assert.deepEqual(h.mutations, []);
  }
  for (const mode of ["login", "link"]) {
    const h = harness(), result = await h.start({mode});
    assert.equal(new URL(result.data.url).searchParams.get("bot_prompt"), "aggressive");
    assert.equal([...h.store.rows.values()][0].purpose, undefined);
  }
});

test("friendship start requires same origin, authorized school access and a current binding", async () => {
  for (const provider of ["google", "line"]) {
    for (const [change, options, expected] of [
      [() => {}, {headers: {origin: "https://other.example.test"}}, 403],
      [state => state.contextSchool = "school-b", {}, 403],
      [state => state.role = "global", {}, 403],
      [state => state.account = {...state.account, botUserId: otherUserId}, {}, 409],
      [state => state.account = {...state.account, partitionKey: "school-b"}, {}, 409],
      [state => state.account = null, {}, 409]
    ]) {
      const h = harness({provider}); change(h.state);
      if (provider === "line") h.state.session = {schoolId: "school-a", account: h.state.account};
      assert.equal((await h.start({mode: "friendship"}, options)).status, expected);
      assert.equal(h.transactions.length, 0); assert.deepEqual(h.mutations, []);
    }
  }
  for (const change of [state => state.identity = null, state => state.link = null,
    state => state.link = {...state.link, googleSub: "other-sub"},
    state => state.account = {...state.account, googleEmail: "changed@example.test"}]) {
    const h = harness(); change(h.state); const result = await h.start();
    assert.ok([401, 409].includes(result.status)); assert.equal(h.transactions.length, 0);
  }
  for (const session of [null, {schoolId: "school-b", account: {}}]) {
    const h = harness({provider: "line"}); h.state.session = session;
    assert.equal((await h.start()).status, 401); assert.equal(h.transactions.length, 0);
  }
});

test("LINE-origin checks retain the LINE session and never use a residual Google cookie or Google return marker", async () => {
  for (const [provider, role, returnTo, headers] of [
    ["line", "parent", "parent-account", {}],
    ["line", "teacher", "teacher-account", {}],
    ["line", "admin", "notification-center", {}],
    ["google", "parent", "parent-account", {"x-google-id-token": "line-session"}]
  ]) {
    const h = harness({provider, role}), started = await h.start({mode: "friendship", returnTo},
      {headers: {cookie: "orchestra_google_id_token=residual-google-credential", ...headers}});
    assert.equal(started.status, 200); assert.equal(h.googleVerifications(), 0);
    assert.equal([...h.store.rows.values()][0].returnTo, undefined);
    const result = await h.callback(started, {extra: {returnTo: "parent-account", parentLineAccount: "school-b"}});
    const url = new URL(result.headers.Location);
    assert.equal(url.pathname, "/line-account.html"); assert.equal(url.searchParams.get("schoolId"), "school-a");
    assert.equal(url.searchParams.get("line_friend"), "checked");
    assert.equal([...url.searchParams.keys()].some(key => /LineAccount|line_session/.test(key)), false);
    assertNoIdentityMutation(h, result);
  }
});

test("Google-origin checks preserve fixed role destinations and the exact verified credential across new tabs", async () => {
  const credential = "verified-google-credential", authSessionId = createHash("sha256").update(credential).digest("hex");
  for (const [role, returnTo, marker] of [["admin", "notification-center", "adminLineAccount"],
    ["teacher", "teacher-account", "teacherLineAccount"], ["parent", "parent-account", "parentLineAccount"], ["admin", undefined, undefined]]) {
    const h = harness({role, identity: {...google, authSessionId}});
    const started = await h.start({mode: "friendship", ...(returnTo ? {returnTo} : {})}, {headers: {"x-google-id-token": credential}});
    assert.equal(started.status, 200);
    const cookie = started.cookies.find(value => value.name === "orchestra_google_id_token");
    assert.equal(cookie?.value, credential); assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true);
    assert.doesNotMatch(JSON.stringify([...h.store.rows.values()]), new RegExp(credential));
    const result = await h.callback(started), url = new URL(result.headers.Location);
    assert.equal(url.pathname, marker ? "/" : "/line-account.html");
    if (marker) assert.equal(url.searchParams.get(marker), "school-a");
    assert.equal(url.searchParams.get("line_friend"), "checked"); assertNoIdentityMutation(h, result);
  }
  for (const candidate of ["unverified-header-token", "cookie-session", "line-session", ""]) {
    const h = harness({role: "admin", identity: {...google, authSessionId}});
    const started = await h.start({mode: "friendship"}, {headers: {"x-google-id-token": candidate}});
    assert.equal(started.cookies.some(cookie => cookie.name === "orchestra_google_id_token"), false);
  }
});

test("same LINE account checks update only a verified boolean friendship result with a short-lived user token", async () => {
  for (const provider of ["google", "line"]) for (const friendFlag of [true, false]) {
    const h = harness({provider}); h.state.friendFlag = friendFlag;
    const started = await h.start(), result = await h.callback(started);
    assert.equal(new URL(result.headers.Location).searchParams.get("line_friend"), "checked");
    const friendship = await h.store.getTenantLineFriendship("school-a", botId, userId);
    assert.equal(friendship.status, friendFlag ? "friend" : "not_friend");
    assert.equal(typeof friendship.checkedAt, "number");
    const request = h.requests.find(item => item.url.endsWith("/friendship/v1/status"));
    assert.equal(request.options.headers.Authorization, "Bearer short-lived-line-user-token");
    assert.equal(h.requests.length, 3); assert.equal(h.store.rows.size, 1);
    assert.doesNotMatch(JSON.stringify([...h.store.rows.values()]), /short-lived-line-user-token|verified-id-token|valid-code/);
    assertNoIdentityMutation(h, result);
  }
});

test("a different LINE account, changed binding or cross-school record cannot update the original friendship", async () => {
  for (const provider of ["google", "line"]) {
    for (const change of [state => state.lineSub = otherUserId, state => state.account = null,
      state => state.account = {...state.account, parentEmail: "reassigned@example.test"},
      state => state.account = {...state.account, googleSub: "new-google-sub"},
      state => state.account = {...state.account, partitionKey: "school-b"},
      state => state.account = {...state.account, botUserId: otherUserId}]) {
      const h = harness({provider}); await h.store.recordTenantLineFriendship("school-a", botId, userId, true, 100);
      const started = await h.start(); change(h.state); const result = await h.callback(started);
      assert.equal(new URL(result.headers.Location).searchParams.get("line_friend"), "mismatch");
      assert.equal(h.requests.some(item => item.url.endsWith("/friendship/v1/status")), false);
      assert.equal((await h.store.getTenantLineFriendship("school-a", botId, userId)).checkedAt, 100);
      assertNoIdentityMutation(h, result);
    }
  }
  for (const change of [state => state.link = null, state => state.link = {...state.link, lineUserId: otherUserId},
    state => state.link = {...state.link, googleEmail: "changed@example.test"}]) {
    const h = harness(), started = await h.start(); change(h.state); const result = await h.callback(started);
    assert.equal(new URL(result.headers.Location).searchParams.get("line_friend"), "mismatch");
    assertNoIdentityMutation(h, result);
  }
});

test("friendship failures and malformed flags preserve the previous status and checked time", async () => {
  for (const provider of ["google", "line"]) for (const change of [
    state => state.friendHttp = 401, state => state.friendFailure = true, state => state.accessToken = "",
    state => state.friendFlag = "false", state => state.friendFlag = undefined, state => state.friendFlag = null,
    state => state.tokenHttp = 401
  ]) {
    const h = harness({provider}); await h.store.recordTenantLineFriendship("school-a", botId, userId, true, 100);
    const started = await h.start(); change(h.state); const result = await h.callback(started);
    assert.equal(new URL(result.headers.Location).searchParams.get("line_friend"), "unavailable");
    assert.equal(JSON.stringify(await h.store.getTenantLineFriendship("school-a", botId, userId)), JSON.stringify({status: "friend", checkedAt: 100}));
    assertNoIdentityMutation(h, result);
  }
});

test("a newer webhook result during the OAuth friendship request remains authoritative", async () => {
  for (const provider of ["google", "line"]) {
    const h = harness({provider}), webhookTime = Date.now() + 5000;
    h.state.friendFlag = true;
    h.state.friendshipHook = () => h.store.recordTenantLineFriendship("school-a", botId, userId, false, webhookTime);
    const started = await h.start(), result = await h.callback(started);
    assert.equal(new URL(result.headers.Location).searchParams.get("line_friend"), "checked");
    const friendship = await h.store.getTenantLineFriendship("school-a", botId, userId);
    assert.equal(friendship.status, "not_friend"); assert.equal(friendship.checkedAt, webhookTime);
    assertNoIdentityMutation(h, result);
  }
});

test("cancelled friendship authorization returns to the server-stored destination without changing an account", async () => {
  for (const provider of ["google", "line"]) {
    const h = harness({provider}), started = await h.start({mode: "friendship", returnTo: "parent-account"});
    const result = await h.callback(started, {code: null, extra: {error: "access_denied", returnTo: "https://evil.example.test"}});
    const url = new URL(result.headers.Location);
    assert.equal(url.origin, origin); assert.equal(url.searchParams.get("line_friend"), "unavailable");
    assert.equal(url.pathname, provider === "google" ? "/" : "/line-account.html");
    assert.equal(url.searchParams.has("parentLineAccount"), provider === "google");
    assert.equal(h.requests.length, 0); assertNoIdentityMutation(h, result);
  }
});

test("friendship OAuth is one-use and rejects missing cookies, stale config, expired and cross-school transactions", async () => {
  for (const provider of ["google", "line"]) for (const kind of ["cookie", "config", "expiry", "school", "legacy", "replay"]) {
    const h = harness({provider}), started = await h.start();
    const options = {extra: {line_friend: "checked", expectedLineUserId: userId}};
    if (kind === "cookie") options.cookie = false;
    if (kind === "school") options.schoolId = "school-b";
    if (kind === "config") h.channel.oauthVersion = "changed-version";
    if (kind === "expiry") [...h.store.rows.values()][0].expires = Date.now() - 1;
    if (kind === "legacy") {delete [...h.store.rows.values()][0].expectedLineUserId; delete [...h.store.rows.values()][0].friendshipInitiator;}
    if (kind === "replay") {
      await h.callback(started);
      h.requests.length = 0;
    }
    const before = JSON.stringify([...h.store.rows.values()].filter(row => row.rowKey.startsWith("friend-")));
    const result = await h.callback(started, options), url = new URL(result.headers.Location);
    assert.ok(url.searchParams.get("line_error") === "authorization" || url.searchParams.get("line_friend") === "mismatch");
    assert.equal(h.requests.some(item => item.url.endsWith("/friendship/v1/status")), false);
    assert.equal(JSON.stringify([...h.store.rows.values()].filter(row => row.rowKey.startsWith("friend-"))), before);
    assertNoIdentityMutation(h, result);
  }
});

test("own account GET exposes the stored friend state without accepting another user or school", async () => {
  for (const provider of ["google", "line"]) {
    const h = harness({provider}); await h.store.recordTenantLineFriendship("school-a", botId, userId, true, 100);
    await h.store.recordTenantLineFriendship("school-a", botId, otherUserId, false, 200);
    const response = await h.get({}, {schoolId: "school-b", userId: otherUserId});
    assert.equal(response.status, 200); assert.equal(response.data.bound, true);
    assert.equal(response.data.friendStatus, "friend"); assert.equal(response.data.friendCheckedAt, 100);
    assert.equal(response.data.authProvider, provider);
    assert.deepEqual(h.lookups.filter(value => value.kind === "friend").map(value => value.args), [["school-a", botId, userId]]);
    assert.doesNotMatch(JSON.stringify(response.data), new RegExp(userId + "|" + otherUserId));
    assert.equal(h.requests.length, 0); assert.deepEqual(h.mutations, []);
    if (provider === "line") assert.equal(h.googleVerifications(), 0);
    h.state.statusUnavailable = true;
    const unavailable = await h.get(); assert.equal(unavailable.data.friendStatus, "unknown"); assert.equal(unavailable.data.friendCheckedAt, null);
  }
});

test("friendship point lookup reads one scoped row, never lists or writes, and preserves latest webhook evidence", async () => {
  const store = identityStore();
  await store.recordTenantLineFriendship("school-a", botId, userId, true, 200);
  await store.recordTenantLineFriendship("school-a", botId, userId, false, 100);
  const writes = store.writes.length;
  store.reads.length = 0;
  assert.equal((await store.getTenantLineFriendship("school-a", botId, userId)).status, "friend");
  assert.equal(store.reads.length, 1); assert.equal(store.writes.length, writes);
  for (const args of [["school-b", botId, userId], ["school-a", otherUserId, userId], ["school-a", botId, otherUserId], ["school-a", botId, "invalid-user"]]) {
    assert.equal((await store.getTenantLineFriendship(...args)).status, "unknown");
  }
  await store.recordTenantLineFriendship("school-a", botId, userId, false, 300);
  assert.equal((await store.getTenantLineFriendship("school-a", botId, userId)).status, "not_friend");
  assert.equal((await store.getTenantLineFriendship("school-a", botId, userId)).checkedAt, 300);
});
