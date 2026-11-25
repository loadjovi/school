import test from "node:test";
import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {teacherCourseAccess} from "../api/src/lib/teacherAccountType.js";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const schoolId = "school-a", origin = "https://school-a.example.test";
const botId = "U" + "a".repeat(32), userId = "U" + "b".repeat(32), otherId = "U" + "c".repeat(32);
const google = {sub: "confirmed-teacher-sub", email: "teacher@example.test"};
const error = statusCode => Object.assign(Error(), {statusCode});

function memoryStore() {
  const rows = new Map(), key = (partition, id) => JSON.stringify([partition, id]); let revision = 0;
  function apply(target, kind, row, options = {}) {
    const id = key(row.partitionKey, row.rowKey), current = target.get(id);
    if (kind === "create" && current) throw error(409);
    if (kind !== "create" && !current) throw error(404);
    if (options.etag && current.etag !== options.etag) throw error(412);
    if (kind === "delete") target.delete(id);
    else target.set(id, {...row, etag: String(++revision)});
  }
  const db = {createTable: async () => {},
    getEntity: async (partition, id) => {const row = rows.get(key(partition, id)); if (!row) throw error(404); return {...row};},
    createEntity: async row => apply(rows, "create", row),
    updateEntity: async (row, mode, options) => apply(rows, "update", mode === "Replace" ? row : {...rows.get(key(row.partitionKey, row.rowKey)), ...row}, options),
    deleteEntity: async (partitionKey, rowKey, options) => apply(rows, "delete", {partitionKey, rowKey}, options),
    submitTransaction: async actions => {const draft = new Map(rows); for (const [kind, row, _mode, options] of actions) apply(draft, kind, row, options); rows.clear(); for (const [id, row] of draft) rows.set(id, row);}
  };
  return {rows, db, key};
}

