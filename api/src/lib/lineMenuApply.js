import {readFile} from "node:fs/promises";
import {createHash, randomUUID} from "node:crypto";
import {lineApi} from "./lineMessaging.mjs";
import {buildLineMenuTemplate, inspectLineMenuAsset, LINE_MENU_TEMPLATE_VERSION, lineMenuTemplateSignature, normalizeLineFacebookUrl} from "./lineMenuTemplates.js";

const partitionKey = "line", leaseMs = 90000, menuIdPattern = /^richmenu-[a-f0-9]{32}$/i;
const assetUrls = {
  parent: new URL("../assets/line-parent-facebook.jpg", import.meta.url),
  staff: new URL("../assets/line-staff-facebook.jpg", import.meta.url)
};

export class LineMenuApplyError extends Error {}

async function readRow(client, rowKey) {
  try { return await client.getEntity(partitionKey, rowKey); }
  catch (error) { if (error.statusCode === 404) return null; throw error; }
}

async function acquireLease(client, schoolId, operationId, now) {
  const rowKey = "menu-apply-" + schoolId;
  const lease = {partitionKey, rowKey, operationId, leaseExpiresAt: new Date(now() + leaseMs).toISOString()};
  try { await client.createEntity(lease); }
  catch (error) {
    if (error.statusCode !== 409) throw error;
    const previous = await readRow(client, rowKey);
    if (!previous?.etag || Date.parse(previous.leaseExpiresAt || "") > now() || !Number.isFinite(Date.parse(previous.leaseExpiresAt || ""))) {
      throw new LineMenuApplyError("此校選單正在套用，請稍後重新讀取狀態");
    }
    try { await client.updateEntity(lease, "Replace", {etag: previous.etag}); }
    catch (changed) {
      if ([404, 409, 412].includes(changed.statusCode)) throw new LineMenuApplyError("此校選單正在套用，請稍後重新讀取狀態");
      throw changed;
    }
  }
  const saved = await readRow(client, rowKey);
  if (saved?.operationId !== operationId || !saved.etag) throw new LineMenuApplyError("選單設定鎖定狀態已變更，請重試");
  return saved;
}

async function releaseLease(client, schoolId, operationId) {
  try {
    const lease = await readRow(client, "menu-apply-" + schoolId);
    if (lease?.operationId === operationId && lease.etag) await client.deleteEntity(partitionKey, lease.rowKey, {etag: lease.etag});
  } catch { /* A later request can recover an expired lease. Never hide an applied configuration. */ }
}

async function requireLease(client, schoolId, operationId, now) {
  const lease = await readRow(client, "menu-apply-" + schoolId);
  const expiresAt = Date.parse(lease?.leaseExpiresAt || "");
  if (lease?.operationId !== operationId || !Number.isFinite(expiresAt) || expiresAt < now() + 5000) {
    throw new LineMenuApplyError("選單套用已逾時，請重新讀取後再試");
  }
}

