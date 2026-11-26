import test from "node:test";
import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

// Exercise the production storage views, approval proof, recipient lookup and
// announcement handler together. Only Azure persistence and outbound transports
// are replaced; these fixtures make no claims about live production records.
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const load = (path, globals, exports) => runInNewContext(read(path)
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "") + ";(" + exports + ")", globals);
const plain = value => JSON.parse(JSON.stringify(value));
const missing = () => Object.assign(Error("Not found"), {statusCode: 404});
const schoolId = "school-a", otherSchool = "school-b";
const botId = "U" + "a".repeat(32), otherBot = "U" + "c".repeat(32), userId = "U" + "b".repeat(32);
const parentEmail = "parent@example.test", studentId = "123456";
const hash = value => createHash("sha256").update(value).digest("hex");
const draft = {action: "preview", audience: "members", roles: ["parent"], groups: [], allSchool: true,
  text: "學校公告", requestId: "12345678-1234-1234-1234-123456789abc"};

function fixture() {
  const tables = new Map(), reads = [], writes = [], pushes = [], history = [], lineFirstSends = [];
  const env = {STORAGE_CONNECTION_STRING: "in-memory-test", LAB_ENVIRONMENT: "production"};
  const state = {readOnly: true, failApprovedCommit: false, lineFirst: false, schoolId,
    channel: {schoolId, configured: true, loginConfigured: true, acceptsLegacy: false,
      botUserId: botId, accessToken: "mock-school-token", appOrigin: "https://school-a.example.test"}};
  const key = (partition, row) => JSON.stringify([partition, row]);
  const rows = name => {if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name);};
  const seed = (name, row) => rows(name).set(key(row.partitionKey, row.rowKey), {...row});
  const lookup = (name, partition, row) => rows(name).get(key(partition, row));
  function mutate(name, action, row, mode = "Merge") {
    assert.equal(state.readOnly, false, "eligibility lookup must never write application data");
    writes.push({name, action, row: {...row}});
    if (state.failApprovedCommit && name === "TenantStudentRegistration" && row.status === "approved") throw Error("Approval commit failed");
    const old = lookup(name, row.partitionKey, row.rowKey);
    seed(name, mode === "Replace" ? row : {...old, ...row});
  }
  const client = name => ({
    createTable: async () => {},
    getEntity: async (partition, row) => {
      reads.push({name, partition, row});
      if (state.failRead === name) throw Error("Mock storage lookup unavailable");
      const value = lookup(name, partition, row); if (!value) throw missing(); return {...value};
    },
    async *listEntities({queryOptions: {filter}}) {
      reads.push({name, filter});
      const fields = {PartitionKey: "partitionKey", RowKey: "rowKey"};
      const checks = [...filter.matchAll(/([a-zA-Z]+) eq '((?:''|[^'])*)'/g)]
        .map(([, field, value]) => [fields[field] || field, value.replaceAll("''", "'")]);
      for (const row of rows(name).values()) if (checks.every(([field, value]) => row[field] === value)) yield {...row};
    },
    createEntity: async row => mutate(name, "create", row),
    updateEntity: async (row, mode) => mutate(name, "update", row, mode),
    upsertEntity: async (row, mode) => mutate(name, "upsert", row, mode)
  });
  const common = {process: {env}, createHash, randomBytes, randomUUID, URL, console,
    TableClient: {fromConnectionString: (_connection, name) => client(name)},
    TableServiceClient: {fromConnectionString: () => ({createTable: async () => {}})}};
  const storage = load("api/src/lib/storage.js", common,
    "({table,rowKey,ensureTenantTables,defaultTenantId,tenantSchoolPartition,tenantParentPartition,tenantStudentPartition,getStudentMaster,listStudentMaster,listUserStudentMappings,getRegistrationsByEmail,listRegistrations,getMappedStudentsByEmail,getTenantDirectory,listTeacherDirectory,getTeacherProfile,listTenantAdmins})");
  const channel = async () => state.channel;
  const accounts = load("api/src/lib/tenantLineAccounts.js", {...common, ...storage,
    lineApi: async () => {throw Error("No real LINE API is allowed in this integration fixture");}},
  "({getTenantLineDeliveryRecipient})");
  const proof = load("api/src/lib/parentLineApprovalNotice.js", {...common, ...storage, ...accounts,
    resolveTenantLineChannel: channel}, "({getApprovedParentStudent})");
  const audience = load("api/src/lib/lineAudience.js", {...common, ...storage, ...accounts, ...proof,
    resolveTenantLineChannel: channel,
    getStudentAliasInfo: async () => {throw Error("Names and fuzzy aliases cannot authorize parent announcements");}},
  "({lineAudienceRoles,lineAudienceGroups,lineAudienceStudents,resolveLineAudience})");
  let handler, registrationHandler;
  const context = async () => ({schoolId: state.schoolId, access: {role: "admin", email: "admin@example.test"}, tenant: {schoolName: "正式學校"}});
  load("api/src/functions/lineAnnouncements.js", {...common, ...audience,
    app: {http: (_name, options) => {handler = options.handler;}},
    getTenantContext: context, json: (data, status = 200) => ({data, status}),
    resolveTenantLineChannel: channel, workflowLineEnabled: () => true,
    workflowLineRetryKey: (...args) => hash(JSON.stringify(args)), lineFirstLabEnabled: () => state.lineFirst,
    deliverLabNotice: async args => {lineFirstSends.push(plain(args)); return {results: []};},
    pushLineMessage: async (...args) => {pushes.push(plain(args));},
    recordLineAnnouncement: async (...args) => {history.push(plain(args));}}, "undefined");
  function master(id = studentId, extra = {}, sid = schoolId) {
    seed("TenantStudentMaster", {partitionKey: sid, rowKey: id, schoolId: sid, status: "active",
      studentName: "正式學生", groupName: "A", grade: "四年級", instrument: "小提琴", ...extra});
  }
  function registration(id = "reg-current", extra = {}, sid = schoolId) {
    seed("TenantStudentRegistration", {partitionKey: sid, rowKey: id, schoolId: sid,
      parentEmail, studentId, studentName: "正式學生", status: "approved", ...extra});
  }
  function mapping(extra = {}, sid = schoolId) {
    const address = extra.parentEmail || parentEmail, id = extra.studentId || studentId;
    seed("TenantUserStudentMap", {partitionKey: storage.tenantParentPartition(sid, address), rowKey: id,
      schoolId: sid, parentEmail: address, studentId: id, status: "active", registrationId: "reg-current", ...extra});
  }
  function bind(address = parentEmail, user = userId, sid = schoolId, bot = botId, extra = {}) {
    seed("TenantLineIdentity", {partitionKey: sid, rowKey: "email-" + hash(address), parentEmail: address,
      botUserId: bot, lineUserId: user, displayName: address, ...extra});
  }
  function approve({bound = true} = {}) {master(); registration(); mapping(); if (bound) bind();}
  const resolve = async (groups = [], sid = schoolId, bot = botId, roles = ["parent"]) => audience.resolveLineAudience(sid, bot,
    {roles, groups, students: await audience.lineAudienceStudents(sid)});
  const request = body => handler({method: "POST", headers: new Headers({origin: state.channel.appOrigin}), json: async () => body});
  async function failRegistrationCommit() {
    load("api/src/functions/studentRegistration.js", {...common, ...storage,
      app: {http: (_name, options) => {registrationHandler = options.handler;}}, getTenantContext: context,
      json: (data, status = 200) => ({data, status}),
      notifyParentLineApproval: async () => {throw Error("Notification must follow the approval commit");}}, "undefined");
    state.readOnly = false; state.failApprovedCommit = true;
    await assert.rejects(registrationHandler({method: "PATCH", json: async () => ({registrationId: "reg-current", action: "approve"})}), /Approval commit failed/);
    state.readOnly = true;
  }
  return {state, env, tables, reads, writes, pushes, lineFirstSends, history, rows, seed, lookup, master, registration, mapping, bind, approve,
    storage, proof, resolve, request, failRegistrationCommit};
}

