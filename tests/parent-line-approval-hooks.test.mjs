import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const strip = value => value.replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const schoolId = "school-a", origin = "https://school-a.example.test";
const botId = "U" + "a".repeat(32), userId = "U" + "b".repeat(32);
const google = {sub: "approved-google", email: "approved@example.test"};
const missing = statusCode => Object.assign(new Error(), {statusCode});
const plain = value => JSON.parse(JSON.stringify(value));

function registrations({role = "admin", authProvider = "google", applicationAuthProvider = "", parentEmail = google.email, lineResult = {status: "accepted"}, lineError = false, emailError = false, mailResult = {status: "sent", messageId: "email-receipt"}, failCommit = false} = {}) {
  let handler, sequence = 0;
  const events = [], notices = [], emails = [], rows = new Map();
  const initial = {partitionKey: schoolId, rowKey: "registration-a", schoolId, status: "pending", parentEmail,
    parentName: "核准家長", relationship: "母親", studentName: "正式學生", studentNo: "112001", matchedStudentId: "112001", applicationAuthProvider};
  rows.set("tenantRegistrations|" + schoolId + "|registration-a", initial);
  const key = (name, partition, row) => [name, partition, row].join("|");
  const db = name => ({
    getEntity: async (partition, row) => {
      const found = rows.get(key(name, partition, row)); if (!found) throw missing(404); return {...found};
    },
    createEntity: async row => {rows.set(key(name, row.partitionKey, row.rowKey), {...row}); events.push(name + ":create");},
    upsertEntity: async row => {rows.set(key(name, row.partitionKey, row.rowKey), {...row}); events.push(name + ":active");},
    updateEntity: async row => {
      if (failCommit && name === "tenantRegistrations" && row.status === "approved") throw new Error("Commit failed");
      rows.set(key(name, row.partitionKey, row.rowKey), {...rows.get(key(name, row.partitionKey, row.rowKey)), ...row});
      events.push(name + ":" + row.status);
    }
  });
  const master = {partitionKey: schoolId, rowKey: "112001", schoolId, status: "active", studentName: "正式學生",
    grade: "四年級", groupName: "A", instrument: "小提琴", schoolYear: "115"};
  runInNewContext(strip(read("api/src/functions/studentRegistration.js")), {
    app: {http: (_name, options) => handler = options.handler}, json: (data, status = 200) => ({data, status}),
    getTenantContext: async () => ({schoolId, access: {role, authProvider, email: role === "admin" ? "admin@example.test" : google.email, displayName: "家長", sub: google.sub}, tenant: {schoolName: "學校甲"}}),
    ensureTenantTables: async () => {}, table: db, rowKey: prefix => prefix + "-" + (++sequence),
    tenantSchoolPartition: value => value, tenantParentPartition: (school, parent) => school + ":" + parent,
    tenantStudentPartition: (school, student) => school + ":" + student,
    getStudentMaster: async () => master, listStudentMaster: async () => [master],
    listRegistrations: async () => [...rows.values()].filter(row => row.rowKey === "registration-a"),
    getRegistrationsByEmail: async () => [],
    reconcileParentLineMenus: async () => {events.push("menu"); return {status: "synced"};},
    sendParentApprovalEmail: async value => {emails.push(plain(value)); events.push("email"); if (emailError) throw new Error("Email unavailable"); return mailResult;},
    notifyParentLineApproval: async (...args) => {
      const saved = rows.get(key("tenantRegistrations", schoolId, "registration-a"));
      const mapping = rows.get(key("tenantUserStudentMap", schoolId + ":" + parentEmail, "112001"));
      assert.equal(saved.status, "approved", "notification must follow committed approval");
      assert.equal(mapping.status, "active", "notification must follow active relationship mapping");
      notices.push(plain(args)); events.push("line"); if (lineError) throw new Error("LINE unavailable"); return lineResult;
    }, console: {warn() {}, error() {}}
  });
  const request = (method = "PATCH", body = {registrationId: "registration-a", action: "approve"}) =>
    handler({method, query: new URLSearchParams(), json: async () => body});
  return {request, events, notices, emails, rows};
}

