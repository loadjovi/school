import {app} from "@azure/functions";
import {tenantIdValue} from "../lib/storage.js";
import {resolveTenantLineChannel} from "../lib/lineTenantConfig.js";
import {tenantFacebookUrl} from "../lib/lineFacebookConfig.js";

const headers = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"};

app.http("tenantLineFacebook", {
  methods: ["GET"], authLevel: "anonymous", route: "line/facebook/{schoolId}",
  handler: async request => {
    const schoolId = request.params.schoolId;
    if (!schoolId || tenantIdValue(schoolId) !== schoolId) return {status: 404, headers};
    try {
      const channel = await resolveTenantLineChannel(schoolId);
      const destination = channel.configured && tenantFacebookUrl(channel.facebookUrl);
      if (!destination) return {status: 404, headers, body: "此校尚未啟用 Facebook 活動影音連結。"};
      // The caller cannot supply or replace the destination. It is school-scoped
      // configuration saved through the authenticated Global apply action.
      return {status: 303, headers: {...headers, Location: destination}};
    } catch {
      return {status: 503, headers, body: "Facebook 連結暫時無法開啟，請稍後再試。"};
    }
  }
});
