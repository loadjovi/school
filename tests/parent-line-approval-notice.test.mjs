import test from "node:test";
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source = readFileSync(new URL("../api/src/lib/parentLineApprovalNotice.js", import.meta.url), "utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const schoolId = "school-a", botId = "U" + "a".repeat(32), userId = "U" + "b".repeat(32);
const parentEmail = "parent@example.test", studentId = "123456", alias = "line-parent@line.invalid";
const missing = statusCode => Object.assign(Error(), {statusCode});
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const tables = new Map(), pushes = [], reads = [], writes = [];
  let serial = 0, clock = 1800000000000;
  const key = (partition, row) => JSON.stringify([partition, row]);
  function rows(name) { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); }
  function seed(name, row) { rows(name).set(key(row.partitionKey, row.rowKey), {...row, etag: String(++serial)}); }
  const state = {enabled: true, friend: "friend", channel: {schoolId, configured: true, loginConfigured: true,
    botUserId: botId, accessToken: "same-school-token", legacy: false},
    account: {partitionKey: schoolId, schoolId, botUserId: botId, lineUserId: userId, parentEmail, googleSub: "google-sub", googleEmail: parentEmail},
    tenant: {rowKey: schoolId, status: "active", schoolName: "正式學校"}, defaultSchool: "school-a", sendError: null};
  const env = {STORAGE_CONNECTION_STRING: "test", LAB_ENVIRONMENT: "production"};
  function client(name) {
    return {
      createTable: async () => {},
      getEntity: async (partition, row) => {reads.push([name, partition, row]); const value = rows(name).get(key(partition, row)); if (!value) throw missing(404); return {...value};},
      createEntity: async row => {if (rows(name).has(key(row.partitionKey, row.rowKey))) throw missing(409); seed(name, row); writes.push([name, "create", {...row}]);},
      updateEntity: async (row, mode, options = {}) => {
        const old = rows(name).get(key(row.partitionKey, row.rowKey)); if (!old) throw missing(404);
        if (options.etag && old.etag !== options.etag) throw missing(412);
        if (state.receiptUpdateFailure && name === "TenantParentLineApprovalNotice" && ["accepted", "unconfirmed"].includes(row.status)) throw Error("persist failed");
        seed(name, mode === "Replace" ? row : {...old, ...row}); writes.push([name, "update", {...row}]);
      },
      async *listEntities({queryOptions: {filter}}) {
        const fields = {PartitionKey: "partitionKey", RowKey: "rowKey"};
        const tests = [...filter.matchAll(/([a-zA-Z]+) eq '([^']*)'/g)].map(([, field, value]) => [fields[field] || field, value]);
        for (const row of rows(name).values()) if (tests.every(([field, value]) => row[field] === value)) yield {...row};
      }
    };
  }
  const parentPartition = (sid, address) => sid + "|parent|" + address;
  function mapping({address = parentEmail, id = studentId, registrationId = "reg-current", status = "active", createdAt = "2026-11-25T00:00:00Z", ...extra} = {}) {
    seed("tenantUserStudentMap", {partitionKey: parentPartition(schoolId, address), rowKey: id, schoolId,
      parentEmail: address, studentId: id, status, registrationId, createdAt, ...extra});
    if (registrationId) seed("tenantRegistrations", {partitionKey: schoolId, rowKey: registrationId, schoolId,
      parentEmail: address, studentId: id, status: "approved"});
  }
  function master(id = studentId, name = "正式學生", extra = {}) {
    seed("studentMaster", {partitionKey: schoolId, rowKey: id, schoolId, studentName: name, status: "active", ...extra});
  }
  mapping(); master();
  const globals = {createHash, randomUUID, process: {env},
    Date: class extends Date {static now() {return clock;}},
    TableClient: {fromConnectionString: (_connection, name) => client(name)}, table: client,
    tenantParentPartition: parentPartition, tenantSchoolPartition: value => value, defaultTenantId: () => state.defaultSchool,
    getStudentMaster: (id, sid) => client("studentMaster").getEntity(sid, id).catch(error => error.statusCode === 404 ? null : Promise.reject(error)),
    getTenantDirectory: async () => state.tenant,
    resolveTenantLineChannel: async () => state.channel,
    workflowLineEnabled: () => state.enabled,
    workflowLineRetryKey: (...args) => createHash("sha256").update(JSON.stringify(args)).digest("hex"),
    getTenantLineDeliveryRecipient: async (_sid, address) => {
      if (state.noBinding) return null;
      return state.recipient || ([parentEmail, state.account?.parentAlias].includes(address) ? state.account && {...state.account} : null);
    },
    getTenantLineAccount: async () => {if (state.accountHook) await state.accountHook(); return state.account && {...state.account};},
    getTenantLineFriendship: async () => ({status: state.friend, checkedAt: 100}),
    pushLineMessage: async (...args) => {pushes.push(plain(args)); if (state.sendHook) await state.sendHook(); if (state.sendError) throw state.sendError; return {};}
  };
  const api = runInNewContext(source + ";({notifyParentLineApproval,flushParentLineApprovalNotices})", globals);
  return {state, env, tables, rows, reads, writes, pushes, seed, mapping, master, client,
    advance: value => clock += value,
    notify: (options = {}) => api.notifyParentLineApproval(schoolId, {parentEmail, ...options}),
    flush: (sid = schoolId, bot = botId, user = userId) => api.flushParentLineApprovalNotices(sid, bot, user),
    receipt: () => [...rows("TenantParentLineApprovalNotice").values()][0]};
}

