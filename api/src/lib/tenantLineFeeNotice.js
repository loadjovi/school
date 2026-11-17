import {randomUUID} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {getTenantLineRecipient, lineHash} from "./tenantLineAccounts.js";
import {pushLineMessage} from "./lineMessaging.mjs";
import {workflowLineEnabled} from "./lineAdminTodoNotification.mjs";

const paymentLabels = new Map([
  ["regularUniform", "團 T"], ["competitionUniform", "A 團比賽服"],
  ["yearEndDinner", "期末聚餐"], ["fieldTrip", "活動報名"]
]);

export async function notifyTenantPaymentVerified(schoolId, {kind, id, at, parentEmail, requestStatus}) {
  if (!workflowLineEnabled()) return {status: "disabled"};
  const title = paymentLabels.get(kind);
  if (!title) return {status: "ineligible"};
  const uniform = kind === "regularUniform" || kind === "competitionUniform";
  const nextStep = uniform && requestStatus === "APPROVED"
    ? "團服已進入備貨／採購流程，請至平台查看領取進度。"
    : uniform ? "請至平台查看團服領取進度。" : "報名已完成，請至平台查看報名與繳費紀錄。";
  const labLabel = process.env.LAB_ENVIRONMENT === "functional-uat" ? "【LAB】" : "";
  return sendTenantFeeLine(schoolId, {
    id: `${uniform ? "uniform" : "family"}:${id}:verified:${at}`,
    at, parentEmail, confirmation: true,
    text: `${labLabel}繳費通知｜${title}\n財務已確認您的匯款入帳。\n${nextStep}`
  });
}

// The retry key is durably reserved before any outbound request. LINE may
// accept a request whose local network response was lost.
export async function sendTenantFeeLine(schoolId, {id, at, parentEmail, text, confirmation = false}) {
  if (!id || !(Date.now() - Date.parse(at) < 23 * 60 * 60 * 1000)) {
    return {status: "ineligible"};
  }
  if (!parentEmail) return {status: "not_bound"};
  try {
    const channel = await resolveTenantLineChannel(schoolId);
    const enabled = confirmation ? channel.paymentConfirmationLineEnabled : channel.paymentLineEnabled;
    if (!channel.loginConfigured || !enabled) return {status: "disabled"};
    const account = await getTenantLineRecipient(schoolId, parentEmail, channel.botUserId);
    if (!account) return {status: "not_bound"};
    const target = lineHash(channel.botUserId + ":" + account.lineUserId);
    const db = TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING, "TenantLineFeeNotice");
    await db.createTable().catch(error => {if (error.statusCode !== 409) throw error;});
    let row = {partitionKey: schoolId, rowKey: lineHash(id), target, retryKey: randomUUID(), status: "pending"};
    try {
      await db.createEntity(row);
    } catch (error) {
      if (error.statusCode !== 409) throw error;
      row = await db.getEntity(row.partitionKey, row.rowKey);
    }
    if (row.target !== target) return {status: "target_changed"};
    if (row.status === "accepted") return {status: "accepted"};
    await pushLineMessage(account.lineUserId, text, {accessToken: channel.accessToken, retryKey: row.retryKey});
    await db.updateEntity({partitionKey: row.partitionKey, rowKey: row.rowKey, status: "accepted"}, "Merge");
    return {status: "accepted"};
  } catch (error) {
    console.warn("Tenant fee LINE notification pending", {schoolId, status: error?.status || error?.statusCode});
    return {status: "pending"};
  }
}
