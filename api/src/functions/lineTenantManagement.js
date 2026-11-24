import {app} from "@azure/functions";
import {tenantEmailConfig} from "../lib/tenantEmailConfig.mjs";
import {getAccess, json} from "../lib/auth.js";
import {getTenantDirectory, tenantIdValue} from "../lib/storage.js";
import {
  LineConfigError, resolveTenantLineChannel, saveTenantLineChannel, tenantWebhookLinks,
  listTenantLineMenus, saveTenantLineMenus
} from "../lib/lineTenantConfig.js";

function privateJson(body, status = 200) {
  const response = json(body, status);
  return {...response, headers: {...response.headers, "Cache-Control": "no-store"}};
}

app.http("tenantLineChannelConfig", {
  methods: ["GET", "PATCH"], authLevel: "anonymous", route: "line/tenant-config/{schoolId}",
  handler: async request => {
    const access = await getAccess(request);
    if (!access.authenticated) return privateJson({error: "Unauthorized"}, 401);
    if (access.capabilities?.globalAdmin !== true) return privateJson({error: "Global Admin 權限不足"}, 403);

    const schoolId = request.params.schoolId;
    if (!schoolId || tenantIdValue(schoolId) !== schoolId) return privateJson({error: "學校不存在"}, 404);
    try {
      if (!await getTenantDirectory(schoolId)) return privateJson({error: "學校不存在"}, 404);
      if (request.method === "PATCH") {
        let body;
        try { body = await request.json(); } catch { return privateJson({error: "JSON 格式不正確"}, 400); }
        if (!body || typeof body.status !== "string" || Object.keys(body).length !== 1) {
          return privateJson({error: "僅接受 LINE 啟用狀態"}, 400);
        }
        await saveTenantLineChannel(schoolId, body.status, access.email);
      }
      const channel = await resolveTenantLineChannel(schoolId);
      const email = tenantEmailConfig(schoolId);
      return privateJson({
        email: {mode: email.mode, configured: Boolean(email.connectionString)},
        schoolId, status: channel.status, legacy: channel.legacy, acceptsLegacy: channel.acceptsLegacy,
        messagingConfigured: channel.configured, channelSecretConfigured: channel.hasSecret,
        accessTokenConfigured: channel.hasToken, loginConfigured: channel.loginConfigured,
        loginCallback: channel.loginConfigured ? channel.appOrigin + "/api/line/tenant-login/" + schoolId + "/callback" : "",
        ...tenantWebhookLinks(channel)
      });
    } catch (error) {
      if (error instanceof LineConfigError) return privateJson({error: error.message}, 409);
      console.error("Tenant LINE config failed", {schoolId, status: error?.statusCode});
      return privateJson({error: "LINE 設定處理失敗"}, 500);
    }
  }
});

app.http("tenantLineChannelMenus", {
  methods: ["GET", "PATCH"], authLevel: "anonymous", route: "line/tenant-config/{schoolId}/menus",
  handler: async request => {
    const access = await getAccess(request);
    if (!access.authenticated) return privateJson({error: "Unauthorized"}, 401);
    if (access.capabilities?.globalAdmin !== true) return privateJson({error: "Global Admin 權限不足"}, 403);
    const schoolId = request.params.schoolId;
    if (!schoolId || tenantIdValue(schoolId) !== schoolId) return privateJson({error: "學校不存在"}, 404);
    try {
      if (!await getTenantDirectory(schoolId)) return privateJson({error: "學校不存在"}, 404);
      if (request.method === "PATCH") {
        let body;
        try { body = await request.json(); } catch { return privateJson({error: "JSON 格式不正確"}, 400); }
        if (!body || typeof body.parentMenuId !== "string" || typeof body.staffMenuId !== "string" || Object.keys(body).length !== 2) {
          return privateJson({error: "僅接受家長與幹部選單 ID"}, 400);
        }
        return privateJson(await saveTenantLineMenus(schoolId, body, access.email));
      }
      return privateJson(await listTenantLineMenus(schoolId));
    } catch (error) {
      if (error instanceof LineConfigError) return privateJson({error: error.message}, 409);
      console.error("Tenant LINE menu config failed", {schoolId, status: error?.statusCode});
      return privateJson({error: "LINE 選單設定處理失敗"}, 500);
    }
  }
});