test("follower-only, LINE-bound and pending-only accounts are not parent announcement recipients", async t => {
  for (const scenario of ["follower-only", "LINE-bound without students", "pending registration only", "static relationship only"]) await t.test(scenario, async () => {
    const h = fixture(); h.master();
    if (scenario === "follower-only") h.seed("TenantLineIdentity", {partitionKey: schoolId,
      rowKey: "friend-" + hash(botId + ":" + userId), botUserId: botId, lineUserId: userId, friend: true});
    if (scenario !== "follower-only") h.bind();
    if (scenario === "pending registration only") h.registration("reg-current", {status: "pending"});
    if (scenario === "static relationship only") {
      h.env.STUDENT_MAP_JSON = JSON.stringify({[parentEmail]: [{studentId}]});
      h.master(studentId, {}, "sacred-heart");
      assert.equal(await h.proof.getApprovedParentStudent("sacred-heart", parentEmail, studentId), null,
        "even the default school's static relationship must not replace a dynamic announcement mapping");
    }
    const result = await h.resolve();
    assert.equal(result.matched, 0); assert.equal(result.targets.length, 0); assert.equal(result.unbound, 0);
    assert.equal(h.reads.filter(row => row.name === "TenantLineIdentity").length, 0);
    assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
  });
});

test("real storage mapping views cannot turn an unapproved registration into an approved audience", async t => {
  for (const status of ["pending", "rejected", "revoked", "missing"]) await t.test(status, async () => {
    const h = fixture(); h.master(); h.mapping(); h.bind();
    if (status !== "missing") h.registration("reg-current", {status});
    const view = (await h.storage.listUserStudentMappings("active", schoolId))[0];
    assert.equal(view.status, "active"); assert.equal(view.registrationId, "reg-current");
    assert.equal(view.registrationStatus, undefined, "the real storage view does not carry registration approval");
    assert.equal(await h.proof.getApprovedParentStudent(schoolId, parentEmail, studentId), null);
    const result = await h.resolve(); assert.equal(result.matched, 0); assert.equal(result.targets.length, 0);
    assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
  });
});

