import {createHash} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {defaultTenantId, getTenantDirectory, tenantSchoolPartition} from "./storage.js";
import {lineApi} from "./lineMessaging.mjs";

const partitionKey = "line";
const schoolRow = schoolId => `school-${schoolId}`;
const fingerprint = value => createHash("sha256").update(value).digest("hex");

function table() {
  return TableClient.fromConnectionString(
    process.env.STORAGE_CONNECTION_STRING,
    process.env.TENANT_LINE_CHANNEL_CONFIG_TABLE || "TenantLineChannelConfig"
  );
}

async function read(client, rowKey) {
  try {
    return await client.getEntity(partitionKey, rowKey);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    return null;
  }
}

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : "";
  } catch { return ""; }
}

export function tenantFeeEnabled(schoolId) {
  const prefix = "LINE_" + tenantSchoolPartition(schoolId).replaceAll("-", "_").toUpperCase();
  return process.env[prefix + "_FEE_COLLECTIONS_ENABLED"] === "true";
}

function credentials(schoolId, legacy = false) {
  const prefix = legacy ? "LINE" : `LINE_${schoolId.replaceAll("-", "_").toUpperCase()}`;
  const setting = key => (process.env[`${prefix}_${key}`] || "").trim();
  const loginId = setting("LOGIN_CHANNEL_ID"), loginSecret = setting("LOGIN_CHANNEL_SECRET");
  const appOrigin = httpsOrigin(setting("APP_ORIGIN"));
  const loginFingerprint = !legacy && /^\d{6,20}$/.test(loginId) && loginSecret && appOrigin
    ? fingerprint(JSON.stringify([loginId, loginSecret, appOrigin])) : "";
  return {
    channelSecret: setting("CHANNEL_SECRET"), accessToken: setting("CHANNEL_ACCESS_TOKEN"),
    loginId, loginSecret, loginFingerprint, appOrigin,
    parentMenuId: setting("PARENT_RICH_MENU_ID"), staffMenuId: setting("STAFF_RICH_MENU_ID"),
    paymentLineEnabled: setting("PAYMENT_NOTIFICATIONS_ENABLED") === "true"
  };
}

export async function resolveTenantLineChannel(schoolId) {
  const id = tenantSchoolPartition(schoolId);
  const [tenant, row] = await Promise.all([getTenantDirectory(id), read(table(), schoolRow(id))]);
  const legacy = id === defaultTenantId() && !row;
  const {channelSecret, accessToken, loginId, loginSecret, loginFingerprint, appOrigin, parentMenuId, staffMenuId, paymentLineEnabled} = credentials(id, legacy);
  const status = row?.status || (legacy && channelSecret && accessToken ? "active" : "setup");
  const configured = Boolean(
    (tenant?.status === "active" || tenant?.status === "onboarding") &&
    status === "active" && channelSecret && accessToken &&
    (legacy || (row.secretFingerprint === fingerprint(channelSecret) &&
      row.tokenFingerprint === fingerprint(accessToken)))
  );
  const loginConfigured = Boolean(configured && row?.botUserId && loginFingerprint && loginFingerprint === row?.loginFingerprint);
  return {
    schoolId: id, status, configured, legacy, acceptsLegacy: legacy || (id === defaultTenantId() && row?.acceptsLegacy === true),
    platformName: tenant?.systemName || tenant?.schoolName || "學校平台", botUserId: row?.botUserId || "",
    channelSecret: configured ? channelSecret : "",
    accessToken: configured ? accessToken : "",
    hasSecret: Boolean(channelSecret), hasToken: Boolean(accessToken),
    loginConfigured, loginId: loginConfigured ? loginId : "",
    loginSecret: loginConfigured ? loginSecret : "", appOrigin: loginConfigured ? appOrigin : "",
    oauthVersion: loginConfigured ? fingerprint(row.botUserId + loginFingerprint) : "",
    parentMenuId, staffMenuId, paymentLineEnabled
  };
}

export class LineConfigError extends Error {}

