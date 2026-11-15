import {app} from "@azure/functions";
import {getAccess, json} from "../lib/auth.js";
import {getTenantDirectory, tenantIdValue} from "../lib/storage.js";
import {
  LineConfigError, resolveTenantLineChannel, saveTenantLineChannel, tenantWebhookPath
} from "../lib/lineTenantConfig.js";

app.http("tenantLineChannelConfig", {
  methods: ["GET", "PATCH"], authLevel: "anonymous", route: "line/tenant-config/{schoolId}",
  handler: async request => {
    const access = await getAccess(request);
    if (!access.authenticated) return json({error: "Unauthorized"}, 401);
    if (access.capabilities?.globalAdmin !== true) return json({error: "Global Admin 權限不足"}, 403);

    const schoolId = request.params.schoolId;
    if (!schoolId || tenantIdValue(schoolId) !== schoolId) return json({error: "學校不存在"}, 404);
    try {
      if (!await getTenantDirectory(schoolId)) return json({error: "學校不存在"}, 404);
      if (request.method === "PATCH") {
        let body;
        try { body = await request.json(); } catch { return json({error: "JSON 格式不正確"}, 400); }
        if (!body || typeof body.status !== "string" || Object.keys(body).length !== 1) {
          return json({error: "僅接受 LINE 啟用狀態"}, 400);
        }
        await saveTenantLineChannel(schoolId, body.status, access.email);
      }
      const channel = await resolveTenantLineChannel(schoolId);
      return json({
        schoolId, status: channel.status, legacy: channel.legacy, acceptsLegacy: channel.acceptsLegacy,
        messagingConfigured: channel.configured, channelSecretConfigured: channel.hasSecret,
        accessTokenConfigured: channel.hasToken, loginConfigured: channel.loginConfigured,
        loginCallback: channel.loginConfigured ? channel.appOrigin + "/api/line/tenant-login/" + schoolId + "/callback" : "",
        webhookUrl: new URL(tenantWebhookPath(channel), request.url).toString()
      });
    } catch (error) {
      if (error instanceof LineConfigError) return json({error: error.message}, 409);
      console.error("Tenant LINE config failed", {schoolId, status: error?.statusCode});
      return json({error: "LINE 設定處理失敗"}, 500);
    }
  }
});
