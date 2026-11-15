import test from "node:test";
import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (path, globals, result = "") => runInNewContext(
  source(path).replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "") + result, globals
);
const missing = statusCode => Object.assign(new Error(), {statusCode});
const botId = "U" + "a".repeat(32);
const userId = "U" + "b".repeat(32);
const google = {sub: "google-id", email: "parent@example.com"};

function dataTables() {
  const rows = new Map();
  let version = 0;
  const key = (p, r) => JSON.stringify([p, r]);
  function apply(table, action, row, options) {
    const id = key(row.partitionKey, row.rowKey), old = table.get(id);
    if (action === "create" && old) throw missing(409);
    if (action !== "create" && !old) throw missing(404);
    if (options?.etag && old.etag !== options.etag) throw missing(412);
    if (action === "delete") table.delete(id);
    else table.set(id, {...row, etag: String(++version)});
  }
  const db = {
    async createTable() {},
    async getEntity(partition, row) {
      const item = rows.get(key(partition, row));
      if (!item) throw missing(404);
      return {...item};
    },
    async createEntity(row) {apply(rows, "create", row);},
    async deleteEntity(partitionKey, rowKey, options) {apply(rows, "delete", {partitionKey, rowKey}, options);},
    async updateEntity(row) {apply(rows, "update", {...rows.get(key(row.partitionKey, row.rowKey)), ...row});},
    async submitTransaction(actions) {
      const draft = new Map(rows);
      for (const action of actions) apply(draft, action[0], action[1], action[3]);
      rows.clear();
      for (const [id, row] of draft) rows.set(id, row);
    }
  };
  return {TableClient: {fromConnectionString: () => db}, rows};
}

function identities(studentRows = new Set()) {
  return load("api/src/lib/tenantLineAccounts.js", {
    ...dataTables(), createHash, randomBytes, randomUUID, process: {env: {}},
    defaultTenantId: () => "sacred-heart", tenantSchoolPartition: value => value,
    getMappedStudentsByEmail: async (email, school) => studentRows.has(school + "|" + email) ? [{}] : [],
    getRegistrationsByEmail: async () => []
  }, ";({getOrCreateTenantLineAccount,getTenantGoogleLink,getTenantLineRecipient,getTenantLineParentContact,linkTenantGoogle,unlinkTenantGoogle,createTenantLineSession,tenantLineSession,createTenantLineOAuth,useTenantLineOAuth})");
}

test("both login methods resolve a single account without crossing schools", async () => {
  const students = new Set(), store = identities(students);
  const a = await store.getOrCreateTenantLineAccount("school-a", botId, userId, "家長");
  const b = await store.getOrCreateTenantLineAccount("school-b", botId, userId, "家長");
  students.add("school-a|" + a.parentEmail);
  const linkedA = await store.linkTenantGoogle("school-a", a, google);
  const linkedB = await store.linkTenantGoogle("school-b", b, google);
  assert.equal(linkedA.parentEmail, a.parentEmail);
  assert.equal(linkedB.parentEmail, google.email);
  assert.equal((await store.getTenantGoogleLink("school-a", google.sub)).parentEmail, a.parentEmail);
  assert.equal(await store.getTenantLineRecipient("school-b", a.parentEmail, botId), null);
  assert.equal(await store.getTenantLineParentContact("school-a", a.parentEmail), google.email);
  assert.equal(await store.getTenantLineParentContact("school-b", a.parentEmail), "");
  const cookie = await store.createTenantLineSession("school-a", linkedA);
  const request = {headers: new Headers({cookie: "__Host-school-line-session=" + cookie})};
  assert.equal((await store.tenantLineSession(request)).schoolId, "school-a");
  await store.unlinkTenantGoogle("school-a", google.sub);
  assert.equal(await store.tenantLineSession(request), null);
  assert.equal((await store.getTenantGoogleLink("school-a", google.sub)).parentEmail, a.parentEmail);
  assert.equal(await store.getTenantLineParentContact("school-a", a.parentEmail), google.email);
  assert.equal((await store.getTenantGoogleLink("school-b", google.sub)).lineUserId, userId);
});

test("ambiguous links with both accounts holding school history do not change either account", async () => {
  const rows = new Set(), store = identities(rows);
  const a = await store.getOrCreateTenantLineAccount("school-a", botId, userId, "家長");
  rows.add("school-a|" + a.parentEmail);
  rows.add("school-a|" + google.email);
  await assert.rejects(store.linkTenantGoogle("school-a", a, google), /各有學生紀錄/);
  assert.equal(await store.getTenantGoogleLink("school-a", google.sub), null);
});

test("LINE OAuth state is one-use and bound to browser, school, and configuration", async () => {
  const store = identities(), config = {oauthVersion: "A"};
  const txn = await store.createTenantLineOAuth("school-a", config, google);
  const headers = new Headers({cookie: txn.cookie.name + "=" + txn.cookie.value});
  assert.equal(await store.useTenantLineOAuth({headers: new Headers()}, "school-a", txn.state, config), null);
  assert.equal(await store.useTenantLineOAuth({headers}, "school-b", txn.state, config), null);
  assert.equal(await store.useTenantLineOAuth({headers}, "school-a", txn.state, {oauthVersion: "B"}), null);
  const results = await Promise.all([
    store.useTenantLineOAuth({headers}, "school-a", txn.state, config),
    store.useTenantLineOAuth({headers}, "school-a", txn.state, config)
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean).nonce, txn.nonce);
});

test("LINE authentication never reads students for a different school or staff context", async () => {
  let reads = 0;
  const {lineParentAccess} = load("api/src/lib/auth.js", {
    OAuth2Client: class {}, tenantLineSession: async () => ({schoolId: "school-a", account: {botUserId: botId}}),
    resolveTenantLineChannel: async () => ({loginConfigured: true, botUserId: botId}),
    tenantLineParentStudents: async () => {reads++;return [];},
    getTenantDirectory: async () => ({status: "active"})
  }, ";({lineParentAccess})");
  for (const headers of [{"X-School-Id": "school-b"}, {"X-Role-Context": "teacher"}]) {
    assert.equal((await lineParentAccess({headers: new Headers(headers)})).role, "contextDenied");
  }
  assert.equal(reads, 0);
});

test("fee notification retry keeps the initial target and provider retry key", async () => {
  const calls = [];
  let target = userId;
  const {sendTenantFeeLine} = load("api/src/lib/tenantLineFeeNotice.js", {
    ...dataTables(), randomUUID, process: {env: {}}, console: {warn() {}},
    lineHash: value => createHash("sha256").update(value).digest("hex"),
    resolveTenantLineChannel: async school => ({loginConfigured: true, paymentLineEnabled: true, botUserId: botId, accessToken: "token-" + school}),
    getTenantLineRecipient: async () => ({lineUserId: target}),
    pushLineMessage: async (user, text, request) => {
      calls.push({user, request});
      if(calls.length === 1)throw new Error("timeout");
    }
  }, ";({sendTenantFeeLine})");
  const entry = {id: "school-fee-event", at: new Date().toISOString(), parentEmail: google.email, text: "測試"};
  assert.equal((await sendTenantFeeLine("school-a", entry)).status, "pending");
  target = "U" + "c".repeat(32);
  assert.equal((await sendTenantFeeLine("school-a", entry)).status, "target_changed");
  target = userId;
  assert.equal((await sendTenantFeeLine("school-a", entry)).status, "accepted");
  assert.equal((await sendTenantFeeLine("school-a", entry)).status, "accepted");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].request.retryKey, calls[1].request.retryKey);
  assert.equal(calls[1].request.accessToken, "token-school-a");
});
