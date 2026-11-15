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

export async function refreshTenantLineMenu(channel, account, userId = account?.lineUserId) {
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
  if (menuId && !/^richmenu-[a-f0-9]{32}$/i.test(menuId)) return "unavailable";
  try {
    if (menuId) await lineApi(resource + "/" + menuId, {accessToken});
    else await lineApi(resource, {accessToken, method: "DELETE"});
  } catch (error) {
    if (menuId || error.status !== 404) throw error;
  }
  return menuId ? role : "default";
}