test("approving an existing student uses the durable LINE receipt after both approval writes commit", async () => {
  const h = registrations({emailError: true}), result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.data.status, "approved"); assert.equal(h.notices.length, 1);
  const [school, payload] = h.notices[0];
  assert.equal(school, schoolId); assert.equal(payload.parentEmail, google.email); assert.equal(payload.studentId, "112001");
  assert.ok(h.events.indexOf("line") > h.events.indexOf("tenantUserStudentMap:active"));
  assert.ok(h.events.indexOf("line") > h.events.indexOf("tenantRegistrations:approved"));
  assert.equal(result.data.lineNotification.status, "accepted");
  assert.equal(result.data.notification.channel, "line"); assert.equal(result.data.notification.status, "accepted");
  assert.equal(result.data.notification.error, ""); assert.equal(result.data.notification.messageId, "");
  assert.ok(result.data.notification.sentAt); assert.equal(h.emails.length, 0, "an accepted LINE receipt must not be replaced by an unrelated Email failure");
  assert.equal((await h.request()).status, 409); assert.equal(h.notices.length, 1, "a repeated completed approval must not queue another receipt");
});

test("LINE-native applicants retain each real receipt outcome without attempting an impossible Email", async t => {
  const parentEmail = "line-00000000-0000-4000-8000-000000000001@line.invalid";
  for (const status of ["accepted", "partial", "pending_friend", "pending", "unconfirmed", "failed", "ineligible", "not_bound", "not_configured", "environment_suppressed"]) {
    await t.test(status, async () => {
      const h = registrations({parentEmail, lineResult: {status}, emailError: true}), result = await h.request();
      assert.equal(result.status, 200); assert.equal(result.data.status, "approved");
      assert.equal(result.data.lineNotification.status, status); assert.equal(result.data.notification.status, status);
      assert.equal(result.data.notification.channel, "line"); assert.equal(h.notices.length, 1); assert.equal(h.emails.length, 0);
      assert.equal(h.notices[0][1].parentEmail, parentEmail);
      assert.equal(Boolean(result.data.notification.sentAt), ["accepted", "partial"].includes(status));
      const saved = h.rows.get("tenantRegistrations|school-a|registration-a");
      assert.equal(saved.status, "approved"); assert.equal(saved.notificationChannel, "line"); assert.equal(saved.notificationStatus, status);
      assert.equal(h.rows.get("tenantUserStudentMap|school-a:" + parentEmail + "|112001").status, "active");
      if (["failed", "ineligible", "not_bound", "not_configured", "environment_suppressed"].includes(status)) {
        assert.match(result.data.notification.error, /LINE/); assert.doesNotMatch(result.data.notification.error, /Email|mail/);
      }
      const read = await h.request("GET");
      assert.equal(read.data.items[0].notificationChannel, "line"); assert.equal(read.data.items[0].notificationStatus, status);
      assert.equal(read.data.items[0].notificationSentAt, result.data.notification.sentAt);
      assert.equal(h.notices.length, 1, "a GET only reads the saved notification outcome"); assert.equal(h.emails.length, 0);
    });
  }
  const h = registrations({parentEmail, lineError: true, emailError: true}), result = await h.request();
  assert.equal(result.data.notification.channel, "line"); assert.equal(result.data.notification.status, "pending");
  assert.equal(result.data.notification.sentAt, null); assert.equal(h.emails.length, 0);
});

