import {createHash, randomBytes, randomUUID} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {defaultTenantId, getMappedStudentsByEmail, getRegistrationsByEmail, tenantSchoolPartition} from "./storage.js";
import {lineApi} from "./lineMessaging.mjs";

const name = "TenantLineIdentity";
let database;
let initialized;
const deliveryBotProofs=new Map();
export const lineHash = value => createHash("sha256").update(value).digest("hex");
export const lineRandom = () => randomBytes(32).toString("base64url");
const lineKey = (botUserId, userId) => "line-" + lineHash(botUserId + ":" + userId);
const friendshipKey = (botUserId, userId) => "friend-" + lineHash(botUserId + ":" + userId);
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

// Delivery-only compatibility. It never creates a login, identity, or role, and
// the stricter account lookup above remains authoritative for authentication.
export async function getTenantLineDeliveryRecipient(schoolId, email, channel) {
  const partitionKey=tenantSchoolPartition(schoolId),address=String(email||"").trim().toLowerCase();
  if(!address||channel?.schoolId!==partitionKey||!channel.botUserId)return null;
  const current=await read(partitionKey,emailKey(address));
  if(current){
    // This marker is a computed delivery proof, never authority stored in an
    // email index (including a historical alias or an explicit unlink row).
    const {verifiedGoogleEmail,...account}=current;
    return current.botUserId===channel.botUserId&&current.lineUserId?account:null;
  }
  const safe=address.replaceAll("'","''"),modern=[];
  for await(const row of store().listEntities({queryOptions:{filter:`PartitionKey eq '${partitionKey.replaceAll("'","''")}' and googleEmail eq '${safe}'`}})){
    if(String(row.googleEmail||"").trim().toLowerCase()===address)modern.push(row);
  }
  if(modern.length){
    // LINE-first enrollment intentionally keeps the LINE parent identity. Its
    // verified Gmail has a Google-sub index but need not have an email index.
    // Resolve that existing binding only when all three current indices agree.
    const candidates=modern.filter(row=>typeof row.googleSub==="string"&&row.googleSub&&row.rowKey===googleKey(row.googleSub));
    if(candidates.length!==1)return null;
    const index=candidates[0],parent=String(index.parentEmail||"").trim().toLowerCase(),sub=index.googleSub,userId=index.lineUserId;
    if(!parent||parent!==index.parentEmail||!/^U[0-9a-f]{32}$/i.test(userId||""))return null;
    const matches=row=>row&&row.partitionKey===partitionKey&&(!row.schoolId||row.schoolId===partitionKey)&&
      row.botUserId===channel.botUserId&&row.lineUserId===userId&&row.parentEmail===parent&&row.googleSub===sub&&row.googleEmail===address;
    const keys=new Set([googleKey(sub),lineKey(channel.botUserId,userId),emailKey(parent),...(index.parentAlias?[emailKey(index.parentAlias)]:[])]);
    const contact=contactKey(index.parentAlias||parent);
    for(const row of modern){
      if(row.rowKey===contact){
        if(row.partitionKey!==partitionKey||row.schoolId&&row.schoolId!==partitionKey||row.googleSub!==sub||row.googleEmail!==address||
          row.botUserId&&row.botUserId!==channel.botUserId||row.linkedParentEmail&&row.linkedParentEmail!==parent||
          row.lineUserId&&row.lineUserId!==userId||row.parentEmail&&row.parentEmail!==parent)return null;
      }else if(!keys.has(row.rowKey)||!matches(row))return null;
    }
    if(!matches(index))return null;
    const [identity,parentIndex]=await Promise.all([
      read(partitionKey,lineKey(channel.botUserId,userId)),read(partitionKey,emailKey(parent))
    ]);
    if(!matches(identity)||identity.rowKey!==lineKey(channel.botUserId,userId)||!matches(parentIndex)||parentIndex.rowKey!==emailKey(parent))return null;
    return {...identity,verifiedGoogleEmail:address};
  }
  if(!["","production"].includes(String(process.env.LAB_ENVIRONMENT||"").trim().toLowerCase())||
    partitionKey!==defaultTenantId()||channel.configured!==true||channel.acceptsLegacy!==true||!channel.accessToken)return null;
  try{
    // A modern Google index, including an explicit unlink marker, must never
    // be silently revived from the older binding table.
    const old=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,process.env.LINE_ACCOUNT_BINDING_TABLE||"TenantLineAccountBinding");
    const binding=await old.getEntity(partitionKey,"email_"+lineHash(address).slice(0,40));
    const userId=binding.lineUserId;
    if(binding.status!=="ACTIVE"||binding.schoolId!==partitionKey||binding.parentEmail!==address||
      !/^U[0-9a-f]{32}$/i.test(userId||"")||binding.lineUserIdHash!==lineHash(userId)||
      binding.botUserId&&binding.botUserId!==channel.botUserId)return null;
    const proofKey=lineHash(channel.accessToken)+":"+channel.botUserId;
    let proof=deliveryBotProofs.get(proofKey);
    if(!proof||proof.expires<=Date.now()){
      if(deliveryBotProofs.size>=100)deliveryBotProofs.clear();
      proof={expires:Date.now()+60000,result:lineApi("/v2/bot/info",{method:"GET",accessToken:channel.accessToken,timeoutMs:3000})};
      deliveryBotProofs.set(proofKey,proof);
    }
    let bot;try{bot=await proof.result}catch(error){deliveryBotProofs.delete(proofKey);throw error}
    if(bot?.userId!==channel.botUserId)return null;
    const profile=await lineApi("/v2/bot/profile/"+encodeURIComponent(userId),{method:"GET",accessToken:channel.accessToken,timeoutMs:3000});
    if(profile?.userId!==userId)return null;
    return {parentEmail:address,lineUserId:userId,botUserId:channel.botUserId,displayName:String(profile.displayName||binding.lineDisplayName||"").slice(0,100),deliveryOnly:true};
  }catch{return null}
}

