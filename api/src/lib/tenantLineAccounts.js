import {createHash, randomBytes, randomUUID} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {defaultTenantId, getMappedStudentsByEmail, getRegistrationsByEmail, tenantSchoolPartition} from "./storage.js";

const name = "TenantLineIdentity";
let database;
let initialized;
export const lineHash = value => createHash("sha256").update(value).digest("hex");
export const lineRandom = () => randomBytes(32).toString("base64url");
const lineKey = (botUserId, userId) => "line-" + lineHash(botUserId + ":" + userId);
const googleKey = sub => "google-" + lineHash(sub);
const emailKey = email => "email-" + lineHash(email);
const contactKey = email => "contact-" + lineHash(email);
const sessionCookieName = "__Host-school-line-session";
const sessionDuration = 12 * 60 * 60;

function store() {
  return database ??= TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING, name);
}

async function writableStore() {
  initialized ??= store().createTable().catch(error => {
    if (error.statusCode !== 409) {
      initialized = undefined;
      throw error;
    }
  });
  await initialized;
  return store();
}

async function read(partitionKey, rowKey) {
  try {
    return await store().getEntity(partitionKey, rowKey);
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

export async function getTenantLineAccount(schoolId, botUserId, userId) {
  if (!botUserId || !/^U[0-9a-f]{32}$/i.test(userId || "")) return null;
  return read(tenantSchoolPartition(schoolId), lineKey(botUserId, userId));
}

export async function getTenantGoogleLink(schoolId, googleSub) {
  return googleSub ? read(tenantSchoolPartition(schoolId), googleKey(googleSub)) : null;
}

export async function getTenantLineParentContact(schoolId, email) {
  if (!/^line-[a-f0-9-]{36}@line\.invalid$/.test(email || "")) return "";
  const row = await read(tenantSchoolPartition(schoolId), contactKey(email));
  return row?.googleEmail || "";
}

export async function getTenantLineRecipient(schoolId, email, botUserId) {
  if (!email || !botUserId) return null;
  const row = await read(tenantSchoolPartition(schoolId), emailKey(email));
  return row?.botUserId === botUserId && row.lineUserId ? row : null;
}

export async function getOrCreateTenantLineAccount(schoolId, botUserId, userId, displayName) {
  const existing = await getTenantLineAccount(schoolId, botUserId, userId);
  if (existing) return existing;
  const partitionKey = tenantSchoolPartition(schoolId);
  const row = {
    partitionKey, rowKey: lineKey(botUserId, userId), botUserId, lineUserId: userId,
    parentEmail: "line-" + randomUUID() + "@line.invalid",
    displayName: String(displayName || "").slice(0, 100), linkedAt: new Date().toISOString()
  };
  const db = await writableStore();
  try {
    await db.submitTransaction([["create", row], ["create", {...row, rowKey: emailKey(row.parentEmail)}]]);
    return getTenantLineAccount(schoolId, botUserId, userId);
  } catch (error) {
    if (error.statusCode !== 409) throw error;
    const winner = await getTenantLineAccount(schoolId, botUserId, userId);
    if (!winner) throw error;
    return winner;
  }
}

export class LineAccountConflict extends Error {}

async function hasParentHistory(schoolId, email) {
  const [students, registrations] = await Promise.all([
    getMappedStudentsByEmail(email, schoolId), getRegistrationsByEmail(email, schoolId)
  ]);
  return Boolean(students.length || registrations.length);
}

export async function linkTenantGoogle(schoolId, line, google) {
  const partitionKey = tenantSchoolPartition(schoolId);
  const [googleLink, oldParentIndex] = await Promise.all([
    getTenantGoogleLink(schoolId, google.sub), read(partitionKey, emailKey(line.parentEmail))
  ]);
  if (line.googleSub === google.sub && googleLink?.lineUserId === line.lineUserId) return line;
  if (line.googleSub || googleLink?.lineUserId || !oldParentIndex) {
    throw new LineAccountConflict("其中一個帳號已有其他 LINE 或 Gmail 綁定");
  }
  const googleParent = googleLink?.parentEmail || google.email;
  const [lineHistory, googleHistory] = await Promise.all([
    hasParentHistory(schoolId, line.parentEmail), hasParentHistory(schoolId, googleParent)
  ]);
  let legacyParents = {};
  if (schoolId === defaultTenantId()) {
    try { legacyParents = JSON.parse(process.env.STUDENT_MAP_JSON || "{}") || {}; } catch {}
  }
  if (lineHistory && (googleHistory || legacyParents[googleParent])) {
    throw new LineAccountConflict("兩個帳號各有學生紀錄，請由本校管理員確認後處理");
  }
  const parentEmail = lineHistory ? line.parentEmail : googleParent;
  const next = {
    partitionKey, rowKey: line.rowKey, botUserId: line.botUserId, lineUserId: line.lineUserId,
    parentEmail, googleSub: google.sub, googleEmail: google.email,
    displayName: line.displayName, linkedAt: new Date().toISOString()
  };
  const emailRow = {...next, rowKey: emailKey(parentEmail)};
  const googleRow = {...next, rowKey: googleKey(google.sub)};
  const actions = [
    ["update", next, "Replace", {etag: line.etag}],
    googleLink ? ["update", googleRow, "Replace", {etag: googleLink.etag}] : ["create", googleRow]
  ];
  if (parentEmail === line.parentEmail) {
    actions.push(["update", emailRow, "Replace", {etag: oldParentIndex.etag}]);
  } else {
    actions.push(["create", emailRow], ["delete", oldParentIndex]);
  }
  if (parentEmail.endsWith("@line.invalid")) {
    const existingContact = await read(partitionKey, contactKey(parentEmail));
    if (existingContact && existingContact.googleSub !== google.sub) {
      throw new LineAccountConflict("此校家長帳號已連結其他 Gmail");
    }
    const contact = {partitionKey, rowKey: contactKey(parentEmail), googleSub: google.sub, googleEmail: google.email};
    actions.push(existingContact ? ["update", contact, "Replace", {etag: existingContact.etag}] : ["create", contact]);
  }
  try {
    await (await writableStore()).submitTransaction(actions);
    return next;
  } catch (error) {
    if ([409, 412].includes(error.statusCode)) throw new LineAccountConflict("此校綁定狀態已變更，請重新登入");
    throw error;
  }
}

export async function unlinkTenantGoogle(schoolId, googleSub) {
  const row = await getTenantGoogleLink(schoolId, googleSub);
  if (!row?.lineUserId) return null;
  const identity = await getTenantLineAccount(schoolId, row.botUserId, row.lineUserId);
  const target = await read(row.partitionKey, emailKey(row.parentEmail));
  if (identity?.googleSub !== googleSub || target?.googleSub !== googleSub) {
    throw new LineAccountConflict("此校綁定狀態已變更，請重新登入");
  }
  await (await writableStore()).submitTransaction([
    ["update", {partitionKey: row.partitionKey, rowKey: row.rowKey, parentEmail: row.parentEmail,
      googleSub, googleEmail: row.googleEmail}, "Replace", {etag: row.etag}],
    ["delete", identity],
    ["delete", target]
  ]);
  return identity;
}

function readCookie(request, name) {
  for (const pair of (request.headers.get("cookie") || "").split(";")) {
    const [key, value] = pair.trim().split("=", 2);
    if (key === name && /^[A-Za-z0-9_-]{43}$/.test(value || "")) return value;
  }
  return "";
}

export function lineCookie(name, value, maxAge) {
  return {name, value, maxAge, sameSite: "Lax", path: "/", secure: true, httpOnly: true};
}

export function lineSessionCookie(value) {
  return lineCookie(sessionCookieName, value, value ? sessionDuration : 0);
}

export async function createTenantLineSession(schoolId, account) {
  const token = lineRandom();
  await (await writableStore()).createEntity({
    partitionKey: "session", rowKey: lineHash(token), schoolId, botUserId: account.botUserId,
    lineUserId: account.lineUserId, parentEmail: account.parentEmail, expires: Date.now() + sessionDuration * 1000
  });
  return token;
}

export async function tenantLineSession(request) {
  const token = readCookie(request, sessionCookieName);
  if (!token) return null;
  const row = await read("session", lineHash(token));
  if (!row || row.expires <= Date.now()) return null;
  const account = await getTenantLineAccount(row.schoolId, row.botUserId, row.lineUserId);
  if (!account || account.parentEmail !== row.parentEmail) return null;
  return {schoolId: row.schoolId, account, sessionId: row.rowKey};
}

export async function clearTenantLineSession(request) {
  const token = readCookie(request, sessionCookieName);
  if (!token) return;
  try {
    await store().deleteEntity("session", lineHash(token));
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
}

const oauthCookieName = "__Host-school-line-oauth";
export async function createTenantLineOAuth(schoolId, config, google) {
  const state = lineRandom(), verifier = lineRandom(), nonce = lineRandom();
  await (await writableStore()).createEntity({
    partitionKey: "oauth-" + tenantSchoolPartition(schoolId), rowKey: lineHash(state),
    verifier, nonce, configVersion: config.oauthVersion,
    googleSub: google?.sub || "", googleEmail: google?.email || "", expires: Date.now() + 600000
  });
  return {state, verifier, nonce, cookie: lineCookie(oauthCookieName, state, 600)};
}

export function clearOAuthCookie() {
  return lineCookie(oauthCookieName, "", 0);
}

export async function useTenantLineOAuth(request, schoolId, state, config) {
  if (!state || state !== readCookie(request, oauthCookieName)) return null;
  const partitionKey = "oauth-" + tenantSchoolPartition(schoolId);
  const row = await read(partitionKey, lineHash(state));
  if (!row || row.expires <= Date.now() || row.configVersion !== config.oauthVersion) return null;
  try {
    await store().deleteEntity(partitionKey, row.rowKey, {etag: row.etag});
    return row;
  } catch (error) {
    if ([404, 412].includes(error.statusCode)) return null;
    throw error;
  }
}