test("approval before LINE binding and LINE binding before approval each send once after both conditions are true", async () => {
  for (const order of ["approval-first", "line-first"]) {
    const h = fixture();
    if (order === "approval-first") h.state.noBinding = true;
    else h.rows("tenantUserStudentMap").clear();
    const first = await h.notify({studentId}); assert.equal(first.status, order === "approval-first" ? "not_bound" : "ineligible");
    assert.equal(h.pushes.length, 0);
    if (order === "approval-first") h.state.noBinding = false; else h.mapping();
    assert.equal((await h.notify()).status, "accepted"); assert.equal(h.pushes.length, 1);
    assert.equal((await h.notify({studentId})).status, "accepted"); assert.equal(h.pushes.length, 1);
    const [to, card, options] = h.pushes[0]; assert.equal(to, userId); assert.equal(card.type, "flex");
    assert.match(JSON.stringify(card), /家長身分已確認|正式學生|正式學校/); assert.equal(options.accessToken, "same-school-token");
    assert.ok(options.retryKey); assert.equal(h.receipt().status, "accepted");
    assert.equal(h.writes.some(([name]) => name !== "TenantParentLineApprovalNotice"), false);
  }
});

test("an already-approved family gets one card per current formal student, never a caller-supplied name", async () => {
  const h = fixture(); h.mapping({id: "123457", registrationId: "second-reg"}); h.master("123457", "第二學生");
  assert.equal((await h.notify({studentName: "偽造姓名"})).acceptedCount, 2); assert.equal(h.pushes.length, 2);
  assert.match(h.pushes[0][1].fallbackText, /正式學生/); assert.match(h.pushes[1][1].fallbackText, /第二學生/);
  assert.doesNotMatch(JSON.stringify(h.pushes), /偽造姓名/);
  assert.equal((await h.flush()).status, "no_pending"); assert.equal(h.pushes.length, 2);
});

test("canonical and alias registrations for the same child produce one canonical receipt", async () => {
  const h = fixture(); h.state.account.parentAlias = alias; h.mapping({address: alias, registrationId: "alias-reg"});
  assert.equal((await h.notify()).acceptedCount, 1); assert.equal(h.pushes.length, 1);
  assert.equal(h.receipt().approvalVersion, "registration:reg-current");
  const fallback = fixture(); fallback.state.account.parentAlias = alias; fallback.rows("tenantUserStudentMap").clear();
  fallback.mapping({address: alias, registrationId: "alias-only"});
  assert.equal((await fallback.notify()).status, "ineligible"); assert.equal(fallback.pushes.length, 0);
});

test("unknown and negative friend status create pending intents; verified follow flushes only those intents", async () => {
  for (const friend of ["unknown", "not_friend"]) {
    const h = fixture(); h.state.friend = friend;
    assert.equal((await h.notify({studentId})).status, "pending_friend"); assert.equal(h.pushes.length, 0);
    assert.equal(h.receipt().status, "pending_friend"); assert.equal(h.receipt().firstAttemptAt, undefined);
    assert.equal((await h.flush()).status, "pending_friend"); assert.equal(h.pushes.length, 0);
    h.state.friend = "friend"; assert.equal((await h.flush()).status, "accepted"); assert.equal(h.pushes.length, 1);
    await h.flush(); assert.equal(h.pushes.length, 1);
  }
  const unrelated = fixture(); assert.equal((await unrelated.flush()).status, "no_pending"); assert.equal(unrelated.pushes.length, 0);
});