test("a real failed approval commit leaves a pending registration and active mapping excluded from announcements", async () => {
  const h = fixture(); h.master(); h.registration("reg-current", {status: "pending", matchedStudentId: studentId}); h.bind();
  await h.failRegistrationCommit();
  assert.equal(h.lookup("TenantUserStudentMap", schoolId + "|parent|" + parentEmail, studentId).status, "active");
  assert.equal(h.lookup("TenantStudentRegistration", schoolId, "reg-current").status, "pending");
  const writesBeforeLookup = h.writes.length, result = await h.resolve();
  assert.equal(result.matched, 0); assert.equal(result.targets.length, 0);
  assert.equal(h.writes.length, writesBeforeLookup); assert.equal(h.pushes.length, 0);
});

test("pending, inactive and revoked mappings stay excluded even when the registration is approved", async t => {
  for (const status of ["pending", "inactive", "revoked"]) await t.test(status, async () => {
    const h = fixture(); h.approve(); h.mapping({status});
    assert.equal(await h.proof.getApprovedParentStudent(schoolId, parentEmail, studentId), null);
    assert.equal((await h.resolve()).targets.length, 0); assert.equal(h.writes.length, 0);
  });
});

test("approved exact current students retain bound, unbound and explicit mapping-only parent support", async t => {
  for (const source of ["registration", "school_admin_self_bind", "legacy-active"]) for (const bound of [true, false]) await t.test(source + (bound ? " bound" : " unbound"), async () => {
    const h = fixture(); h.approve({bound});
    if (source !== "registration") h.mapping({registrationId: "", ...(source === "school_admin_self_bind" ? {bindingSource: source, approvedBy: "admin@example.test"} : {})});
    const proof = await h.proof.getApprovedParentStudent(schoolId, parentEmail, studentId);
    assert.equal(proof.studentId, studentId);
    const result = await h.resolve(); assert.equal(result.matched, 1); assert.equal(result.unbound, bound ? 0 : 1);
    assert.deepEqual(plain(result.targets), bound ? [userId] : []); assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
  });
});