async function binaryRequest(fetchImpl, method, richMenuId, accessToken, bytes, contentType = "image/jpeg") {
  const response = await fetchImpl("https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content", {
    method, headers: {Authorization: "Bearer " + accessToken, ...(bytes ? {"Content-Type": contentType} : {})},
    ...(bytes ? {body: bytes} : {}), signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw Object.assign(new LineMenuApplyError("LINE 選單圖片處理失敗，請稍後重試"), {status: response.status});
  if (method === "POST") return null;
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 1024 * 1024) throw new LineMenuApplyError("既有選單圖片格式不符，請由管理員檢查");
  return createHash("sha256").update(data).digest("hex");
}

// The caller performs Global authorization and resolves this school's current
// verified channel. The second argument only supports local dependency tests.
export async function applyTenantLineMenus({schoolId, facebookUrl: suppliedFacebookUrl, actor, channel, configRow, configClient}, dependencies = {}) {
  const facebookUrl = normalizeLineFacebookUrl(suppliedFacebookUrl), now = dependencies.now || Date.now;
  const readAsset = dependencies.readAsset || readFile, request = dependencies.lineRequest || lineApi;
  const fetchImpl = dependencies.fetchImpl || fetch, operationId = (dependencies.uuid || randomUUID)();
  if (!facebookUrl) throw new LineMenuApplyError("請填寫有效的 HTTPS Facebook 粉專或社團網址");
  if (!channel?.configured || channel.schoolId !== schoolId || !channel.accessToken || !/^U[a-f0-9]{32}$/i.test(channel.botUserId || "") ||
      configRow?.partitionKey !== partitionKey || configRow.rowKey !== "school-" + schoolId || configRow.status !== "active" ||
      configRow.botUserId !== channel.botUserId || !configRow.etag) throw new LineMenuApplyError("請先驗證並啟用此校 LINE 官方帳號");
  let assets, definitions;
  try {
    assets = Object.fromEntries(await Promise.all(Object.entries(assetUrls).map(async ([audience, path]) => [audience, inspectLineMenuAsset(await readAsset(path))])));
    definitions = Object.fromEntries(["parent", "staff"].map(audience => [audience, buildLineMenuTemplate(channel, audience, assets[audience], facebookUrl)]));
  } catch { throw new LineMenuApplyError("新版選單圖片尚未準備完成或不符合 LINE 規格，請稍後重試"); }
  const created = [], ids = {}, reused = {};
  let committed = false, commitAttempted = false;
  await acquireLease(configClient, schoolId, operationId, now);
  try {
    const available = await request("/v2/bot/richmenu/list", {method: "GET", accessToken: channel.accessToken, timeoutMs: 3000});
    if (!Array.isArray(available?.richmenus) || available.richmenus.length > 1000) throw new LineMenuApplyError("無法讀取此校 LINE 選單，請稍後重試");
    for (const audience of ["parent", "staff"]) {
      await requireLease(configClient, schoolId, operationId, now);
      const definition = definitions[audience], named = available.richmenus.filter(menu => menu.name === definition.name);
      if (named.length) {
        if (named.length > 4) throw new LineMenuApplyError("同版本選單重複過多，請由管理員檢查後重試");
        for (const candidate of named.sort((a, b) => String(a.richMenuId).localeCompare(String(b.richMenuId)))) {
          if (!menuIdPattern.test(candidate.richMenuId || "") || lineMenuTemplateSignature(candidate) !== lineMenuTemplateSignature(definition)) continue;
          await requireLease(configClient, schoolId, operationId, now);
          let existingHash;
          try { existingHash = await binaryRequest(fetchImpl, "GET", candidate.richMenuId, channel.accessToken); }
          catch (error) {
            // A previous create response can be lost before image upload. LINE
            // allows the first upload to such a menu; never replace an image.
            if (error.status !== 404) throw error;
            await binaryRequest(fetchImpl, "POST", candidate.richMenuId, channel.accessToken, assets[audience].bytes, assets[audience].contentType);
            existingHash = assets[audience].sha256;
          }
          if (existingHash === assets[audience].sha256) {
            ids[audience] = candidate.richMenuId; reused[audience] = true; break;
          }
        }
        if (!ids[audience]) throw new LineMenuApplyError("既有同版選單與圖片不一致，請由管理員檢查後重試");
      } else {
        const saved = await request("/v2/bot/richmenu", {body: definition, accessToken: channel.accessToken, timeoutMs: 3000});
        if (!menuIdPattern.test(saved?.richMenuId || "")) throw new LineMenuApplyError("LINE 未回傳有效的新版選單，請稍後重試");
        ids[audience] = saved.richMenuId; created.push(saved.richMenuId); reused[audience] = false;
        await binaryRequest(fetchImpl, "POST", saved.richMenuId, channel.accessToken, assets[audience].bytes, assets[audience].contentType);
        const verified = await request("/v2/bot/richmenu/" + saved.richMenuId, {method: "GET", accessToken: channel.accessToken, timeoutMs: 3000});
        if (lineMenuTemplateSignature(verified) !== lineMenuTemplateSignature(definition)) throw new LineMenuApplyError("LINE 保存的新版選單內容不符，請稍後重試");
      }
    }
    if (ids.parent === ids.staff) throw new LineMenuApplyError("家長與幹部選單必須分開設定");
    await requireLease(configClient, schoolId, operationId, now);
    const result = {schoolId, facebookUrl, parentMenuId: ids.parent, staffMenuId: ids.staff,
      templateVersion: LINE_MENU_TEMPLATE_VERSION, applied: true, reused};
    const update = {
      partitionKey, rowKey: configRow.rowKey, facebookUrl,
      parentMenuId: ids.parent, staffMenuId: ids.staff, menuBotUserId: channel.botUserId, menuAppOrigin: channel.appOrigin,
      menuTemplateVersion: LINE_MENU_TEMPLATE_VERSION, menuApplyOperationId: operationId,
      menuUpdatedBy: String(actor || "").slice(0, 160), menuUpdatedAt: new Date(now()).toISOString()
    };
    commitAttempted = true;
    try { await configClient.updateEntity(update, "Merge", {etag: configRow.etag}); committed = true; }
    catch (error) {
      const current = await readRow(configClient, configRow.rowKey);
      if (current?.menuApplyOperationId === operationId && current.parentMenuId === ids.parent && current.staffMenuId === ids.staff && current.facebookUrl === facebookUrl) committed = true;
      if (!committed) throw error;
    }
    return result;
  } catch (error) {
    // If a commit response was lost, never delete menus that may now be live.
    // Keep only unknown/orphaned assets rather than breaking an active menu.
    let current, readSucceeded = false;
    try { current = await readRow(configClient, configRow.rowKey); readSucceeded = true; } catch {}
    if (!committed && readSucceeded) {
      const live = new Set([current?.parentMenuId, current?.staffMenuId]);
      for (const richMenuId of created.filter(id => !live.has(id))) {
        // After expiry another apply may reuse these deterministic assets before
        // it commits. Only our still-valid lease permits rollback deletion.
        // Five seconds of lease remaining exceeds the bounded DELETE timeout.
        try { await requireLease(configClient, schoolId, operationId, now); }
        catch { break; }
        try { await request("/v2/bot/richmenu/" + richMenuId, {method: "DELETE", accessToken: channel.accessToken, timeoutMs: 3000}); } catch {}
      }
    }
    if (error instanceof LineMenuApplyError) throw error;
    if (commitAttempted && !readSucceeded) throw new LineMenuApplyError("選單設定提交結果尚未確認，請重新讀取狀態；不需解除帳號綁定");
    if ([404, 409, 412].includes(error?.statusCode)) throw new LineMenuApplyError("學校設定已變更，請重新讀取後再套用");
    throw new LineMenuApplyError("LINE 新版選單套用未完成，既有設定已保留，請稍後重試");
  } finally { await releaseLease(configClient, schoolId, operationId); }
}
