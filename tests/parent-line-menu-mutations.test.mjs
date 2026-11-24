import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const schoolId = "school-a", botUserId = "U" + "a".repeat(32);
const firstUser = "U" + "1".repeat(32), secondUser = "U" + "2".repeat(32);
const oldEmail = "old@example.test", nextEmail = "next@example.test";
const schoolPartition = id => id, parentPartition = (id, email) => id + ":" + email;
const clone = value => JSON.parse(JSON.stringify(value));

function harness() {
  const records = new Map(), menuCalls = [], identityReads = [], recipientReads = [], logs = [], emails = [], history = [];
  const accounts = new Map(), recipients = new Map(), staff = new Set();
  let sequence = 0, lineFailure = null, channelOverride = null, onRefresh;
  const key = (name, partition, row) => [name, partition, row].join("|");
  const missing = () => Object.assign(Error("missing"), {statusCode: 404});
  const table = name => ({
    getEntity: async (partition, row) => {
      const value = records.get(key(name, partition, row)); if (!value) throw missing(); return clone(value);
    },
    createEntity: async value => {records.set(key(name, value.partitionKey, value.rowKey), clone(value)); if (name === "tenantStudentHistory") history.push(clone(value));},
    upsertEntity: async value => records.set(key(name, value.partitionKey, value.rowKey), {...records.get(key(name, value.partitionKey, value.rowKey)), ...clone(value)}),
    updateEntity: async value => records.set(key(name, value.partitionKey, value.rowKey), {...records.get(key(name, value.partitionKey, value.rowKey)), ...clone(value)}),
    deleteEntity: async (partition, row) => records.delete(key(name, partition, row)),
    async *listEntities() { for (const [recordKey, value] of records) if (recordKey.startsWith(name + "|")) yield clone(value); }
  });
  const master = {rowKey: "100001", studentName: "學生甲", status: "active", grade: "三年級", groupName: "A", instrument: "小提琴", schoolYear: "115"};
  const mapped = email => [...records.entries()].filter(([recordKey, value]) => recordKey.startsWith("tenantUserStudentMap|") && value.parentEmail === email && value.schoolId === schoolId && value.status === "active").map(([, value]) => value);
  const helper = runInNewContext(read("api/src/lib/parentLineMenu.js") + ";reconcileParentLineMenus", {
    console: {warn: (...args) => logs.push(args)},
    resolveTenantLineChannel: async id => {assert.equal(id, schoolId); return channelOverride || {schoolId, botUserId, configured: true, loginConfigured: true};},
    getTenantLineRecipient: async (id, email, bot) => {recipientReads.push([id, email, bot]); return recipients.get(email) || null;},
    getTenantLineAccount: async (id, bot, user) => {identityReads.push([id, bot, user]); return accounts.get(user) || null;},
    refreshTenantLineMenu: async (channel, account, user, options) => {
      assert.equal(channel.schoolId, schoolId); assert.equal(user, undefined); assert.equal(options.details, true);
      const call = {email: account.parentEmail, googleEmail: account.googleEmail || "", userId: account.lineUserId, approved: mapped(account.parentEmail).length, historyCount: history.length};
      menuCalls.push(call); if (onRefresh) await onRefresh(call);
      if (lineFailure) throw lineFailure;
      const audience = staff.has(account.googleEmail) ? "staff" : call.approved ? "parent" : "default";
      return {audience, areaCount: audience === "staff" ? 6 : audience === "parent" ? 5 : 3};
    }
  });
  const globals = {
    json: (data, status = 200) => ({data, status}), table,
    getTenantContext: async () => ({schoolId, access: {role: "admin", email: "admin@example.test", displayName: "幹部"}, tenant: {schoolName: "測試學校"}}),
    ensureTenantTables: async () => {}, tenantSchoolPartition: schoolPartition, tenantParentPartition: parentPartition,
    tenantStudentPartition: (id, student) => id + ":" + student, rowKey: prefix => prefix + "-" + (++sequence),
    getStudentMaster: async (student, id) => {assert.equal(id, schoolId); return student === master.rowKey ? clone(master) : null;},
    listStudentMaster: async () => [clone(master)], getStudentAliasInfo: async student => ({canonicalStudentId: student}),
    getRegistrationsByEmail: async email => [...records.values()].filter(value => value.parentEmail === email && value.status === "pending"),
    listRegistrations: async () => [...records.entries()].filter(([recordKey]) => recordKey.startsWith("tenantRegistrations|")).map(([, value]) => value),
    sendParentApprovalEmail: async options => {emails.push(options); return {status: "sent"};},
    reconcileParentLineMenus: helper
  };
  function load(path) {
    let handler;
    runInNewContext(read(path), {...globals, app: {http: (_name, value) => handler = value.handler}});
    return handler;
  }
  function bind(email, user = firstUser) {
    const account = {partitionKey: schoolId, botUserId, lineUserId: user, parentEmail: email, googleEmail: email};
    accounts.set(user, account); recipients.set(email, account); return account;
  }
  function mapping(email, student = master.rowKey) {
    const row = {partitionKey: parentPartition(schoolId, email), rowKey: student, schoolId, parentEmail: email, studentId: student, status: "active", relationship: "家長"};
    records.set(key("tenantUserStudentMap", row.partitionKey, student), row); return row;
  }
  function registration(email = oldEmail) {
    const row = {partitionKey: schoolId, rowKey: "registration", parentEmail: email, parentName: "家長", studentName: master.studentName, matchedStudentId: master.rowKey, relationship: "家長", status: "pending"};
    records.set(key("tenantRegistrations", schoolId, row.rowKey), row); return row;
  }
  const request = (method, body = {}) => ({method, query: new URLSearchParams(), json: async () => body});
  return {helper, load, request, bind, mapping, registration, mapped, records, key, accounts, recipients, staff, menuCalls, identityReads, recipientReads, logs, emails, history,
    setFailure: value => lineFailure = value, setChannel: value => channelOverride = value, onRefresh: fn => onRefresh = fn};
}