export async function recordTenantLineFriendship(schoolId, botUserId, userId, friend, checkedAt) {
  if (!botUserId || !/^U[0-9a-f]{32}$/i.test(userId) || typeof friend !== "boolean" || !Number.isFinite(checkedAt)) return;
  const partitionKey = tenantSchoolPartition(schoolId), rowKey = friendshipKey(botUserId, userId);
  const db = await writableStore();
  const next = {partitionKey, rowKey, botUserId, friend, checkedAt};
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = await read(partitionKey, rowKey);
    if (old && (old.checkedAt > checkedAt || (old.checkedAt === checkedAt && (!old.friend || friend)))) return;
    try {
      if (old) await db.updateEntity(next, "Replace", {etag: old.etag});
      else await db.createEntity(next);
      return;
    } catch (error) {
      if (![409, 412].includes(error.statusCode) || attempt === 2) throw error;
    }
  }
}

export async function getTenantLineFriendship(schoolId, botUserId, userId) {
  if (!botUserId || !/^U[0-9a-f]{32}$/i.test(userId || "")) return {status: "unknown", checkedAt: null};
  const row = await read(tenantSchoolPartition(schoolId), friendshipKey(botUserId, userId));
  if (!row || row.botUserId !== botUserId || typeof row.friend !== "boolean" || !Number.isFinite(row.checkedAt)) {
    return {status: "unknown", checkedAt: null};
  }
  return {status: row.friend ? "friend" : "not_friend", checkedAt: row.checkedAt};
}