test("Gmail-linked LINE receipt outcomes stay authoritative while pending friendship or delivery never falls back", async t => {
  for (const status of ["accepted", "partial", "pending_friend", "pending", "unconfirmed", "failed", "ineligible"]) {
    await t.test(status, async () => {
      const h = registrations({lineResult: {status}, emailError: true}), result = await h.request();
      assert.equal(result.data.status, "approved"); assert.equal(result.data.notification.channel, "line");
      assert.equal(result.data.notification.status, status); assert.equal(h.emails.length, 0);
      assert.equal(h.rows.get("tenantUserStudentMap|school-a:" + google.email + "|112001").status, "active");
    });
  }
  for (const options of [{lineError: true}, {lineResult: null}]) {
    const h = registrations({...options, emailError: true}), result = await h.request();
    assert.equal(result.data.notification.channel, "line"); assert.equal(result.data.notification.status, "pending");
    assert.equal(result.data.notification.sentAt, null); assert.equal(h.emails.length, 0);
  }
});

test("real Gmail applicants without an available LINE route keep the existing Email outcome and saved channel", async t => {
  for (const status of ["not_bound", "not_configured", "environment_suppressed"]) {
    await t.test(status, async () => {
      const h = registrations({lineResult: {status}}), result = await h.request();
      assert.equal(result.data.status, "approved"); assert.equal(result.data.lineNotification.status, status);
      assert.equal(result.data.notification.channel, "email"); assert.equal(result.data.notification.status, "sent");
      assert.equal(result.data.notification.messageId, "email-receipt"); assert.equal(result.data.notification.error, "");
      assert.ok(result.data.notification.sentAt); assert.equal(h.emails.length, 1); assert.equal(h.notices.length, 1);
      assert.equal(h.emails[0].recipient, google.email); assert.equal(h.emails[0].schoolId, schoolId);
      assert.equal(h.emails[0].notificationId, "parent-approval:registration-a");
      const read = await h.request("GET");
      assert.equal(read.data.items[0].notificationChannel, "email"); assert.equal(read.data.items[0].notificationStatus, "sent");
      assert.equal(h.emails.length, 1, "GET must never repeat the fallback Email");
    });
  }
  for (const options of [{emailError: true}, {mailResult: {status: "not_configured"}}, {mailResult: {status: "failed", rawStatus: "mail_denied"}}]) {
    const h = registrations({...options, lineResult: {status: "not_bound"}}), result = await h.request();
    assert.equal(result.data.status, "approved"); assert.equal(result.data.notification.channel, "email");
    assert.equal(result.data.notification.status, options.mailResult?.status || "failed");
    assert.equal(result.data.notification.sentAt, null); assert.ok(result.data.notification.error);
    assert.equal(h.rows.get("tenantRegistrations|school-a|registration-a").status, "approved");
    assert.equal(h.rows.get("tenantUserStudentMap|school-a:" + google.email + "|112001").status, "active");
  }
});

test("a recorded LINE-origin application stays on LINE after pairing Gmail even if its current delivery setup is unavailable", async t => {
  for (const status of ["not_bound", "not_configured", "environment_suppressed"]) {
    await t.test(status, async () => {
      const h = registrations({applicationAuthProvider: "line", lineResult: {status}, emailError: true}), result = await h.request();
      assert.equal(result.data.notification.channel, "line"); assert.equal(result.data.notification.status, status);
      assert.equal(h.notices[0][1].parentEmail, google.email); assert.equal(h.emails.length, 0);
      assert.match(result.data.notification.error, /LINE/);
    });
  }
});

test("new applications persist the trusted login provider while ignoring client-supplied notification origins", async t => {
  for (const authProvider of ["line", "google", undefined]) {
    await t.test(String(authProvider || "legacy Google"), async () => {
      const h = registrations({role: "unassigned", authProvider}), result = await h.request("POST", {
        studentName: "正式學生", studentNo: "112001", consent: true,
        applicationAuthProvider: authProvider === "line" ? "google" : "line", notificationChannel: "line"
      });
      assert.equal(result.status, 201);
      const saved = [...h.rows.values()].find(row => row.rowKey === result.data.registration.registrationId);
      assert.equal(saved.applicationAuthProvider, authProvider === "line" ? "line" : "google");
      assert.equal(saved.status, "pending"); assert.equal(saved.notificationChannel, undefined);
      assert.equal(h.notices.length, 0); assert.equal(h.emails.length, 0);
    });
  }
});