test("inactive or missing students and same-name aliases do not authorize a different current student", async t => {
  for (const scenario of ["inactive", "missing", "nonformal"]) await t.test(scenario, async () => {
    const h = fixture(); h.registration(); h.mapping(); h.bind();
    h.master("654321", {studentName: "正式學生", groupName: "A"});
    if (scenario === "inactive") h.master(studentId, {status: "inactive", studentName: "正式學生", groupName: "B"});
    if (scenario === "nonformal") {h.master("old-student"); h.mapping({studentId: "old-student", registrationId: ""});}
    const result = await h.resolve(["A"]);
    assert.equal(result.matched, 0); assert.equal(result.targets.length, 0); assert.equal(h.writes.length, 0);
  });
});

test("school, parent and exact student approval proofs stay isolated", async t => {
  const cases = [
    ["another school's mapping", h => {h.rows("TenantUserStudentMap").clear(); h.mapping({}, otherSchool);}],
    ["foreign mapping partition", h => {h.rows("TenantUserStudentMap").clear(); h.mapping({partitionKey: otherSchool + "|parent|" + parentEmail});}],
    ["foreign registration school", h => h.registration("reg-current", {schoolId: otherSchool})],
    ["foreign registration parent", h => h.registration("reg-current", {parentEmail: "other@example.test"})],
    ["different registration student", h => h.registration("reg-current", {studentId: "654321"})],
    ["foreign master school", h => h.master(studentId, {schoolId: otherSchool})]
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const h = fixture(); h.approve(); change(h);
    const result = await h.resolve(); assert.equal(result.matched, 0); assert.equal(result.targets.length, 0);
    assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
  });
});

test("a same-school approved parent cannot use a foreign school's LINE binding or another bot", async t => {
  for (const scenario of ["foreign binding", "foreign bot", "foreign channel", "requested other bot"]) await t.test(scenario, async () => {
    const h = fixture(); h.approve({bound: false});
    if (scenario === "foreign binding") h.bind(parentEmail, userId, otherSchool);
    else h.bind(parentEmail, userId, schoolId, scenario === "foreign bot" ? otherBot : botId);
    if (scenario === "foreign channel") h.state.channel = {...h.state.channel, schoolId: otherSchool};
    const result = await h.resolve([], schoolId, scenario === "requested other bot" ? otherBot : botId);
    assert.equal(result.matched, 1); assert.equal(result.unbound, 1); assert.equal(result.targets.length, 0);
    assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
  });
});

test("real parent audience deduplicates sibling mappings and LINE identities while preserving selected groups", async () => {
  const h = fixture(); h.approve();
  h.master("654321", {groupName: "B"}); h.registration("reg-sibling", {studentId: "654321"});
  h.mapping({studentId: "654321", registrationId: "reg-sibling"});
  const second = "second@example.test"; h.registration("reg-second", {studentId: "654321", parentEmail: second});
  h.mapping({studentId: "654321", registrationId: "reg-second", parentEmail: second}); h.bind(second, userId);
  const all = await h.resolve(), selected = await h.resolve(["A"]);
  assert.equal(all.matched, 2); assert.deepEqual(plain(all.targets), [userId]); assert.equal(all.recipients.length, 1);
  assert.equal(selected.matched, 1); assert.deepEqual(plain(selected.targets), [userId]);
  assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
});

test("a historical parent alias cannot deliver through a canonical identity without current selected-student approval", async t => {
  const alias = "line-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@line.invalid";
  for (const scenario of ["canonical mapping absent", "canonical mapping revoked", "canonical student outside selected groups", "canonical mapping in another school"]) await t.test(scenario, async () => {
    const h = fixture(); h.master();
    h.registration("reg-alias", {parentEmail: alias}); h.mapping({parentEmail: alias, registrationId: "reg-alias"});
    h.bind(alias, userId, schoolId, botId, {parentEmail, parentAlias: alias});
    if (scenario === "canonical mapping in another school") {
      h.master("654321", {}, otherSchool); h.registration("reg-canonical", {studentId: "654321"}, otherSchool);
      h.mapping({studentId: "654321", registrationId: "reg-canonical"}, otherSchool);
    } else if (scenario !== "canonical mapping absent") {
      h.master("654321", {groupName: "B"});
      h.registration("reg-canonical", {studentId: "654321"});
      h.mapping({studentId: "654321", registrationId: "reg-canonical", ...(scenario === "canonical mapping revoked" ? {status: "revoked"} : {})});
    }
    const result = await h.resolve(["A"]);
    assert.equal(result.matched, 0); assert.equal(result.unbound, 0);
    assert.equal(result.targets.length, 0); assert.equal(result.contacts.length, 0, "denied aliases must not become email fallback contacts");
    assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
  });
});