export async function listTenantLineRecipientStatuses(schoolId, botUserId) {
  const partition = tenantSchoolPartition(schoolId).replaceAll("'", "''");
  const bot = botUserId.replaceAll("'", "''");
  const scope = `PartitionKey eq '${partition}' and botUserId eq '${bot}'`;
  async function rows(prefix, select) {
    const filter = `${scope} and RowKey ge '${prefix}-' and RowKey lt '${prefix}.'`;
    const result = [];
    try {
      for await (const row of store().listEntities({queryOptions: {filter, select}})) result.push(row);
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
    return result;
  }
  const [recipients, friendships, historicalParents] = await Promise.all([
    rows("email", ["parentEmail", "lineUserId", "googleEmail", "lookupEmail"]),
    rows("friend", ["RowKey", "friend", "checkedAt"]),
    rows("contact", ["lookupEmail", "linkedParentEmail"])
  ]);
  const byUser = new Map(friendships.map(row => [row.rowKey, row]));
  const statuses = new Map(recipients.filter(row => row.parentEmail && row.lineUserId).map(row => {
    const entry = byUser.get(friendshipKey(botUserId, row.lineUserId));
    return [row.lookupEmail || row.parentEmail, {
      ...(row.lookupEmail ? {linkedParentEmail: row.parentEmail} : {}),
      ...(row.googleEmail ? {googleEmail: row.googleEmail} : {}),
      status: entry ? (entry.friend ? "friend" : "not_friend") : "unknown",
      checkedAt: entry?.checkedAt || null
    }];
  }));
  for (const row of historicalParents) {
    if (row.lookupEmail && row.linkedParentEmail && !statuses.has(row.lookupEmail)) {
      statuses.set(row.lookupEmail, {linkedParentEmail: row.linkedParentEmail});
    }
  }
  return statuses;
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

async function readParentHistory(schoolId, email) {
  const [students, registrations] = await Promise.all([
    getMappedStudentsByEmail(email, schoolId), getRegistrationsByEmail(email, schoolId)
  ]);
  return {
    present: Boolean(students.length || registrations.length),
    studentIds: new Set(students.map(student => student.studentId).filter(Boolean))
  };
}

export async function linkTenantGoogle(schoolId, line, google, {requireAbsentGoogleLink=false}={}) {
  const partitionKey = tenantSchoolPartition(schoolId);
  const [googleLink, oldParentIndex] = await Promise.all([
    getTenantGoogleLink(schoolId, google.sub), read(partitionKey, emailKey(line.parentEmail))
  ]);
  if (line.googleSub === google.sub && googleLink?.lineUserId === line.lineUserId) return line;
  if (line.googleSub || googleLink?.lineUserId || (requireAbsentGoogleLink && googleLink) || !oldParentIndex) {
    throw new LineAccountConflict("其中一個帳號已有其他 LINE 或 Gmail 綁定");
  }
  const googleParent = googleLink?.parentEmail || google.email;
  const [lineHistory, googleHistory] = await Promise.all([
    readParentHistory(schoolId, line.parentEmail), readParentHistory(schoolId, googleParent)
  ]);
  let legacyParents = {};
  if (schoolId === defaultTenantId()) {
    try { legacyParents = JSON.parse(process.env.STUDENT_MAP_JSON || "{}") || {}; } catch {}
  }
  // Keep the Gmail enrollment authoritative when two verified logins already enroll the same students.
  const sameStudents = lineHistory.studentIds.size > 0 &&
    lineHistory.studentIds.size === googleHistory.studentIds.size &&
    [...lineHistory.studentIds].every(id => googleHistory.studentIds.has(id));
  const joinExisting = sameStudents && !legacyParents[googleParent] &&
    /^line-[a-f0-9-]{36}@line\.invalid$/.test(line.parentEmail) && googleParent === google.email &&
    (!googleLink?.parentAlias || googleLink.parentAlias === line.parentEmail);
  if (lineHistory.present && (googleHistory.present || legacyParents[googleParent]) && !joinExisting) {
    throw new LineAccountConflict("兩個帳號各有學生紀錄，請由本校管理員確認後處理");
  }
  const parentEmail = lineHistory.present && !joinExisting ? line.parentEmail : googleParent;
  const parentAlias = joinExisting ? line.parentEmail : googleLink?.parentAlias;
  const next = {
    partitionKey, rowKey: line.rowKey, botUserId: line.botUserId, lineUserId: line.lineUserId,
    parentEmail, googleSub: google.sub, googleEmail: google.email,
    ...(parentAlias ? {parentAlias} : {}),
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
    actions.push(["create", emailRow]);
    if (!joinExisting) actions.push(["delete", oldParentIndex]);
  }
  if (parentAlias) {
    const aliasRow = {...next, rowKey: emailKey(parentAlias), lookupEmail: parentAlias};
    actions.push(joinExisting ? ["update", aliasRow, "Replace", {etag: oldParentIndex.etag}] : ["create", aliasRow]);
  }
  const contactEmail = parentAlias || parentEmail;
  if (contactEmail.endsWith("@line.invalid")) {
    const existingContact = await read(partitionKey, contactKey(contactEmail));
    if (existingContact && existingContact.googleSub !== google.sub) {
      throw new LineAccountConflict("此校家長帳號已連結其他 Gmail");
    }
    const contact = {
      partitionKey, rowKey: contactKey(contactEmail), googleSub: google.sub, googleEmail: google.email,
      ...(parentAlias ? {botUserId: line.botUserId, lookupEmail: parentAlias, linkedParentEmail: parentEmail} : {})
    };
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
  const alias = row.parentAlias ? await read(row.partitionKey, emailKey(row.parentAlias)) : null;
  if (identity?.googleSub !== googleSub || target?.googleSub !== googleSub ||
      (row.parentAlias && (alias?.googleSub !== googleSub || alias.parentEmail !== row.parentEmail))) {
    throw new LineAccountConflict("此校綁定狀態已變更，請重新登入");
  }
  await (await writableStore()).submitTransaction([
    ["update", {partitionKey: row.partitionKey, rowKey: row.rowKey, parentEmail: row.parentEmail,
      googleSub, googleEmail: row.googleEmail, ...(row.parentAlias ? {parentAlias: row.parentAlias} : {})},
      "Replace", {etag: row.etag}],
    ["delete", identity],
    ["delete", target],
    ...(alias ? [["delete", alias]] : [])
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
export async function createTenantLineOAuth(schoolId, config, google, {returnTo, purpose, expectedLineUserId, expectedParentEmail, expectedGoogleSub, friendshipInitiator} = {}) {
  const friendship = purpose === "friendship";
  if (purpose !== undefined && !friendship) throw new Error("Invalid LINE OAuth purpose");
  if (friendship && (!/^U[0-9a-f]{32}$/i.test(expectedLineUserId || "") || !expectedParentEmail ||
      !["google", "line"].includes(friendshipInitiator) || friendshipInitiator === "google" && !google?.sub)) throw new Error("Invalid LINE friendship identity");
  if (returnTo !== undefined && (!["notification-center", "teacher-account", "parent-account"].includes(returnTo) || !google?.sub)) throw new Error("Invalid LINE account return destination");
  const state = lineRandom(), verifier = lineRandom(), nonce = lineRandom();
  await (await writableStore()).createEntity({
    partitionKey: "oauth-" + tenantSchoolPartition(schoolId), rowKey: lineHash(state),
    verifier, nonce, configVersion: config.oauthVersion,
    googleSub: google?.sub || "", googleEmail: google?.email || "", expires: Date.now() + 600000,
    ...(friendship ? {purpose, expectedLineUserId, expectedParentEmail, expectedGoogleSub: expectedGoogleSub || "", friendshipInitiator} : {}),
    ...(["notification-center", "teacher-account", "parent-account"].includes(returnTo) ? {returnTo} : {})
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

const linkConfirmationCookie = "__Host-school-line-link";

export function clearTenantLineLinkConfirmation() {
  return lineCookie(linkConfirmationCookie, "", 0);
}

export async function createTenantLineLinkConfirmation(schoolId, account, google, initiatedBy) {
  const token = lineRandom();
  const confirmationId = lineHash(token);
  await (await writableStore()).createEntity({
    partitionKey: "link-" + tenantSchoolPartition(schoolId), rowKey: confirmationId,
    botUserId: account.botUserId, lineUserId: account.lineUserId, lineDisplayName: account.displayName || "",
    googleSub: google.sub, googleEmail: google.email, initiatedBy, expires: Date.now() + 300000
  });
  return {cookie: lineCookie(linkConfirmationCookie, token, 300), confirmationId};
}

export async function readTenantLineLinkConfirmation(request, channel, google, line, confirmationId) {
  const token = readCookie(request, linkConfirmationCookie);
  if (!token) return null;
  const partitionKey = "link-" + tenantSchoolPartition(channel.schoolId);
  const row = await read(partitionKey, lineHash(token));
  if (!row || row.expires <= Date.now() || row.botUserId !== channel.botUserId) return null;
  const matches = row.initiatedBy === "google"
    ? row.googleSub === google?.sub && row.googleEmail === google?.email
    : row.initiatedBy === "line" && row.lineUserId === line?.lineUserId && row.botUserId === line?.botUserId;
  if (!matches) return null;
  if (confirmationId !== undefined) {
    if (row.rowKey !== confirmationId) return null;
    try {
      await store().deleteEntity(partitionKey, row.rowKey, {etag: row.etag});
    } catch (error) {
      if ([404, 412].includes(error.statusCode)) return null;
      throw error;
    }
  }
  return row;
}