test("registration reads preserve empty channel for older records without inventing a delivery result", async () => {
  const h = registrations(), result = await h.request("GET");
  assert.equal(result.data.items[0].notificationChannel, ""); assert.equal(result.data.items[0].notificationStatus, "");
  assert.equal(result.data.items[0].notificationSentAt, null); assert.equal(h.notices.length, 0); assert.equal(h.emails.length, 0);
});

test("reads, pending submissions, rejection and failed approval commits never trigger a parent LINE receipt", async () => {
  for (const [role, method, body, expected] of [
    ["admin", "GET", {}, 200], ["parent", "GET", {}, 200],
    ["admin", "PATCH", {registrationId: "registration-a", action: "reject"}, 200],
    ["parent", "PATCH", {registrationId: "registration-a", action: "approve"}, 403],
    ["unassigned", "POST", {studentName: "正式學生", studentNo: "112001", consent: true}, 201]
  ]) {
    const h = registrations({role}), result = await h.request(method, body);
    assert.equal(result.status, expected); assert.equal(h.notices.length, 0); assert.equal(h.emails.length, 0);
  }
  const h = registrations({failCommit: true}); await assert.rejects(h.request(), /Commit failed/);
  assert.equal(h.notices.length, 0); assert.equal(h.emails.length, 0);
});

function lineAccount({provider = "google", noticeError = false, flushError = false} = {}) {
  const handlers = {}, notices = [], flushes = [], events = [], fetches = [];
  const account = {partitionKey: schoolId, botUserId: botId, lineUserId: userId, parentEmail: google.email,
    googleSub: google.sub, googleEmail: google.email, displayName: "核准家長"};
  const channel = {schoolId, appOrigin: origin, botUserId: botId, loginConfigured: true, configured: true, loginId: "1234567890", loginSecret: "secret"};
  const pair = {rowKey: "confirm-a", googleSub: google.sub, googleEmail: google.email, lineUserId: userId};
  const state = {provider, authorized: true, pair, account, friendFlag: true, sub: userId, txn: null};
  class LineAccountConflict extends Error {}
  class LineMenuSyncError extends Error {}
  runInNewContext(strip(read("api/src/functions/tenantLineLogin.js")), {
    app: {http: (name, options) => handlers[name] = options.handler}, createHash, URL, URLSearchParams, AbortSignal,
    json: (data, status = 200) => ({data, status}), tenantIdValue: value => value,
    getTenantContext: async () => state.authorized ? {schoolId, access: {role: "parent", authProvider: state.provider}} : {error: {status: 401}},
    resolveTenantLineChannel: async () => channel, verifyGoogle: async () => google,
    tenantLineSession: async () => ({schoolId, account: state.account}),
    getTenantGoogleLink: async () => state.account, getTenantLineAccount: async () => state.account,
    getTenantLineFriendship: async () => ({status: state.friendFlag === true ? "friend" : "unknown", checkedAt: 100}),
    readTenantLineLinkConfirmation: async () => state.pair,
    restoreLabGoogleLineLink: async (_school, _channel, _identity, link) => link,
    clearTenantLineLinkConfirmation: () => ({name: "__Host-school-line-link", value: ""}),
    linkTenantGoogle: async () => {events.push("linked"); return state.account;},
    createTenantLineSession: async () => {events.push("session"); return "current-line-session";},
    clearTenantLineSession: async () => {}, lineSessionCookie: value => ({name: "__Host-school-line-session", value}),
    refreshTenantLineMenu: async () => {events.push("menu"); return {audience: "parent", areaCount: 5};},
    notifyParentLineApproval: async (...args) => {assert.ok(events.includes("linked")); notices.push(plain(args)); events.push("line"); if (noticeError) throw new Error("LINE unavailable"); return {status: "accepted"};},
    flushParentLineApprovalNotices: async (...args) => {assert.ok(events.includes("friendship")); flushes.push(plain(args)); if (flushError) throw new Error("Receipt unavailable"); return {status: "accepted"};},
    useTenantLineOAuth: async () => {const value = state.txn; state.txn = null; return value;},
    clearOAuthCookie: () => ({name: "__Host-school-line-oauth", value: ""}),
    getOrCreateTenantLineAccount: async () => state.account,
    createTenantLineLinkConfirmation: async () => ({cookie: {name: "__Host-school-line-link", value: "pending-confirmation"}}),
    recordTenantLineFriendship: async () => events.push("friendship"), lineCookie: (name, value) => ({name, value}),
    LineAccountConflict, LineMenuSyncError, console: {warn() {}, error() {}},
    fetch: async url => {
      fetches.push(String(url));
      if (String(url).endsWith("/token")) return {ok: true, json: async () => ({id_token: "id-token", access_token: "short-user-token"})};
      if (String(url).endsWith("/friendship/v1/status")) return {ok: true, json: async () => ({friendFlag: state.friendFlag})};
      return {ok: true, json: async () => ({iss: "https://access.line.me", aud: channel.loginId, nonce: "nonce", sub: state.sub})};
    }
  });
  const request = (method = "POST", action = "confirm-link", extra = {}) => handlers.tenantLineAccount({method,
    headers: new Headers({origin, ...(provider === "line" ? {"x-google-id-token": "line-session"} : {}), ...extra}),
    json: async () => ({action, confirmationId: "confirm-a"})});
  const callback = ({friendship = true} = {}) => {
    state.txn = {verifier: "verifier", nonce: "nonce", ...(friendship ? {purpose: "friendship", friendshipInitiator: provider,
      expectedLineUserId: userId, expectedParentEmail: google.email, expectedGoogleSub: google.sub,
      ...(provider === "google" ? {googleSub: google.sub, googleEmail: google.email, returnTo: "parent-account"} : {})} : {})};
    return handlers.tenantLineLoginCallback({params: {schoolId}, headers: new Headers(), query: new URLSearchParams({state: "state", code: "code"})});
  };
  return {request, callback, state, notices, flushes, events, fetches};
}

