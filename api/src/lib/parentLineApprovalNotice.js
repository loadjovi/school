import {createHash, randomUUID} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {defaultTenantId, getStudentMaster, getTenantDirectory, table, tenantParentPartition, tenantSchoolPartition} from "./storage.js";
import {getTenantLineAccount, getTenantLineDeliveryRecipient, getTenantLineFriendship} from "./tenantLineAccounts.js";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {workflowLineEnabled, workflowLineRetryKey} from "./lineAdminTodoNotification.mjs";

const receiptTable = "TenantParentLineApprovalNotice";
const retryWindow = 23 * 60 * 60 * 1000;
const leaseDuration = 60 * 1000;
const email = value => String(value || "").trim().toLowerCase();
const validUser = value => /^U[0-9a-f]{32}$/i.test(value || "");
const scopeMatches = (row, schoolId) => row && (!row.schoolId || row.schoolId === schoolId);
const result = status => ({status});
const digest = values => createHash("sha256").update(JSON.stringify(values)).digest("hex");
const escaped = value => String(value).replaceAll("'", "''");
async function read(db, partition, key) {
  try { return await db.getEntity(partition, key); }
  catch (error) { if (error.statusCode === 404) return null; throw error; }
}
async function receiptStore() {
  const db = TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING, receiptTable);
  await db.createTable().catch(error => { if (error.statusCode !== 409) throw error; });
  return db;
}
async function channelFor(schoolId) {
  if (!workflowLineEnabled()) return null;
  const channel = await resolveTenantLineChannel(schoolId);
  if (channel.schoolId !== schoolId || !channel.configured || !channel.loginConfigured ||
      !validUser(channel.botUserId) || !channel.accessToken ||
      process.env.LAB_ENVIRONMENT === "functional-uat" && channel.legacy) return null;
  return channel;
}
function matchesAccount(account, schoolId, botId, userId, parentEmail) {
  return scopeMatches(account, schoolId) && (!account.partitionKey || account.partitionKey === tenantSchoolPartition(schoolId)) &&
    account.botUserId === botId && account.lineUserId === userId && validUser(userId) &&
    [email(account.parentEmail), email(account.parentAlias)].filter(Boolean).includes(email(parentEmail));
}
async function currentAccount(schoolId, channel, parentEmail, expectedLineUserId) {
  const recipient = await getTenantLineDeliveryRecipient(schoolId, parentEmail, channel);
  if (!recipient || recipient.deliveryOnly || recipient.botUserId !== channel.botUserId ||
      !validUser(recipient.lineUserId) || expectedLineUserId && recipient.lineUserId !== expectedLineUserId) return null;
  const account = await getTenantLineAccount(schoolId, channel.botUserId, recipient.lineUserId);
  return matchesAccount(account, schoolId, channel.botUserId, recipient.lineUserId, parentEmail) &&
    recipient.parentEmail === account.parentEmail && (recipient.googleSub || "") === (account.googleSub || "") ? account : null;
}