test("registration approval automatically applies the parent five-entry menu after its approved mapping and audit are committed", async () => {
  const h = harness(); h.bind(oldEmail); h.registration();
  const handler = h.load("api/src/functions/studentRegistration.js");
  const result = await handler(h.request("PATCH", {registrationId: "registration", action: "approve", studentId: "100001"}));
  assert.equal(result.data.status, "approved"); assert.equal(result.data.menuSync.status, "synced");
  assert.equal(result.data.menuSync.audience, "parent"); assert.equal(result.data.menuSync.areaCount, 5);
  assert.equal(h.menuCalls.length, 1); assert.equal(h.menuCalls[0].approved, 1); assert.equal(h.menuCalls[0].historyCount, 1);
  assert.equal(h.emails.length, 1); assert.equal(h.identityReads[0][1], botUserId);
});

test("approval before LINE pairing remains approved and requires no fake recipient or extra role assignment", async () => {
  const h = harness(); h.registration();
  const result = await h.load("api/src/functions/studentRegistration.js")(h.request("PATCH", {registrationId: "registration", action: "approve", studentId: "100001"}));
  assert.equal(result.data.status, "approved"); assert.equal(result.data.menuSync.status, "not_bound");
  assert.equal(h.mapped(oldEmail).length, 1); assert.equal(h.menuCalls.length, 0); assert.equal(h.accounts.size, 0);
});

test("transient LINE failure is retried using a fresh canonical account and never rolls back an approved student", async () => {
  const h = harness(); h.bind(oldEmail); h.registration();
  h.setFailure(Object.assign(Error("private-line-provider-response"), {status: 503}));
  const result = await h.load("api/src/functions/studentRegistration.js")(h.request("PATCH", {registrationId: "registration", action: "approve", studentId: "100001"}));
  assert.equal(result.data.status, "approved"); assert.equal(result.data.menuSync.status, "pending");
  assert.equal(h.mapped(oldEmail).length, 1); assert.equal(h.emails.length, 1);
  assert.equal(h.menuCalls.length, 2); assert.equal(h.identityReads.length, 2);
  assert.doesNotMatch(JSON.stringify({result, logs: h.logs}), /private-line-provider-response/);
});