test("confirm-link queues an approval receipt only after the real Google/LINE account link succeeds", async () => {
  for (const provider of ["google", "line"]) {
    const h = lineAccount({provider}), result = await h.request();
    assert.equal(result.status, 200); assert.equal(result.data.bound, true); assert.equal(h.notices.length, 1);
    const [school, payload] = h.notices[0]; assert.equal(school, schoolId); assert.equal(payload.parentEmail, google.email);
    assert.equal(payload.expectedLineUserId, userId); assert.ok(h.events.indexOf("line") > h.events.indexOf("linked"));
    assert.equal(result.data.lineNotification.status, "accepted");
  }
  const h = lineAccount({noticeError: true}), result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.data.bound, true); assert.equal(result.data.googleLinked, true);
  assert.equal(result.data.lineNotification.status, "pending"); assert.equal(h.notices.length, 1);
});

test("account reads, cancellation, invalid confirmation and unauthenticated or foreign-origin requests send no approval notice", async () => {
  for (const [method, action, change, headers, expected] of [
    ["GET", "", () => {}, {}, 200], ["POST", "cancel-link", () => {}, {}, 200],
    ["POST", "confirm-link", state => state.pair = null, {}, 409],
    ["POST", "confirm-link", state => state.authorized = false, {}, 401],
    ["POST", "confirm-link", () => {}, {origin: "https://other.example.test"}, 403],
    ["POST", "sync-menu", () => {}, {}, 200]
  ]) {
    const h = lineAccount(); change(h.state); const result = await h.request(method, action, headers);
    assert.equal(result.status, expected); assert.equal(h.notices.length, 0); assert.equal(h.flushes.length, 0);
  }
});