async function fixture({paired = true} = {}) {
  const memory = memoryStore(), requests = [], menuCalls = [], teacherReads = [], handlers = {};
  let googleVerifications = 0, oauthNonce = "";
  const channel = {schoolId, configured: true, loginConfigured: true, botUserId: botId, appOrigin: origin,
    loginId: "1234567890", loginSecret: "same-school-secret", accessToken: "same-school-messaging-token",
    oauthVersion: "current-version", staffMenuId: "richmenu-" + "d".repeat(32)};
  const state = {directory: {schoolId, status: "active", teacherName: "正式名冊老師"}, lineSub: userId,
    tenant: {rowKey: schoolId, status: "active", schoolName: "本校"}, profile: {ensembleGroups: '["A"]'}};
  const common = {createHash, randomBytes, randomUUID, process: {env: {STORAGE_CONNECTION_STRING: "memory", GOOGLE_CLIENT_ID: "configured-google-audience"}},
    console: {warn() {}, error() {}}, defaultTenantId: () => schoolId, tenantSchoolPartition: value => value,
    tenantIdValue: value => /^[a-z0-9-]+$/.test(value || "") ? value : "",
    getMappedStudentsByEmail: async () => [], getRegistrationsByEmail: async () => [],
    getTenantDirectory: async id => id === schoolId ? state.tenant : {rowKey: id, status: "active", schoolName: "其他學校"},
    resolveTenantLineChannel: async () => channel,
    listTenantRolesByEmail: async () => [],
    getTeacherDirectory: async (email, sid) => {teacherReads.push({email, schoolId: sid}); return email === google.email && sid === schoolId ? state.directory : null;},
    getTeacherProfile: async () => state.profile,
    listStudentMaster: async (_status, sid) => sid === schoolId ? [{partitionKey: sid, rowKey: "123456", studentName: "授權學生", status: "active", groupName: "A"}] : [],
    listUserStudentMappings: async () => [], activeTeacherSupport: async () => null, financeAssigned: async () => false,
    teacherCourseAccess,
    OAuth2Client: class {async verifyIdToken() {googleVerifications++; throw Error("This flow has no Google credential");}},
    TableClient: {fromConnectionString: () => memory.db}
  };
  const accounts = runInNewContext(source("api/src/lib/tenantLineAccounts.js") + ";({getOrCreateTenantLineAccount,getTenantLineAccount,getTenantGoogleLink,linkTenantGoogle,unlinkTenantGoogle,createTenantLineSession,tenantLineSession,createTenantLineOAuth,useTenantLineOAuth,clearOAuthCookie,lineSessionCookie,lineCookie,clearTenantLineLinkConfirmation,createTenantLineLinkConfirmation,readTenantLineLinkConfirmation,recordTenantLineFriendship,getTenantLineFriendship,LineAccountConflict})", common);
  const initial = await accounts.getOrCreateTenantLineAccount(schoolId, botId, userId, "wen");
  if (paired) await accounts.linkTenantGoogle(schoolId, initial, google);
  const menu = runInNewContext(source("api/src/lib/tenantLineMenu.js") + ";({refreshTenantLineMenu,LineMenuSyncError})", {...common,
    tenantFacebookUrl: () => "", discoverTenantLineRoleMenu: async () => "", lineApi: async (path, options) => {
      menuCalls.push({path, options});
      if (options?.method === "GET") return {areas: Array.from({length: 6}, () => ({action: {type: "message", text: "#幹部今日課程"}}))};
      return {};
    }});
  const auth = runInNewContext(source("api/src/lib/auth.js") + ";({getAccess,getTenantContext,verifyGoogle,json})", {...common, ...accounts,
    tenantLineParentStudents: async () => []});
  runInNewContext(source("api/src/functions/tenantLineLogin.js"), {...common, ...accounts, ...auth, ...menu,
    app: {http: (name, definition) => handlers[name] = definition.handler}, URL, URLSearchParams, AbortSignal,
    createTenantLineOAuth: async (...args) => {const txn = await accounts.createTenantLineOAuth(...args); oauthNonce = txn.nonce; return txn;},
    fetch: async (url, options) => {
      requests.push({url: String(url), options});
      if (String(url).endsWith("/token")) return {ok: true, json: async () => ({id_token: "oauth-id-token"})};
      return {ok: true, json: async () => ({iss: "https://access.line.me", aud: channel.loginId, nonce: oauthNonce, sub: state.lineSub, name: "wen"})};
    }
  });
  async function login() {
    const started = await handlers.tenantLineLoginStart({params: {schoolId}, headers: new Headers({origin}), json: async () => ({mode: "login"})});
    assert.equal(started.status, 200);
    const oauth = started.cookies.find(value => value.name === "__Host-school-line-oauth"), authorize = new URL(started.jsonBody.url);
    const callback = await handlers.tenantLineLoginCallback({params: {schoolId},
      headers: new Headers({cookie: oauth.name + "=" + oauth.value}), query: new URLSearchParams({state: authorize.searchParams.get("state"), code: "fresh-code"})});
    const session = callback.cookies.find(value => value.name === "__Host-school-line-session" && value.value);
    assert.ok(session); assert.equal(new URL(callback.headers.Location).searchParams.get("line_session"), schoolId);
    assert.equal(callback.cookies.some(value => value.name === "orchestra_google_id_token" && value.value), false);
    return {callback, cookie: session.name + "=" + session.value};
  }
  const request = (session, headers = {}) => ({headers: new Headers({cookie: session.cookie, "X-Google-ID-Token": "line-session", ...headers})});
  return {state, channel, accounts, memory, requests, menuCalls, teacherReads, login,
    googleVerifications: () => googleVerifications,
    access: (session, headers = {}, options) => auth.getAccess(request(session, headers), options),
    context: (session, headers = {}, options) => auth.getTenantContext(request(session, headers), options)};
}

test("confirmed teachers complete real LINE OAuth login and recover current teacher access without any Google cookie", async () => {
  const h = await fixture(), session = await h.login();
  const context = await h.context(session, {"X-School-Id": schoolId, "X-Role-Context": "teacher"});
  assert.equal(context.error, null); assert.equal(context.access.authProvider, "line");
  assert.equal(context.access.role, "ensembleTeacher"); assert.equal(context.access.email, google.email);
  assert.equal(context.access.displayName, "正式名冊老師"); assert.equal(context.access.capabilities.ensemble, true);
  assert.deepEqual(Array.from(context.access.students, student => student.studentId), ["123456"]);
  assert.equal(h.googleVerifications(), 0); assert.equal(h.requests.length, 2);
  assert.ok(h.menuCalls.some(call => call.path.endsWith("/" + h.channel.staffMenuId)));
  assert.deepEqual(h.teacherReads.every(read => read.schoolId === schoolId && read.email === google.email), true);
});

