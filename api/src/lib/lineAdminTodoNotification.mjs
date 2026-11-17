import {getLineNotificationTarget} from "./settings.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {resolveTenantLineChannel,lineTargetMatchesChannel} from "./lineTenantConfig.js";

const buildEnablesLabAdminTodos = false;
const immediateModes = new Set(["important_and_daily", "instant_only"]);

export async function notifyCompetitionUniformReview(schoolId, request) {
  if (request.kind !== "competitionUniform" || request.status !== "PENDING") return;
  const lab = process.env.LAB_ENVIRONMENT === "functional-uat";
  if (lab && !buildEnablesLabAdminTodos) return "lab_suppressed";

  try {
    const target = await getLineNotificationTarget(schoolId);
    if (!immediateModes.has(target.mode)) return target.mode;
    if (!target.targetId || target.targetType !== "group") return "not_bound";

    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.configured) return "not_configured";
    if (!lineTargetMatchesChannel(target, channel) ||
        (lab && (channel.legacy || !channel.loginConfigured || !target.botUserId))) {
      return "rebind_required";
    }

    const text = [
      lab ? "【LAB】後台待辦通知" : "【後台待辦通知】",
      "新增 A 團比賽服申請待審。",
      "請至學校後台 → 待辦事項查看。"
    ].join("\n");
    await pushLineMessage(target.targetId, text, {accessToken: channel.accessToken, retryKey: request.id});
    return "sent";
  } catch (error) {
    console.error("LINE competition-uniform review notification failed", {schoolId, requestId:request.id, status:error?.status || error?.statusCode});
    return "failed";
  }
}
