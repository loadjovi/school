import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {tenantFacebookUrl} from "../api/src/lib/lineFacebookConfig.js";

const source = readFileSync(new URL("../api/src/lib/tenantLineMenu.js", import.meta.url), "utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const origin = "https://school-a.example.test", userId = "U" + "1".repeat(32);
const parentMenuId = "richmenu-" + "2".repeat(32), staffMenuId = "richmenu-" + "3".repeat(32);
const facebook = origin + "/api/line/facebook/school-a?openExternalBrowser=1";
function fixture({staff = false, count = 5, destination = facebook, enabled = true} = {}) {
  const writes = [], account = {lineUserId: userId, googleEmail: "verified@example.test", parentEmail: "approved@example.test"};
  const menuId = staff ? staffMenuId : parentMenuId;
  const areas = Array.from({length: count}, (_, index) => ({action: index === count - 1 ? {type: "uri", uri: destination} : {type: "message", text: "今日課程"}}));
  const sync = runInNewContext(source + ";refreshTenantLineMenu", {
    URL, tenantFacebookUrl, process: {env: {}}, defaultTenantId: () => "sacred-heart",
    listTenantRolesByEmail: async () => staff ? [{role: "schoolAdmin", schoolId: "school-a"}] : [],
    getTeacherDirectory: async () => null, getMappedStudentsByEmail: async () => [{studentId: "approved"}],
    lineApi: async (path, options) => {
      if (path.startsWith("/v2/bot/richmenu/")) return {areas};
      if (options.method === "GET") return {richMenuId: menuId};
      writes.push({path, options}); return {};
    }
  });
  const channel = {schoolId: "school-a", configured: true, accessToken: "school-a-token", appOrigin: origin, parentMenuId, staffMenuId,
    facebookUrl: enabled ? "https://www.facebook.com/profile.php?id=100075610947066" : ""};
  return {writes, account, run: () => sync(channel, account, undefined, {verify: true})};
}

test("approved parents can adopt five Facebook entries while the old four-entry menu remains usable", async () => {
  for (const count of [4, 5]) {
    const h = fixture({count}), result = await h.run();
    assert.equal(result.audience, "parent"); assert.equal(result.areaCount, count);
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].path.endsWith(parentMenuId), true);
    assert.deepEqual(Object.keys(h.account).sort(), ["googleEmail", "lineUserId", "parentEmail"]);
  }
});

test("a Facebook five-entry menu cannot send parents to another school, environment or caller-controlled target", async () => {
  for (const destination of [
    origin + "/api/line/facebook/school-b?openExternalBrowser=1",
    "https://lab.example.test/api/line/facebook/school-a?openExternalBrowser=1",
    "https://www.facebook.com/profile.php?id=100075610947066",
    facebook + "&next=https://other.example.test",
    origin + "/?schoolId=school-a"
  ]) {
    const h = fixture({destination}); await assert.rejects(h.run(), /選單|Facebook|平台/); assert.equal(h.writes.length, 0);
  }
});

test("the sixth staff cell may open this school's Facebook route without granting or changing a role", async () => {
  const h = fixture({staff: true, count: 6}), result = await h.run();
  assert.equal(result.audience, "staff"); assert.equal(result.areaCount, 6); assert.equal(h.writes.length, 1);
  const foreign = fixture({staff: true, count: 6, destination: origin + "/api/line/facebook/school-b?openExternalBrowser=1"});
  await assert.rejects(foreign.run(), /此校/); assert.equal(foreign.writes.length, 0);
});

test("uncommitted or orphan Facebook artwork is never assigned before this school's redirect has been activated", async () => {
  for (const staff of [false, true]) {
    const h = fixture({staff, count: staff ? 6 : 5, enabled: false});
    await assert.rejects(h.run(), /尚未啟用/); assert.equal(h.writes.length, 0);
  }
});