test("parent binding correction refreshes the old and new recipients only after the mapping transfer", async () => {
  const h = harness(); h.bind(oldEmail); h.bind(nextEmail, secondUser); h.mapping(oldEmail);
  const result = await h.load("api/src/functions/studentParentLinks.js")(h.request("PATCH", {originalParentEmail: oldEmail, originalStudentId: "100001", parentEmail: nextEmail, studentId: "100001", parentName: "新家長"}));
  assert.equal(result.data.ok, true); assert.equal(result.data.menuSync.status, "synced");
  assert.deepEqual(h.menuCalls.map(call => [call.email, call.approved, call.historyCount]).sort(), [[nextEmail, 1, 1], [oldEmail, 0, 1]].sort());
  assert.equal(h.mapped(oldEmail).length, 0); assert.equal(h.mapped(nextEmail).length, 1);
});

test("removing one student's link preserves another approved child and removing the last returns to default three entries", async () => {
  for (const remaining of [false, true]) {
    const h = harness(); h.bind(oldEmail); h.mapping(oldEmail); if (remaining) h.mapping(oldEmail, "100002");
    const result = await h.load("api/src/functions/studentParentLinks.js")(h.request("PATCH", {originalParentEmail: oldEmail, originalStudentId: "100001", action: "remove_binding"}));
    assert.equal(result.data.removed, true); assert.equal(result.data.menuSync.audience, remaining ? "parent" : "default");
    assert.equal(result.data.menuSync.areaCount, remaining ? 5 : 3); assert.equal(h.menuCalls[0].historyCount, 1);
  }
});

test("a School Admin self-binding keeps staff menu priority and GET entry never performs a menu update", async () => {
  const h = harness(); const email = "admin@example.test"; h.bind(email); h.staff.add(email);
  const handler = h.load("api/src/functions/parentSelfBind.js"); await handler(h.request("GET"));
  assert.equal(h.recipientReads.length, 0); assert.equal(h.menuCalls.length, 0);
  const result = await handler(h.request("POST", {studentId: "100001", consent: true}));
  assert.equal(result.data.ok, true); assert.equal(result.data.menuSync.audience, "staff");
  assert.equal(result.data.menuSync.areaCount, 6); assert.equal(h.mapped(email).length, 1);
});

test("recipient aliases are deduplicated and transient retries recheck canonical identity instead of replaying stale staff rights", async () => {
  const h = harness(); const account = h.bind(oldEmail); h.mapping(oldEmail); h.staff.add(oldEmail);
  h.recipients.set("alias@example.test", account);
  let attempts = 0;
  h.onRefresh(() => {
    if (++attempts === 1) {
      h.accounts.set(firstUser, {...account, parentEmail: "line-new@line.invalid", googleEmail: ""});
      h.setFailure(Object.assign(Error("temporary"), {status: 503}));
    } else h.setFailure(null);
  });
  const result = await h.helper(schoolId, [oldEmail, "ALIAS@example.test", oldEmail]);
  assert.equal(result.status, "synced"); assert.equal(result.audience, "default"); assert.equal(result.areaCount, 3);
  assert.equal(h.recipientReads.length, 2); assert.equal(h.identityReads.length, 2); assert.equal(h.menuCalls.length, 2);
  assert.equal(h.menuCalls[1].googleEmail, "");
});

test("wrong-school or wrong-bot lookups and non-transient asset errors never mutate a menu or require another student approval", async () => {
  const wrongSchool = harness(); wrongSchool.bind(oldEmail); wrongSchool.setChannel({schoolId: "school-b", configured: true, loginConfigured: true, botUserId});
  assert.equal((await wrongSchool.helper(schoolId, oldEmail)).status, "not_configured"); assert.equal(wrongSchool.recipientReads.length, 0);
  const wrongBot = harness(); wrongBot.bind(oldEmail).botUserId = "U" + "b".repeat(32);
  assert.equal((await wrongBot.helper(schoolId, oldEmail)).status, "pending"); assert.equal(wrongBot.identityReads.length, 0);
  const unavailable = harness(); unavailable.bind(oldEmail); unavailable.mapping(oldEmail); unavailable.setFailure(Error("template missing"));
  assert.equal((await unavailable.helper(schoolId, oldEmail)).status, "pending"); assert.equal(unavailable.menuCalls.length, 1);
  assert.equal(unavailable.mapped(oldEmail).length, 1);
});