test("wrong schools, bots, accounts, legacy delivery indexes and inactive approval proofs never send", async () => {
  for (const change of [
    h => h.state.channel.schoolId = "school-b", h => h.state.channel.botUserId = "U" + "c".repeat(32),
    h => h.state.channel.loginConfigured = false, h => h.state.channel.accessToken = "",
    h => h.state.account.parentEmail = "other@example.test", h => h.state.account.partitionKey = "school-b",
    h => h.state.recipient = {...h.state.account, deliveryOnly: true},
    h => h.state.recipient = {...h.state.account, googleSub: "other-sub"},
    h => h.mapping({status: "inactive"}), h => h.master(studentId, "正式學生", {status: "inactive"}),
    h => h.seed("tenantRegistrations", {partitionKey: schoolId, rowKey: "reg-current", parentEmail, studentId, status: "revoked"}),
    h => h.seed("tenantRegistrations", {partitionKey: schoolId, rowKey: "reg-current", parentEmail: "other@example.test", studentId, status: "approved"}),
    h => h.state.tenant = {rowKey: "school-b", status: "active"}
  ]) {
    const h = fixture(); change(h); const response = await h.notify({studentId}); assert.notEqual(response.status, "accepted"); assert.equal(h.pushes.length, 0);
  }
  const h = fixture(); assert.equal((await h.notify({studentId, expectedLineUserId: "U" + "c".repeat(32)})).status, "not_bound");
});

test("pending receipts recheck live binding, active mapping, registration and current friendship before every outbound attempt", async () => {
  for (const change of [h => h.state.noBinding = true, h => h.mapping({status: "inactive"}),
    h => h.mapping({registrationId: "new-approval"}), h => h.master(studentId, "正式學生", {status: "inactive"}),
    h => h.state.account.googleSub = "changed-google-sub"]) {
    const h = fixture(); h.state.friend = "unknown"; await h.notify({studentId});
    if (String(change).includes("googleSub")) h.state.recipient = {...h.state.account};
    change(h); h.state.friend = "friend"; await h.flush(); assert.equal(h.pushes.length, 0);
  }
  const h = fixture(); h.state.friend = "unknown"; await h.notify({studentId}); h.state.friend = "friend";
  let reads = 0; h.state.accountHook = async () => {if (++reads === 2) h.mapping({status: "inactive"});};
  await h.flush(); assert.equal(h.pushes.length, 0, "approval removed after claim must stop delivery");
});

test("durable ETags serialize simultaneous approvals and callback flushes for one delivery", async () => {
  const h = fixture(); let release;
  h.state.sendHook = () => new Promise(resolve => release = resolve);
  const first = h.notify({studentId});
  for (let i = 0; i < 30 && !release; i++) await new Promise(setImmediate);
  assert.equal(h.pushes.length, 1);
  const competing = await Promise.all([h.notify({studentId}), h.flush(), h.notify()]);
  assert.ok(competing.every(item => item.status === "pending")); assert.equal(h.pushes.length, 1);
  release(); assert.equal((await first).status, "accepted");
  await h.notify({studentId}); assert.equal(h.pushes.length, 1);
});

test("uncertain provider acceptance retries with the identical persisted recipient, message and key inside the window only", async () => {
  const h = fixture(); h.state.sendError = Error("timeout");
  assert.equal((await h.notify({studentId})).status, "unconfirmed"); const original = plain(h.pushes[0]);
  h.master(studentId, "已更正姓名"); h.state.tenant.schoolName = "已更正學校名"; h.state.sendError = null; h.advance(60_000);
  assert.equal((await h.flush()).status, "accepted"); assert.deepEqual(h.pushes[1], original);
  const expired = fixture(); expired.state.sendError = Error("timeout"); await expired.notify({studentId});
  const key = expired.receipt().retryKey; expired.advance(24 * 60 * 60 * 1000); expired.state.sendError = null;
  assert.equal((await expired.flush()).status, "unconfirmed"); assert.equal(expired.pushes.length, 1); assert.equal(expired.receipt().retryKey, key);
});