test("canonical approval for another selected child preserves alias delivery and deduplicates the shared LINE identity", async () => {
  const h = fixture(), alias = "line-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@line.invalid";
  h.master(); h.registration("reg-alias", {parentEmail: alias}); h.mapping({parentEmail: alias, registrationId: "reg-alias"});
  h.master("654321", {groupName: "B"}); h.registration("reg-canonical", {studentId: "654321"});
  h.mapping({studentId: "654321", registrationId: "reg-canonical"});
  for (const address of [parentEmail, alias]) h.bind(address, userId, schoolId, botId, {parentEmail, parentAlias: alias});
  const result = await h.resolve();
  assert.equal(result.matched, 2); assert.equal(result.unbound, 0); assert.equal(result.contacts.length, 2);
  assert.deepEqual(plain(result.targets), [userId]); assert.equal(result.recipients.length, 1);
  assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
});

test("parent and teacher roles form a union and an independent active teacher role preserves alias delivery", async () => {
  const h = fixture(), alias = "line-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@line.invalid";
  h.approve();
  const teacher = "teacher@example.test", teacherUser = "U" + "f".repeat(32);
  h.seed("TenantTeacherDirectory", {partitionKey: schoolId, rowKey: teacher, schoolId, status: "active"}); h.bind(teacher, teacherUser);
  h.registration("reg-alias", {parentEmail: alias}); h.mapping({parentEmail: alias, registrationId: "reg-alias"});
  h.bind(alias, "U" + "d".repeat(32), schoolId, botId, {parentEmail: "canonical-without-students@example.test", parentAlias: alias});
  h.seed("TenantTeacherDirectory", {partitionKey: schoolId, rowKey: alias, schoolId, status: "active"});
  const result = await h.resolve([], schoolId, botId, ["parent", "teacher"]);
  assert.equal(result.matched, 3); assert.equal(result.unbound, 0);
  assert.deepEqual(plain(result.targets), [userId, "U" + "d".repeat(32), teacherUser].sort());
  assert.equal(h.writes.length, 0); assert.equal(h.pushes.length, 0);
});

test("real preview and send recheck live mapping, registration, master and LINE binding before any push", async t => {
  const changes = [
    ["mapping revoked", h => h.mapping({status: "revoked"})],
    ["mapping removed", h => h.rows("TenantUserStudentMap").clear()],
    ["registration revoked", h => h.registration("reg-current", {status: "revoked"})],
    ["registration pending", h => h.registration("reg-current", {status: "pending"})],
    ["student inactive", h => h.master(studentId, {status: "inactive"})],
    ["LINE unlinked", h => h.rows("TenantLineIdentity").clear()]
  ];
  for (const [name, change] of changes) await t.test(name, async () => {
    const h = fixture(); h.approve();
    const preview = await h.request(draft); assert.equal(preview.status, 200); assert.equal(preview.data.deliverable, 1);
    assert.equal(h.pushes.length, 0); change(h);
    const sent = await h.request({...draft, action: "send", preview: preview.data.preview});
    assert.equal(sent.status, 409); assert.match(sent.data.error, /重新預覽/);
    assert.equal(h.pushes.length, 0); assert.equal(h.history.length, 0); assert.equal(h.writes.length, 0);
  });
});

test("canonical parent approval revoked after preview invalidates an otherwise unchanged historical alias", async () => {
  const h = fixture(), alias = "line-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@line.invalid";
  h.approve(); h.registration("reg-alias", {parentEmail: alias}); h.mapping({parentEmail: alias, registrationId: "reg-alias"});
  for (const address of [parentEmail, alias]) h.bind(address, userId, schoolId, botId, {parentEmail, parentAlias: alias});
  const preview = await h.request(draft); assert.equal(preview.status, 200); assert.equal(preview.data.deliverable, 1);
  h.mapping({status: "revoked"});
  const sent = await h.request({...draft, action: "send", preview: preview.data.preview});
  assert.equal(sent.status, 409); assert.equal(h.pushes.length, 0); assert.equal(h.history.length, 0);
});