test("fresh OAuth friendship evidence flushes only existing receipts while false, unknown or mismatched checks do not", async () => {
  for (const provider of ["google", "line"]) {
    const h = lineAccount({provider}), result = await h.callback();
    assert.equal(new URL(result.headers.Location).searchParams.get("line_friend"), "checked");
    assert.deepEqual(h.flushes, [[schoolId, botId, userId]]); assert.equal(h.notices.length, 0);
    const failed = lineAccount({provider, flushError: true}), callback = await failed.callback();
    assert.equal(new URL(callback.headers.Location).searchParams.get("line_friend"), "checked");
  }
  const ordinary = lineAccount(); await ordinary.callback({friendship: false});
  assert.deepEqual(ordinary.flushes, [[schoolId, botId, userId]]); assert.equal(ordinary.notices.length, 0);
  for (const friendFlag of [false, undefined, null, "true", "false", "unknown"]) {
    for (const friendship of [true, false]) {
      const h = lineAccount(); h.state.friendFlag = friendFlag; await h.callback({friendship});
      assert.equal(h.flushes.length, 0); assert.equal(h.notices.length, 0);
    }
  }
  for (const change of [state => state.sub = "U" + "c".repeat(32), state => state.friendFlag = "true", state => state.account = null]) {
    const h = lineAccount(); change(h.state); await h.callback(); assert.equal(h.flushes.length, 0); assert.equal(h.notices.length, 0);
  }
});

function webhook({signature = true, destination = botId, type = "follow", flushError = false} = {}) {
  const handlers = {}, events = [], flushes = [];
  const channel = {schoolId, configured: true, loginConfigured: true, botUserId: botId, channelSecret: "secret", accessToken: "school-token"};
  runInNewContext(strip(read("api/src/functions/lineWebhook.js")), {
    app: {http: (name, options) => handlers[name] = options.handler}, Buffer, tenantIdValue: value => value,
    json: (data, status = 200) => ({data, status}), resolveTenantLineChannel: async () => channel,
    verifyLineSignature: () => signature, recordTenantLineFriendship: async (...args) => {events.push(["friendship", ...args]);},
    getTenantLineAccount: async () => ({lineUserId: userId}), refreshTenantLineMenu: async () => {},
    flushParentLineApprovalNotices: async (...args) => {assert.ok(events.some(event => event[0] === "friendship")); flushes.push(plain(args)); if (flushError) throw new Error("Receipt unavailable"); return {status: "accepted"};},
    console: {warn() {}, error() {}}
  });
  const payload = {destination, events: [{type, timestamp: 200, source: {type: "user", userId}}]};
  return {flushes, events, run: () => handlers.tenantLineWebhook({params: {schoolId}, headers: new Headers({"x-line-signature": "signed"}), arrayBuffer: async () => Buffer.from(JSON.stringify(payload))})};
}

test("signed same-bot follow events flush existing pending approvals only after friendship evidence is stored", async () => {
  const h = webhook(), result = await h.run(); assert.equal(result.status, 200);
  assert.deepEqual(h.flushes, [[schoolId, botId, userId]]); assert.equal(h.events[0][4], true);
  for (const options of [{type: "unfollow"}, {signature: false}, {destination: "U" + "c".repeat(32)}]) {
    const ignored = webhook(options); await ignored.run(); assert.equal(ignored.flushes.length, 0);
  }
  const failed = webhook({flushError: true}); assert.equal((await failed.run()).status, 200); assert.equal(failed.events.length, 1);
});

test("approval email forwards its optional receipt sender and stable event ID into the existing LINE-first delivery route", async () => {
  const calls = [], lineSender = async () => ({status: "accepted"});
  const send = runInNewContext(strip(read("api/src/lib/email.js")) + ";sendParentApprovalEmail", {
    process: {env: {LAB_ENVIRONMENT: "production"}}, lineFirstLabEnabled: () => true,
    labNoticeUrl: school => origin + "/?schoolId=" + school,
    deliverLabNotice: async options => {calls.push(options); return {status: "sent", channel: "line"};}
  });
  const options = {schoolId, recipient: google.email, studentName: "正式學生", parentName: "核准家長",
    notificationId: "parent-approval:registration-a", lineSender};
  const result = await send(options);
  assert.equal(result.channel, "line"); assert.equal(calls.length, 1);
  assert.equal(calls[0].schoolId, schoolId); assert.deepEqual([...calls[0].recipients], [google.email]);
  assert.equal(calls[0].eventId, options.notificationId); assert.equal(calls[0].lineSender, lineSender);
  assert.match(calls[0].text, /正式學生/);
  calls.length = 0; await send({schoolId, recipient: google.email, studentName: "正式學生"});
  assert.equal(calls.length, 1); assert.equal(calls[0].lineSender, undefined); assert.equal(calls[0].eventId, undefined);
});