export async function saveTenantLineChannel(schoolId, status, actor) {
  const id = tenantSchoolPartition(schoolId);
  if (!["setup", "active", "disabled"].includes(status)) {
    throw new LineConfigError("狀態須為 setup、active 或 disabled");
  }

  const client = table();
  try {
    await client.createTable();
  } catch (error) {
    if (error.statusCode !== 409) throw error;
  }
  const old = await read(client, schoolRow(id));
  const row = {
    partitionKey, rowKey: schoolRow(id), status,
    botUserId: old?.botUserId || "", acceptsLegacy: old?.acceptsLegacy === true,
    secretFingerprint: old?.secretFingerprint || "",
    tokenFingerprint: old?.tokenFingerprint || "", loginFingerprint: old?.loginFingerprint || "", updatedBy: actor,
    updatedAt: new Date().toISOString()
  };
  const actions = [];
  const tenant = await getTenantDirectory(id);
  if (status === "active" && !["active", "onboarding"].includes(tenant?.status)) {
    throw new LineConfigError("學校須處於正式啟用或隔離驗證狀態");
  }
  if (status === "active") {
    const {channelSecret, accessToken, loginId, loginFingerprint} = credentials(id);
    if (!channelSecret || !accessToken) throw new LineConfigError("請先設定該校的 LINE 憑證");

    const legacy = credentials(defaultTenantId(), true);
    if (id !== defaultTenantId() && (channelSecret === legacy.channelSecret || accessToken === legacy.accessToken)) {
      throw new LineConfigError("此憑證已用於聖心現有 LINE 官方帳號");
    }
    try {
      const bot = await lineApi("/v2/bot/info", {method: "GET", accessToken});
      if (!/^U[0-9a-f]{32}$/i.test(bot.userId || "")) throw new Error("Missing bot user ID");
      row.botUserId = bot.userId.toLowerCase().replace(/^u/, "U");
      row.acceptsLegacy = id === defaultTenantId() &&
        Boolean(old?.acceptsLegacy && old.botUserId === row.botUserId);
      if (legacy.accessToken) {
        const legacyBot = accessToken === legacy.accessToken
          ? bot : await lineApi("/v2/bot/info", {method: "GET", accessToken: legacy.accessToken});
        if (!/^U[0-9a-f]{32}$/i.test(legacyBot.userId || "")) throw new Error("Missing legacy bot user ID");
        const sameBot = row.botUserId.toLowerCase() === legacyBot.userId.toLowerCase();
        if (sameBot && id !== defaultTenantId()) throw new LineConfigError("此 LINE 官方帳號已用於聖心");
        if (sameBot) row.acceptsLegacy = true;
      }
    } catch (error) {
      if (error instanceof LineConfigError) throw error;
      throw new LineConfigError("無法驗證 LINE 官方帳號，請確認 Access Token 有效");
    }
    row.secretFingerprint = fingerprint(channelSecret);
    row.tokenFingerprint = fingerprint(accessToken);
    row.loginFingerprint = loginFingerprint;
    const reservations = [`bot-${row.botUserId}`, `secret-${row.secretFingerprint}`];
    if (loginFingerprint) reservations.push(`login-${loginId}`);
    for (const rowKey of reservations) {
      const owner = await read(client, rowKey);
      if (owner && owner.schoolId !== id) throw new LineConfigError("此 LINE 官方帳號或憑證已由其他學校使用");
      if (!owner) actions.push(["create", {partitionKey, rowKey, schoolId: id}]);
    }
  }
  actions.push(old ? ["update", row, "Replace", {etag: old.etag}] : ["create", row]);
  try {
    await client.submitTransaction(actions);
  } catch (error) {
    if (error.statusCode === 409 || error.statusCode === 412) {
      throw new LineConfigError("設定已變更，請重新載入再試");
    }
    throw error;
  }
}

export function lineTargetMatchesChannel(target, channel) {
  return Boolean(target.targetId && (target.botUserId
    ? target.botUserId === channel.botUserId
    : channel.acceptsLegacy));
}

export function tenantWebhookPath(channel) {
  return channel.legacy ? "/api/line/webhook" : `/api/line/webhook/${encodeURIComponent(channel.schoolId)}`;
}