test("an acceptance-persistence failure never starts another delivery key or claims actual receipt", async () => {
  const h = fixture(); h.state.receiptUpdateFailure = true;
  assert.equal((await h.notify({studentId})).status, "unconfirmed"); assert.equal(h.receipt().status, "sending");
  assert.equal((await h.flush()).status, "pending"); assert.equal(h.pushes.length, 1);
  h.advance(61_000); h.state.receiptUpdateFailure = false;
  assert.equal((await h.flush()).status, "accepted"); assert.equal(h.pushes.length, 2); assert.deepEqual(h.pushes[1], h.pushes[0]);
});

test("legacy mappings need a current formal master and preserve a stable version without inventing registrations", async () => {
  const h = fixture(); h.mapping({registrationId: ""}); h.rows("tenantRegistrations").clear();
  assert.equal((await h.notify()).status, "accepted"); assert.match(h.receipt().approvalVersion, /^mapping:/);
  const version = h.receipt().approvalVersion; await h.notify({studentId}); assert.equal(h.pushes.length, 1); assert.equal(h.receipt().approvalVersion, version);
  assert.equal(h.rows("tenantRegistrations").size, 0);
});

test("default-school static parent compatibility is exact, current and blocked by modern revoked evidence", async () => {
  const h = fixture(); h.rows("tenantUserStudentMap").clear(); h.rows("tenantRegistrations").clear();
  h.env.STUDENT_MAP_JSON = JSON.stringify({[parentEmail]: {students: [{studentId, name: "舊姓名"}]}});
  assert.equal((await h.notify()).status, "accepted"); assert.match(h.receipt().approvalVersion, /^static:/); assert.match(h.pushes[0][1].fallbackText, /正式學生/);
  for (const kind of ["foreign-school", "revoked-map", "revoked-reg", "pending-reg", "inactive-master", "other-email", "removed-history", "corrected-history", "alias-history"]) {
    const scoped = fixture(); scoped.rows("tenantUserStudentMap").clear(); scoped.rows("tenantRegistrations").clear();
    scoped.env.STUDENT_MAP_JSON = h.env.STUDENT_MAP_JSON;
    if (kind === "foreign-school") scoped.state.defaultSchool = "other-school";
    if (kind === "revoked-map") scoped.mapping({registrationId: "", status: "inactive"});
    if (kind === "revoked-reg" || kind === "pending-reg") scoped.seed("tenantRegistrations", {partitionKey: schoolId, rowKey: "old", parentEmail, studentId, status: kind === "pending-reg" ? "pending" : "revoked"});
    if (kind === "inactive-master") scoped.master(studentId, "正式學生", {status: "inactive"});
    if (kind === "other-email") scoped.env.STUDENT_MAP_JSON = JSON.stringify({"other@example.test": [{studentId}]});
    if (["removed-history", "corrected-history", "alias-history"].includes(kind)) scoped.seed("tenantStudentHistory", {
      partitionKey: schoolId + "|student|999999", rowKey: "removed-history", schoolId,
      changeType: kind === "removed-history" ? "parent_binding_removed" : "parent_binding_correction",
      oldValue: JSON.stringify({parentEmail, studentId: kind === "alias-history" ? "SH-OLD-123" : studentId})});
    assert.notEqual((await scoped.notify()).status, "accepted"); assert.equal(scoped.pushes.length, 0);
  }
});

test("environment suppression and a foreign follow bot cannot send or create approval receipts", async () => {
  const h = fixture(); h.state.enabled = false; h.env.LAB_ENVIRONMENT = "functional-uat";
  assert.equal((await h.notify({studentId})).status, "environment_suppressed"); assert.equal(h.rows("TenantParentLineApprovalNotice").size, 0);
  h.state.enabled = true; h.state.channel.legacy = true; await h.notify(); assert.equal(h.pushes.length, 0);
  const pending = fixture(); pending.state.friend = "unknown"; await pending.notify(); pending.state.friend = "friend";
  await pending.flush(schoolId, "U" + "c".repeat(32)); await pending.flush("school-b"); assert.equal(pending.pushes.length, 0);
});

test("enabled isolated LAB receipts label the card, preview and fallback while production remains unlabelled", async () => {
  for (const environment of ["production", "functional-uat"]) {
    const h = fixture(); h.env.LAB_ENVIRONMENT = environment;
    assert.equal((await h.notify({studentId})).status, "accepted");
    const card = h.pushes[0][1], labelled = environment === "functional-uat";
    for (const text of [card.altText, card.fallbackText, card.contents.header.contents[0].text]) {
      assert.equal(text.includes("【LAB】"), labelled);
    }
    assert.equal(h.pushes[0][2].accessToken, "same-school-token");
  }
});