test("LINE-first delivery cannot recover a denied alias through email fallback before or after canonical revocation", async t => {
  for (const revokedAfterPreview of [false, true]) await t.test(revokedAfterPreview ? "revoked after preview" : "denied before preview", async () => {
    const h = fixture(), alias = "line-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@line.invalid";
    h.state.lineFirst = true; h.master();
    h.registration("reg-alias", {parentEmail: alias}); h.mapping({parentEmail: alias, registrationId: "reg-alias"});
    h.bind(alias, userId, schoolId, botId, {parentEmail, parentAlias: alias});
    if (revokedAfterPreview) {
      h.registration(); h.mapping(); h.bind(parentEmail, userId, schoolId, botId, {parentEmail, parentAlias: alias});
    }
    const preview = await h.request(draft); assert.equal(preview.status, 200);
    assert.equal(preview.data.lineFirst, true); assert.equal(preview.data.deliverable, revokedAfterPreview ? 1 : 0);
    if (revokedAfterPreview) h.mapping({status: "revoked"});
    const current = await h.resolve();
    assert.equal(current.matched, 0); assert.equal(current.contacts.length, 0); assert.equal(current.unbound, 0);
    const sent = await h.request({...draft, action: "send", preview: preview.data.preview});
    assert.equal(sent.status, 409); assert.equal(h.pushes.length, 0); assert.equal(h.lineFirstSends.length, 0); assert.equal(h.history.length, 0);
  });
});

test("an unavailable approval lookup fails the real endpoint closed without any delivery", async () => {
  const h = fixture(); h.approve();
  const preview = await h.request(draft); assert.equal(preview.status, 200);
  h.state.failRead = "TenantStudentRegistration";
  const result = await h.request({...draft, action: "send", preview: preview.data.preview});
  assert.equal(result.status, 503); assert.equal(h.pushes.length, 0); assert.equal(h.lineFirstSends.length, 0); assert.equal(h.history.length, 0);
});

test("raw target IDs and everyone flags cannot bypass real parent audience resolution", async () => {
  const h = fixture(); h.master(); h.bind();
  const body = {...draft, userIds: [userId], targets: [userId], recipients: [{userId}], includeEveryone: true, allFollowers: true};
  const preview = await h.request(body);
  assert.equal(preview.status, 200); assert.equal(preview.data.matched, 0); assert.equal(preview.data.deliverable, 0);
  const sent = await h.request({...body, action: "send", preview: preview.data.preview});
  assert.equal(sent.status, 409); assert.equal(h.pushes.length, 0); assert.equal(h.history.length, 0);
});

test("real announcement preview and send include only approved bound parents and push a shared LINE account once", async () => {
  const h = fixture(); h.approve();
  h.master("654321"); h.registration("reg-sibling", {studentId: "654321"}); h.mapping({studentId: "654321", registrationId: "reg-sibling"});
  const unbound = "unbound@example.test"; h.registration("reg-unbound", {parentEmail: unbound}); h.mapping({parentEmail: unbound, registrationId: "reg-unbound"});
  const pending = "pending@example.test"; h.registration("reg-pending", {parentEmail: pending, status: "pending"});
  h.mapping({parentEmail: pending, registrationId: "reg-pending"}); h.bind(pending, "U" + "d".repeat(32));
  h.bind("follower-only@example.test", "U" + "e".repeat(32));
  const body = {...draft, userIds: ["U" + "e".repeat(32)], targets: ["U" + "e".repeat(32)], includeEveryone: true};
  const preview = await h.request(body);
  assert.equal(preview.status, 200); assert.equal(preview.data.matched, 2); assert.equal(preview.data.unbound, 1);
  assert.equal(preview.data.deliverable, 1); assert.equal(h.pushes.length, 0);
  const sent = await h.request({...body, action: "send", preview: preview.data.preview});
  assert.equal(sent.status, 200); assert.equal(sent.data.accepted, 1); assert.equal(h.pushes.length, 1);
  assert.equal(h.pushes[0][0], userId); assert.equal(h.pushes[0][2].accessToken, "mock-school-token");
  assert.equal(h.history.length, 1); assert.equal(h.writes.length, 0);
});