// The active mapping is the approval proof. Registrations, when referenced by
// it, must still be approved; legacy mappings never synthesize a registration.
function staticStudents(schoolId, parentEmail) {
  if (schoolId !== defaultTenantId()) return [];
  let entry;
  try { entry = JSON.parse(process.env.STUDENT_MAP_JSON || "{}")[parentEmail]; } catch { return []; }
  return (Array.isArray(entry) ? entry : Array.isArray(entry?.students) ? entry.students : [])
    .filter(student => student && typeof student === "object" && /^\d{6}$/.test(String(student.studentId || "")));
}
async function approvalProof(schoolId, parentEmail, studentId, allowStatic = false) {
  if (!/^\d{6}$/.test(studentId || "")) return null;
  const partition = tenantParentPartition(schoolId, parentEmail);
  const mapping = await read(table("tenantUserStudentMap"), partition, studentId);
  if (mapping && (mapping.partitionKey !== partition || mapping.rowKey !== studentId ||
      mapping.status !== "active" || !scopeMatches(mapping, schoolId) || email(mapping.parentEmail) !== email(parentEmail) ||
      mapping.studentId && String(mapping.studentId) !== studentId)) return null;
  // An explicit revoked/inactive map always wins. Static compatibility applies
  // only when no row exists, for the default school's exact canonical parent.
  if (!mapping && (!allowStatic || !staticStudents(schoolId, parentEmail).some(student => String(student.studentId) === studentId))) return null;
  if (!mapping) {
    for await (const registration of table("tenantRegistrations").listEntities({queryOptions: {filter:
      `PartitionKey eq '${escaped(tenantSchoolPartition(schoolId))}' and parentEmail eq '${escaped(parentEmail)}'`}})) {
      if (String(registration.studentId || registration.matchedStudentId || registration.studentNo || "") === studentId && registration.status !== "approved") return null;
    }
    // Corrections store history under the *target* student partition. Search
    // only this school's audit rows so deleting an old map cannot revive an
    // obsolete static relationship, including an unresolved historical alias.
    for await (const history of table("tenantStudentHistory").listEntities({queryOptions: {filter: `schoolId eq '${escaped(schoolId)}'`}})) {
      if (!["parent_binding_removed", "parent_binding_correction"].includes(history.changeType)) continue;
      let previous;
      try { previous = JSON.parse(history.oldValue); } catch { return null; }
      if (email(previous?.parentEmail) !== parentEmail) continue;
      const oldId = String(previous.studentId || previous.studentNo || "");
      if (!/^\d{6}$/.test(oldId) || oldId === studentId) return null;
    }
  }
  const master = await getStudentMaster(studentId, schoolId);
  if (!master || String(master.rowKey) !== studentId || !scopeMatches(master, schoolId) ||
      master.partitionKey && master.partitionKey !== tenantSchoolPartition(schoolId) ||
      !["", "active"].includes(String(master.status || "")) || !String(master.studentName || "").trim()) return null;
  let version;
  if (!mapping) version = "static:" + digest([schoolId, parentEmail, studentId, "STUDENT_MAP_JSON"]);
  else if (mapping.registrationId) {
    const registration = await read(table("tenantRegistrations"), tenantSchoolPartition(schoolId), String(mapping.registrationId));
    if (!registration || registration.status !== "approved" || !scopeMatches(registration, schoolId) ||
        email(registration.parentEmail) !== email(parentEmail) ||
        String(registration.studentId || registration.matchedStudentId || registration.studentNo || "") !== studentId) return null;
    version = "registration:" + mapping.registrationId;
  } else version = "mapping:" + String(mapping.approvedAt || mapping.createdAt || "legacy-active");
  return {studentId, studentName: String(master.studentName).trim().slice(0, 120), version};
}
async function intentProof(schoolId, account, intent) {
  const canonicalEmail = email(account.parentEmail);
  if (intent.parentEmail !== canonicalEmail) return null;
  return approvalProof(schoolId, canonicalEmail, intent.studentId, true);
}
function card(schoolName, studentName) {
  const title = "家長身分已確認", lead = `已確認您為「${studentName}」的家長。`;
  const detail = "您可查看孩子課程、出勤與活動資訊。";
  const school = (process.env.LAB_ENVIRONMENT === "functional-uat" ? "【LAB】" : "") + String(schoolName || "學校平台").slice(0, 120);
  const text = (value, size = "md", color = "#173D31", weight = "regular") =>
    ({type: "text", text: value, size, color, weight, wrap: true});
  return {type: "flex", altText: `${school}｜${title}｜${studentName}`.slice(0, 400),
    fallbackText: [school, title, lead, detail].join("\n"), contents: {type: "bubble",
      header: {type: "box", layout: "vertical", spacing: "sm", backgroundColor: "#245C47", contents: [
        text(school, "sm", "#FFFFFF"), text(title, "lg", "#FFFFFF", "bold")]},
      body: {type: "box", layout: "vertical", spacing: "lg", contents: [text(lead, "lg", "#173D31", "bold"), text(detail)]}}};
}
function eventKey(schoolId, channel, account, proof) {
  return digest([schoolId, channel.botUserId, account.lineUserId, proof.studentId, proof.version]);
}
async function saveResult(db, claimed, status) {
  const current = await read(db, claimed.partitionKey, claimed.rowKey);
  if (current?.claimId !== claimed.claimId) return false;
  await db.updateEntity({partitionKey: claimed.partitionKey, rowKey: claimed.rowKey, status, leaseUntil: 0,
    ...(status === "accepted" ? {acceptedAt: Date.now()} : {})}, "Merge", {etag: current.etag});
  return true;
}
async function deliver(db, schoolId, channel, intent) {
  if (intent.status === "accepted") return result("accepted");
  const now = Date.now();
  if (intent.status === "sending" && Number(intent.leaseUntil) > now) return result("pending");
  // After an uncertain acceptance the provider's retry-key window must never be
  // restarted. A later hook may retry only with the original key inside 23h.
  if (intent.firstAttemptAt && (now < intent.firstAttemptAt || now - intent.firstAttemptAt >= retryWindow)) return result("unconfirmed");
  const account = await currentAccount(schoolId, channel, intent.parentEmail, intent.lineUserId);
  const proof = account && await intentProof(schoolId, account, intent);
  if (!proof || proof.version !== intent.approvalVersion || eventKey(schoolId, channel, account, proof) !== intent.rowKey) return result("ineligible");
  const friendship = await getTenantLineFriendship(schoolId, channel.botUserId, account.lineUserId);
  if (friendship.status !== "friend") return result("pending_friend");
  const tenant = await getTenantDirectory(schoolId);
  if (!tenant || tenant.rowKey && tenant.rowKey !== schoolId || !["active", "onboarding"].includes(tenant.status)) return result("ineligible");
  // Provider retries must keep both recipient and payload unchanged even if a
  // student or school is renamed while the first acceptance is uncertain.
  const messageJson = intent.messageJson || JSON.stringify(card(tenant.systemName || tenant.schoolName || schoolId, proof.studentName));
  const message = JSON.parse(messageJson);
  const claimId = randomUUID(), claimed = {...intent, status: "sending", claimId, leaseUntil: now + leaseDuration,
    firstAttemptAt: intent.firstAttemptAt || now, messageJson,
    retryKey: intent.retryKey || workflowLineRetryKey(schoolId, "parent-approval:" + intent.rowKey, account.lineUserId)};
  try { await db.updateEntity(claimed, "Replace", {etag: intent.etag}); }
  catch (error) { if ([409, 412].includes(error.statusCode)) return result("pending"); throw error; }
  try {
    // Re-read both sides after the durable claim, immediately before sending.
    const latest = await currentAccount(schoolId, channel, intent.parentEmail, intent.lineUserId);
    const approval = latest && await intentProof(schoolId, latest, intent);
    const friend = latest && await getTenantLineFriendship(schoolId, channel.botUserId, latest.lineUserId);
    if (!approval || approval.version !== intent.approvalVersion || !friend || friend.status !== "friend") {
      const state = approval?.version === intent.approvalVersion ? "pending_friend" : "ineligible";
      await saveResult(db, claimed, state); return result(state);
    }
    await pushLineMessage(latest.lineUserId, message,
      {accessToken: channel.accessToken, retryKey: claimed.retryKey});
    await saveResult(db, claimed, "accepted");
    return result("accepted");
  } catch (error) {
    const status = Number(error?.status || error?.statusCode);
    const outcome = status >= 400 && status < 500 ? "failed" : "unconfirmed";
    try { await saveResult(db, claimed, outcome); } catch { /* Keep the claim and original retry key. */ }
    return result(outcome);
  }
}
function combine(items, empty = "ineligible") {
  if (!items.length) return result(empty);
  const states = items.map(item => item.status);
  const status = states.every(value => value === "accepted") ? "accepted" :
    states.includes("accepted") ? "partial" : states.includes("pending_friend") ? "pending_friend" :
    states.includes("unconfirmed") ? "unconfirmed" : states.includes("pending") ? "pending" : states[0];
  return {status, acceptedCount: states.filter(value => value === "accepted").length, pendingCount: states.filter(value => value !== "accepted").length};
}

