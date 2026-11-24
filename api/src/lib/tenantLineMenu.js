import {defaultTenantId, getMappedStudentsByEmail, getTeacherDirectory, listTenantRolesByEmail} from "./storage.js";
import {lineApi} from "./lineMessaging.mjs";
import {discoverTenantLineRoleMenu} from "./tenantLineMenuDiscovery.js";
import {tenantFacebookUrl} from "./lineFacebookConfig.js";

export async function tenantLineParentStudents(schoolId, parentEmail) {
  if (!parentEmail) return [];
  const mapped = await getMappedStudentsByEmail(parentEmail, schoolId);
  if (mapped.length || schoolId !== defaultTenantId()) return mapped;
  let legacy;
  try { legacy = JSON.parse(process.env.STUDENT_MAP_JSON || "{}")?.[parentEmail]; } catch {}

  return Array.isArray(legacy) ? legacy : (legacy?.students || []);
}

export class LineMenuSyncError extends Error {}

export async function refreshTenantLineMenu(channel, account, userId = account?.lineUserId, {verify = false, expectStaff = false} = {}) {
  if (!channel.configured || !/^U[0-9a-f]{32}$/i.test(userId || "")) return "unavailable";
  const {accessToken, schoolId} = channel;
  // A menu is presentation, not a role grant. Global school assignments and
  // the teacher directory decide staff; approved student links decide the
  // signed-in parent menu. Other users inherit the official default menu.
  let role = "default";
  if (account?.googleEmail) {
    const [roles, teacher] = await Promise.all([
      listTenantRolesByEmail(account.googleEmail, "active"), getTeacherDirectory(account.googleEmail, schoolId)
    ]);
    if (roles.some(row => row.role === "schoolAdmin" && row.schoolId === schoolId) ||
        teacher?.status === "active" && (teacher.schoolId === undefined || teacher.schoolId === schoolId)) role = "staff";
  }
  if (role === "default" && account && (await tenantLineParentStudents(schoolId, account.parentEmail)).length) role = "parent";
  const resource = "/v2/bot/user/" + encodeURIComponent(userId) + "/richmenu";
  if (expectStaff && role !== "staff") throw new LineMenuSyncError("LINE 綁定的 Gmail 未判定為此校管理員或教師，請確認綁定帳號。");
  // Existing explicit template settings take precedence. A missing template can
  // be discovered from this official account, without a second role assignment.
  let menuId = role === "staff" ? channel.staffMenuId : role === "parent" ? channel.parentMenuId : "";
  if (role !== "default" && !menuId) menuId = await discoverTenantLineRoleMenu(channel, role);
  if (role === "staff" && (!menuId || menuId === channel.parentMenuId)) {
    if (verify) throw new LineMenuSyncError(menuId ? "幹部與家長選單使用同一個 ID，請由 Global 管理員確認幹部選單。" : "此校幹部選單尚未設定可用的正式版型；人員身分已依 Global 名冊判定，不需重新指派或綁定。");
    return "unavailable";
  }
  if (menuId && !/^richmenu-[a-f0-9]{32}$/i.test(menuId)) {
    if (verify) throw new LineMenuSyncError("LINE 選單 ID 格式不正確，請由 Global 管理員核對設定。");
    return "unavailable";
  }
  const parentTemplateMissing = role === "parent" && !menuId;
  let definition;
  let chatActionsVerified = false;
  if (menuId) {
    try {
      definition = await lineApi("/v2/bot/richmenu/" + menuId, {accessToken, method: "GET", timeoutMs: 3000});
    } catch (error) {
      if (error.status === 404) throw new LineMenuSyncError("此校官方帳號找不到已設定的選單，請核對選單 ID。");
      throw error;
    }
    if (!Array.isArray(definition.areas) || !(role === "staff" ? definition.areas.length === 6 : [4, 5].includes(definition.areas.length))) {
      throw new LineMenuSyncError(role === "staff" ? "幹部與老師的選單須使用六宮格，請核對選單版型。" : "已確認家長學生關係，但家長四格或含 Facebook 的五格版型不符；不需重新綁定帳號。");
    }
    if (channel.appOrigin) for (const area of definition.areas) {
      if (area.action?.type !== "uri") continue;
      for (const value of [area.action.uri, ...(area.action.altUri?.desktop === undefined ? [] : [area.action.altUri.desktop])]) {
        let url;
        try { url = new URL(value); } catch { throw new LineMenuSyncError("選單連結不正確，請由管理員核對選單版型。"); }
        if (url.username || url.password || url.origin !== channel.appOrigin || url.searchParams.getAll("schoolId").some(id => id !== schoolId) ||
            url.pathname.startsWith("/api/line/facebook/") && url.pathname !== "/api/line/facebook/" + encodeURIComponent(schoolId)) {
          throw new LineMenuSyncError("選單連結不屬於此校目前的平台，請由管理員核對正式版型。");
        }
        if (url.pathname.startsWith("/api/line/facebook/") && !tenantFacebookUrl(channel.facebookUrl)) {
          throw new LineMenuSyncError("此校 Facebook 活動影音尚未啟用，請由管理員套用新版選單。");
        }
      }
    }
    if (role === "parent" && definition.areas.length === 5) {
      const facebook = definition.areas.some(area => {
        if (area.action?.type !== "uri") return false;
        try {
          const url = new URL(area.action.uri);
          return url.origin === channel.appOrigin && url.pathname === "/api/line/facebook/" + encodeURIComponent(schoolId) &&
            !url.hash && url.searchParams.getAll("openExternalBrowser").length === 1 && url.searchParams.get("openExternalBrowser") === "1" &&
            [...url.searchParams.keys()].every(key => key === "openExternalBrowser");
        } catch { return false; }
      });
      if (!facebook) throw new LineMenuSyncError("家長五格選單缺少此校 Facebook 入口，請核對新版選單。");
    }
    if (role === "staff" && schoolId === defaultTenantId() && process.env.LAB_ENVIRONMENT === "functional-uat") {
      if (!Array.isArray(definition.areas) || definition.areas.length !== 6) {
        throw new LineMenuSyncError("目前設定的幹部選單不是聖心 LAB 六宮格，請核對幹部選單 ID。");
      }
      const ordered = [...definition.areas].sort((a, b) => a.bounds?.y - b.bounds?.y || a.bounds?.x - b.bounds?.x);
      const invalid = ["今日課程", "活動行事曆", "最新公告"].find((label, index) => {
        const action = ordered[index].action;
        return action?.type !== "message" || action.text !== "#幹部" + label;
      });
      if (invalid) throw new LineMenuSyncError(`幹部選單的「${invalid}」尚未設定為聊天室回覆，請更新幹部選單 ID。`);
      chatActionsVerified = true;
    }
  }
  try {
    if (menuId) await lineApi(resource + "/" + menuId, {accessToken});
    else await lineApi(resource, {accessToken, method: "DELETE"});
  } catch (error) {
    if (menuId || error.status !== 404) throw error;
  }
  if (parentTemplateMissing) {
    if (verify) throw new LineMenuSyncError("已確認家長學生關係，但家長選單版型尚未準備完成；不需重新綁定帳號。");
    return "unavailable";
  }
  if (!verify || !menuId) return menuId ? role : "default";
  try {
    const assigned = await lineApi(resource, {accessToken, method: "GET"});
    if (assigned.richMenuId === menuId) return {audience: role, areaCount: definition.areas?.length || 0, chatActionsVerified};
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  throw new LineMenuSyncError("LINE 尚未確認選單已套用。請確認目前聊天室使用的是綁定的 LINE 帳號，再試一次。");
}
