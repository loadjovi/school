import {getTenantLineAccount, getTenantLineRecipient} from "./tenantLineAccounts.js";
import {resolveTenantLineChannel} from "./lineTenantConfig.js";
import {refreshTenantLineMenu} from "./tenantLineMenu.js";

// Mapping changes already carry their own authorization and audit trail. Menu
// reconciliation runs afterwards, using the current same-school identity and
// roster; it never approves a student, creates a binding or chooses a role.
export async function reconcileParentLineMenus(schoolId, parentEmails) {
  const emails = [...new Set((Array.isArray(parentEmails) ? parentEmails : [parentEmails])
    .filter(value => typeof value === "string").map(value => value.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return {status: "not_bound"};
  const outcomes = [], seen = new Set();
  const transient = error => [408, 429, 500, 502, 503, 504].includes(Number(error?.status || error?.statusCode)) ||
    ["AbortError", "TimeoutError"].includes(error?.name) ||
    ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(error?.code || error?.cause?.code);
  const matches = (account, channel, userId) => account?.botUserId === channel.botUserId && account.lineUserId === userId &&
    account.parentEmail && (!account.partitionKey || account.partitionKey === schoolId) && (!account.schoolId || account.schoolId === schoolId);
  try {
    const channel = await resolveTenantLineChannel(schoolId);
    if (channel.schoolId !== schoolId || !channel.loginConfigured || !channel.configured || !channel.botUserId) {
      return {status: "not_configured"};
    }
    const recipients = await Promise.allSettled(emails.map(email => getTenantLineRecipient(schoolId, email, channel.botUserId)));
    const updates = [];
    for (const item of recipients) {
      if (item.status === "rejected") {outcomes.push({status: "pending"}); continue;}
      const account = item.value;
      if (!account) continue;
      if (account.botUserId !== channel.botUserId || !/^U[a-f0-9]{32}$/i.test(account.lineUserId || "") ||
          account.partitionKey && account.partitionKey !== schoolId || account.schoolId && account.schoolId !== schoolId) {
        outcomes.push({status: "pending"}); continue;
      }
      if (seen.has(account.lineUserId)) continue;
      seen.add(account.lineUserId);
      updates.push((async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            // Recipient indexes are lookup aids. The canonical same-bot account
            // is re-read on every attempt, including after transient failures.
            const current = await getTenantLineAccount(schoolId, channel.botUserId, account.lineUserId);
            if (!current) return {status: "not_bound"};
            if (!matches(current, channel, account.lineUserId)) return {status: "pending"};
            const result = await refreshTenantLineMenu(channel, current, undefined, {details: true});
            const audience = typeof result === "string" ? result : result?.audience;
            if (!["parent", "staff", "default"].includes(audience)) return {status: "pending"};
            return {status: "synced", audience, ...(Number.isInteger(result?.areaCount) ? {areaCount: result.areaCount} : {})};
          } catch (error) {
            if (attempt === 1 || !transient(error)) return {status: "pending"};
          }
        }
        return {status: "pending"};
      })());
    }
    outcomes.push(...await Promise.all(updates));
  } catch {
    outcomes.push({status: "pending"});
  }
  if (outcomes.some(item => item.status === "pending")) {
    console.warn("Parent LINE menu automatic update deferred", {schoolId});
    return {status: "pending"};
  }
  const synced = outcomes.filter(item => item.status === "synced");
  if (!synced.length) return {status: "not_bound"};
  const audiences = [...new Set(synced.map(item => item.audience))], areaCounts = [...new Set(synced.map(item => item.areaCount))];
  return {status: "synced", ...(audiences.length === 1 ? {audience: audiences[0]} : {audiences}),
    ...(areaCounts.length === 1 && Number.isInteger(areaCounts[0]) ? {areaCount: areaCounts[0]} : {})};
}
