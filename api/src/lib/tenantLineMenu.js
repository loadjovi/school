import {defaultTenantId, getMappedStudentsByEmail, getTeacherDirectory, listTenantRolesByEmail} from "./storage.js";
import {lineApi} from "./lineMessaging.mjs";

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
  let role = "default";
  if (account?.googleEmail) {
    const [roles, teacher] = await Promise.all([
      listTenantRolesByEmail(account.googleEmail, "active"), getTeacherDirectory(account.googleEmail, schoolId)
    ]);
    if (roles.some(row => row.role === "schoolAdmin" && row.schoolId === schoolId) ||
        teacher?.status === "active") role = "staff";
  }
  if (role === "default" && account && (await tenantLineParentStudents(schoolId, account.parentEmail)).length) role = "parent";
  const menuId = role === "staff" ? channel.staffMenuId : role === "parent" ? channel.parentMenuId : "";
  const resource = "/v2/bot/user/" + encodeURIComponent(userId) + "/richmenu";
  if (expectStaff && role !== "staff") throw new LineMenuSyncError("LINE 綁定的 Gmail 未判定為此校管理員或教師，請確認綁定帳號。");
  if (role === "staff" && (!menuId || menuId === channel.parentMenuId)) {
    if (verify) throw new LineMenuSyncError(menuId ? "幹部與家長選單使用同一個 ID，請由 Global 管理員確認幹部選單。" : "此校幹部選單尚未設定，請由 Global 管理員設定幹部選單。");
    return "unavailable";
  }
  if (menuId && !/^richmenu-[a-f0-9]{32}$/i.test(menuId)) {
    if (verify) throw new LineMenuSyncError("LINE 選單 ID 格式不正確，請由 Global 管理員核對設定。");
    return "unavailable";
  }
  let definition;
  let chatActionsVerified = false;
  if (verify && menuId) {
    try {
      definition = await lineApi("/v2/bot/richmenu/" + menuId, {accessToken, method: "GET"});
    } catch (error) {
      if (error.status === 404) throw new LineMenuSyncError("此校官方帳號找不到已設定的選單，請核對選單 ID。");
      throw error;
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
  if (!verify || !menuId) return menuId ? role : "default";
  try {
    const assigned = await lineApi(resource, {accessToken, method: "GET"});
    if (assigned.richMenuId === menuId) return {audience: role, areaCount: definition.areas?.length || 0, chatActionsVerified};
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  throw new LineMenuSyncError("LINE 尚未確認選單已套用。請確認目前聊天室使用的是綁定的 LINE 帳號，再試一次。");
}
