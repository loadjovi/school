import {createHash} from "node:crypto";
import {listTenantAdmins} from "./storage.js";
import {financeAssignments} from "./financeAccess.js";
import {financeRecipients} from "./financeNoticeRules.mjs";
import {getTenantLineRecipient} from "./tenantLineAccounts.js";
import {getLineNotificationTarget} from "./settings.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {resolveTenantLineChannel,lineTargetMatchesChannel} from "./lineTenantConfig.js";

const buildEnablesLabAdminTodos = false;
export const workflowLineEnabled = () => !labEnvironment() || buildEnablesLabAdminTodos;
const immediateModes = new Set(["important_and_daily", "instant_only"]);
const labEnvironment = () => process.env.LAB_ENVIRONMENT === "functional-uat";

export function workflowLineRetryKey(schoolId, eventId, targetId) {
  const hex = createHash("sha256").update(JSON.stringify([schoolId,eventId,targetId])).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

async function boundRecipients(schoolId, emails, botUserId) {
  const accounts = await Promise.all([...new Set(emails.filter(Boolean))].map(email => getTenantLineRecipient(schoolId,email,botUserId)));
  return new Set(accounts.map(account => account?.lineUserId).filter(Boolean));
}

async function sendToTargets(schoolId, channel, targets, eventId, text) {
  if (!targets.size) return "not_bound";
  const results = await Promise.allSettled([...targets].map(([id,key]) =>
    pushLineMessage(id,text,{accessToken:channel.accessToken,retryKey:key || workflowLineRetryKey(schoolId,eventId,id)})));
  const accepted = results.filter(result => result.status === "fulfilled").length;
  return accepted === targets.size ? "sent" : accepted ? "partial" : "failed";
}

const uniformNotices = new Map([
  ["regularUniform", {label:"團 T", pending:"新增團 T 申請待審。"}],
  ["competitionUniform", {label:"A 團比賽服", pending:"新增 A 團比賽服申請待審。"}]
]);

export async function notifyUniformReview(schoolId, request) {
  const notice = uniformNotices.get(request.kind);
  if (!notice || request.status !== "PENDING") return;
  return notifyAdminTodo(schoolId,{id:"uniform:"+request.id,text:notice.pending,groupRetryKey:request.id});
}

export async function notifyAdminTodo(schoolId, {id, text, groupRetryKey}) {
  const lab = labEnvironment();
  if (lab && !buildEnablesLabAdminTodos) return "lab_suppressed";

  try {
    const target = await getLineNotificationTarget(schoolId);
    if (!immediateModes.has(target.mode)) return target.mode;
    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.configured) return "not_configured";
    if (lab && (channel.legacy || !channel.loginConfigured || !channel.botUserId)) return "not_configured";
    const targets = new Map();
    if (target.targetType === "group" && lineTargetMatchesChannel(target, channel) && (!lab || target.botUserId)) {
      targets.set(target.targetId,groupRetryKey);
    }
    if (channel.loginConfigured && channel.botUserId) {
      try {
        const admins = await listTenantAdmins(schoolId,"active");
        const emails = admins.filter(admin => admin.role==="schoolAdmin" && admin.status==="active").map(admin => admin.partitionKey || admin.email);
        for (const userId of await boundRecipients(schoolId,emails,channel.botUserId)) targets.set(userId,undefined);
      } catch (error) {
        console.warn("LINE admin accounts lookup failed", {schoolId,status:error?.statusCode});
        if (!targets.size) return "failed";
      }
    }
    if (!targets.size && target.targetId) return "rebind_required";
    const message = [
      lab ? "【LAB】後台待辦通知" : "【後台待辦通知】",
      text,
      "請至學校後台 → 待辦事項查看。"
    ].join("\n");
    return await sendToTargets(schoolId,channel,targets,id,message);
  } catch (error) {
    console.error("LINE admin todo notification failed", {schoolId, status:error?.status || error?.statusCode});
    return "failed";
  }
}

export async function notifyFinanceTransfer(schoolId, {kind,id,reportedAt}) {
  if (!id || !reportedAt || !["uniform","family"].includes(kind)) return "ineligible";
  const lab = labEnvironment();
  if (lab && !buildEnablesLabAdminTodos) return "lab_suppressed";
  try {
    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.loginConfigured || !channel.botUserId || !channel.paymentLineEnabled) return "not_configured";
    const [admins,assignments] = await Promise.all([listTenantAdmins(schoolId,"active"),financeAssignments(schoolId)]);
    const recipients = await boundRecipients(schoolId,financeRecipients(admins,assignments),channel.botUserId);
    return await sendToTargets(schoolId,channel,new Map([...recipients].map(userId => [userId,undefined])),
      `finance:${kind}:${id}:${reportedAt}`,
      (lab ? "【LAB】" : "") + "【財務待辦】\n家長已回報匯款，請登入學校後台核對。");
  } catch (error) {
    console.warn("LINE finance notification failed",{schoolId,status:error?.status || error?.statusCode});
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