// Called only after a successful approval commit or explicit link confirmation.
// It never changes mappings, account identity, friendship, sessions or menus.
export async function notifyParentLineApproval(schoolId, {parentEmail, studentId, expectedLineUserId} = {}) {
  try {
    const address = email(parentEmail);
    if (!address || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(schoolId || "")) return result("ineligible");
    const channel = await channelFor(schoolId);
    if (!channel) return result(workflowLineEnabled() ? "not_configured" : "environment_suppressed");
    const account = await currentAccount(schoolId, channel, address, expectedLineUserId);
    if (!account) return result("not_bound");
    const candidates = new Map();
    // Authentication grants student rights from the canonical parentEmail;
    // historical parentAlias rows alone must never imply current access.
    if (studentId) candidates.set(String(studentId), email(account.parentEmail));
    else for (const mappedEmail of [email(account.parentEmail)]) {
      const partition = tenantParentPartition(schoolId, mappedEmail);
      for await (const row of table("tenantUserStudentMap").listEntities({queryOptions: {filter: `PartitionKey eq '${escaped(partition)}' and status eq 'active'`}})) {
        if (row.partitionKey === partition && row.status === "active" && email(row.parentEmail) === mappedEmail && !candidates.has(String(row.rowKey))) candidates.set(String(row.rowKey), mappedEmail);
      }
      if (mappedEmail === email(account.parentEmail)) for (const student of staticStudents(schoolId, mappedEmail)) {
        const id = String(student.studentId);
        if (!candidates.has(id)) candidates.set(id, mappedEmail);
      }
    }
    const db = await receiptStore(), outcomes = [];
    for (const [id, mappingEmail] of candidates) {
      const proof = await approvalProof(schoolId, mappingEmail, id, mappingEmail === email(account.parentEmail));
      if (!proof) continue;
      const rowKey = eventKey(schoolId, channel, account, proof);
      let intent = await read(db, schoolId, rowKey);
      if (!intent) {
        try { await db.createEntity({partitionKey: schoolId, rowKey, schoolId, botUserId: channel.botUserId,
          lineUserId: account.lineUserId, parentEmail: mappingEmail, studentId: id, approvalVersion: proof.version,
          status: "pending_friend", createdAt: Date.now()}); }
        catch (error) { if (error.statusCode !== 409) throw error; }
        intent = await read(db, schoolId, rowKey);
      }
      if (intent) outcomes.push(await deliver(db, schoolId, channel, intent));
    }
    return combine(outcomes);
  } catch { return result("pending"); }
}

// Only existing approval intents are replayed after a verified follow or a
// fresh OAuth callback with explicit positive friendship evidence. GET never sends.
export async function flushParentLineApprovalNotices(schoolId, botUserId, userId) {
  try {
    const channel = await channelFor(schoolId);
    if (!channel || channel.botUserId !== botUserId || !validUser(userId)) return result("ineligible");
    const db = await receiptStore(), outcomes = [];
    for await (const intent of db.listEntities({queryOptions: {filter: `PartitionKey eq '${escaped(schoolId)}' and botUserId eq '${escaped(botUserId)}' and lineUserId eq '${escaped(userId)}'`}})) {
      if (intent.partitionKey !== schoolId || intent.botUserId !== botUserId || intent.lineUserId !== userId || intent.status === "accepted") continue;
      outcomes.push(await deliver(db, schoolId, channel, intent));
    }
    return combine(outcomes, "no_pending");
  } catch { return result("pending"); }
}