test("LINE login chooses the active teacher role by default and keeps the teacher context available without a forced Google return", async () => {
  const h = await fixture(), session = await h.login(), access = await h.access(session, {}, {includeContexts: true});
  assert.equal(access.authProvider, "line"); assert.equal(access.role, "ensembleTeacher");
  assert.equal(access.activeContextKey, "teacher:" + schoolId);
  assert.ok(Array.from(access.contexts).some(context => context.key === "teacher:" + schoolId));
  const location = new URL(session.callback.headers.Location);
  assert.equal(location.searchParams.has("teacherLineAccount"), false); assert.equal(location.searchParams.has("line_link"), false);
});

test("the same existing LINE session loses teaching privileges immediately when the school directory is disabled", async () => {
  const h = await fixture(), session = await h.login();
  assert.equal((await h.context(session, {"X-Role-Context": "teacher"})).error, null);
  h.state.directory = {...h.state.directory, status: "inactive"};
  const denied = await h.context(session, {"X-Role-Context": "teacher"});
  assert.equal(denied.error.status, 403); assert.equal(denied.access.capabilities.ensemble, undefined);
  const ordinary = await h.access(session); assert.equal(ordinary.role, "unassigned");
  assert.equal(ordinary.capabilities.teacherSettings, undefined);
});

test("unlinking the canonical Google pair invalidates the old LINE session and a fresh unpaired login cannot borrow teacher rights", async () => {
  const h = await fixture(), session = await h.login(); await h.accounts.unlinkTenantGoogle(schoolId, google.sub);
  assert.equal((await h.context(session, {"X-Role-Context": "teacher"})).error.status, 401);
  const fresh = await h.login(), access = await h.access(fresh);
  assert.equal(access.role, "unassigned"); assert.equal(access.capabilities.teacherSettings, undefined);
  assert.equal((await h.context(fresh, {"X-Role-Context": "teacher"})).error.status, 403);
});

test("a foreign school, changed bot, expired session or broken reverse Google index cannot elevate a LINE session", async () => {
  const scoped = await fixture(), session = await scoped.login();
  const foreign = await scoped.context(session, {"X-School-Id": "school-b", "X-Role-Context": "teacher"});
  assert.equal(foreign.error.status, 403); assert.equal(foreign.access.capabilities.teacherSettings, undefined);
  scoped.channel.botUserId = otherId;
  assert.equal((await scoped.context(session, {"X-Role-Context": "teacher"})).error.status, 401);
  const expired = await fixture(), old = await expired.login();
  for (const row of expired.memory.rows.values()) if (row.partitionKey === "session") row.expires = Date.now() - 1;
  assert.equal((await expired.context(old)).error.status, 401);
  for (const changed of [{lineUserId: otherId}, {botUserId: otherId}, {parentEmail: "another-family@example.test"}, {googleEmail: "another-teacher@example.test"}]) {
    const broken = await fixture(), current = await broken.login();
    const index = [...broken.memory.rows.values()].find(row => row.rowKey.startsWith("google-")); Object.assign(index, changed);
    const denied = await broken.context(current, {"X-Role-Context": "teacher"});
    assert.equal(denied.error.status, 403); assert.equal(denied.access.capabilities.teacherSettings, undefined);
  }
});

test("a pending link preview or a different LINE account never grants the named teacher's authority", async () => {
  const pending = await fixture({paired: false}), account = await pending.accounts.getTenantLineAccount(schoolId, botId, userId);
  await pending.accounts.createTenantLineLinkConfirmation(schoolId, account, google, "google");
  const session = await pending.login(), access = await pending.access(session);
  assert.equal(access.role, "unassigned"); assert.equal(access.contactEmail, "");
  assert.equal(await pending.accounts.getTenantGoogleLink(schoolId, google.sub), null);
  assert.equal((await pending.context(session, {"X-Role-Context": "teacher"})).error.status, 403);
  const different = await fixture(); different.state.lineSub = otherId;
  const other = await different.login(); assert.equal((await different.access(other)).role, "unassigned");
  assert.equal((await different.context(other, {"X-Role-Context": "teacher"})).error.status, 403);
});