test("the approval LINE-first route consumes an existing receipt result without a second generic LINE send and permits email fallback", async () => {
  for (const receiptStatus of ["accepted", "pending_friend"]) {
    const rows = new Map(), pushes = [], mails = [], senders = [];
    let version = 0;
    const key = row => row.partitionKey + "|" + row.rowKey;
    const db = {
      createTable: async () => {},
      getEntity: async (partitionKey, rowKey) => {const row = rows.get(key({partitionKey, rowKey})); if (!row) throw missing(404); return {...row};},
      createEntity: async row => {if (rows.has(key(row))) throw missing(409); rows.set(key(row), {...row, etag: String(++version)});},
      updateEntity: async (row, mode, options) => {
        const previous = rows.get(key(row));
        if (options?.etag && options.etag !== previous?.etag) throw missing(412);
        rows.set(key(row), {...(mode === "Replace" ? {} : previous), ...row, etag: String(++version)});
      }
    };
    class EmailClient {async beginSend(message) {mails.push(plain(message)); return {};}}
    const globals = {
      createHash, URL, EmailClient, process: {env: {LAB_ENVIRONMENT: "production", LINE_SCHOOL_A_APP_ORIGIN: origin}},
      TableClient: {fromConnectionString: (_connection, name) => {assert.equal(name, "TenantNotificationDelivery"); return db;}},
      defaultTenantId: () => "sacred-heart", tenantEmailAddress: value => value,
      tenantEmailConfig: () => ({connectionString: "school-mail", senderAddress: "school@example.test"}),
      getTenantLineParentContact: async () => "",
      resolveTenantLineChannel: async () => {throw Error("A custom receipt sender must bypass generic LINE routing");},
      getTenantLineDeliveryRecipient: async () => {throw Error("A custom receipt sender must bypass generic recipient lookup");},
      pushLineMessage: async (...args) => pushes.push(args)
    };
    const policy = runInNewContext(strip(read("api/src/lib/labNoticeDelivery.mjs")) + ";({lineFirstLabEnabled,deliverLabNotice,labNoticeUrl})", globals);
    const send = runInNewContext(strip(read("api/src/lib/email.js")) + ";sendParentApprovalEmail", {...globals, ...policy});
    const options = {schoolId, recipient: google.email, studentName: "正式學生", notificationId: "parent-approval:registration-a",
      lineSender: async recipient => {senders.push(recipient); return {status: receiptStatus};}};
    const first = await send(options);
    assert.deepEqual(senders, [google.email]); assert.equal(pushes.length, 0);
    assert.equal(first.lineAcceptedCount, receiptStatus === "accepted" ? 1 : 0);
    assert.equal(first.mailAcceptedCount, receiptStatus === "pending_friend" ? 1 : 0);
    assert.equal(first.channel, receiptStatus === "accepted" ? "line" : "email");
    assert.equal(first.results[0].lineStatus, receiptStatus);
    assert.equal(mails.length, receiptStatus === "pending_friend" ? 1 : 0);
    const repeated = await send(options);
    assert.equal(repeated.channel, first.channel); assert.equal(senders.length, 1); assert.equal(pushes.length, 0);
    assert.equal(mails.length, receiptStatus === "pending_friend" ? 1 : 0, "the delivery ledger also deduplicates the mail fallback");
  }
});
