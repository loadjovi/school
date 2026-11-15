import {randomUUID} from "node:crypto";
import {TableClient} from "@azure/data-tables";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {getTenantLineRecipient, lineHash} from "./tenantLineAccounts.js";
import {pushLineMessage} from "./lineMessaging.mjs";

// The retry key is durably reserved before any outbound request. LINE may
// accept a request whose local network response was lost.
export async function sendTenantFeeLine(schoolId, {id, at, parentEmail, text}) {
  if (!id || !parentEmail || !(Date.now() - Date.parse(at) < 23 * 60 * 60 * 1000)) {
    return {status: "ineligible"};
  }
  try {
    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.loginConfigured || !channel.paymentLineEnabled) return {status: "disabled"};
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
