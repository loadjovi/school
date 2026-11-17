import {getTenantLineRecipient} from "./tenantLineAccounts.js";
import {getLineNotificationTarget} from "./settings.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {resolveTenantLineChannel,lineTargetMatchesChannel} from "./lineTenantConfig.js";

const buildEnablesLabAdminTodos = false;
const immediateModes = new Set(["important_and_daily", "instant_only"]);

const uniformNotices = new Map([
  ["regularUniform", {label:"團 T", pending:"新增團 T 申請待審。"}],
  ["competitionUniform", {label:"A 團比賽服", pending:"新增 A 團比賽服申請待審。"}]
]);

export async function notifyUniformReview(schoolId, request) {
  const notice = uniformNotices.get(request.kind);
  if (!notice || request.status !== "PENDING") return;
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
      notice.pending,
      "請至學校後台 → 待辦事項查看。"
    ].join("\n");
    await pushLineMessage(target.targetId, text, {accessToken: channel.accessToken, retryKey: request.id});
    return "sent";
  } catch (error) {
    console.error("LINE uniform review notification failed", {schoolId, requestId:request.id, status:error?.status || error?.statusCode});
    return "failed";
  }
}

export async function notifyUniformCancellation(schoolId, request) {
  const notice = uniformNotices.get(request.kind);
  if (!notice || request.status !== "CANCELLED") return;
  if (!request.parentEmail) return "applicant_unknown";
  const lab = process.env.LAB_ENVIRONMENT === "functional-uat";
  if (lab && !buildEnablesLabAdminTodos) return "lab_suppressed";

  try {
    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.loginConfigured || !channel.botUserId) return "not_configured";

    const applicant = await getTenantLineRecipient(schoolId, request.parentEmail, channel.botUserId);
    if (!applicant) return "not_bound";

    const text = [
      lab ? "【LAB】團服申請通知" : "【團服申請通知】",
      `學校已取消您的 ${notice.label} 申請。`,
      `原因：${request.cancelReason}`,
      "請至家長端 → 活動團服 → 我的紀錄查看。"
    ].join("\n");
    await pushLineMessage(applicant.lineUserId, text, {accessToken: channel.accessToken});
    return "accepted";
  } catch (error) {
    console.warn("LINE uniform cancellation notification failed", {schoolId, requestId:request.id, status:error?.status || error?.statusCode});
    return "failed";
  }
}
