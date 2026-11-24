import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {tenantFacebookSuggestion, tenantFacebookUrl} from "../api/src/lib/lineFacebookConfig.js";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "");
const facebookUrl = "https://www.facebook.com/profile.php?id=100075610947066";

test("Facebook addresses are HTTPS destinations rather than arbitrary redirects", () => {
  assert.equal(tenantFacebookUrl(facebookUrl), facebookUrl);
  assert.equal(tenantFacebookUrl("https://facebook.com/groups/school-a/"), "https://facebook.com/groups/school-a/");
  for (const value of ["", null, "http://www.facebook.com/example", "https://facebook.com.evil.test/", "https://user:password@www.facebook.com/example", "https://www.facebook.com:444/example", "https://www.facebook.com/l.php?u=https://evil.test", "https://www.facebook.com/example?next=https://evil.test", "javascript:alert(1)"]) {
    assert.equal(tenantFacebookUrl(value), "");
  }
});

test("the supplied Sacred Heart address is a form suggestion only, with no cross-school fallback", () => {
  assert.equal(tenantFacebookSuggestion("sacred-heart"), facebookUrl);
  for (const school of ["school-a", "school-b", "SACRED-HEART", "", null]) assert.equal(tenantFacebookSuggestion(school), "");
});

test("the public Facebook route uses only the active school's saved address and ignores caller destinations", async () => {
  const handlers = {}, calls = [], channels = new Map([
    ["school-a", {configured: true, facebookUrl}],
    ["school-b", {configured: true, facebookUrl: "https://www.facebook.com/groups/school-b/"}],
    ["sacred-heart", {configured: true, facebookUrl: ""}],
    ["disabled", {configured: false, facebookUrl}],
    ["unsafe", {configured: true, facebookUrl: "https://evil.test/"}]
  ]);
  runInNewContext(source("api/src/functions/lineFacebook.js"), {
    app: {http: (name, entry) => handlers[name] = entry.handler},
    tenantIdValue: value => /^[a-z0-9-]+$/.test(value) ? value : "",
    tenantFacebookUrl,
    resolveTenantLineChannel: async school => {calls.push(school);return channels.get(school) || {configured: false};}
  });
  const route = handlers.tenantLineFacebook;
  const request = schoolId => ({params: {schoolId}, query: new URLSearchParams({next: "https://evil.test/", facebookUrl: "https://www.facebook.com/wrong-school", schoolId: "school-b"})});
  const a = await route(request("school-a")); assert.equal(a.status, 303); assert.equal(a.headers.Location, facebookUrl);
  assert.equal(a.headers["Cache-Control"], "no-store"); assert.equal(a.headers["Referrer-Policy"], "no-referrer");
  const b = await route(request("school-b")); assert.equal(b.headers.Location, "https://www.facebook.com/groups/school-b/");
  for (const school of ["sacred-heart", "disabled", "unsafe", "missing"]) {
    const response = await route(request(school)); assert.equal(response.status, 404); assert.equal(response.headers.Location, undefined);
  }
  const before = calls.length; assert.equal((await route(request("../school-a"))).status, 404); assert.equal(calls.length, before);
});

function applyRoute({access = {authenticated: true, capabilities: {globalAdmin: true}, email: "global@example.test"}, failure} = {}) {
  const handlers = {}, calls = [];
  class LineConfigError extends Error {}
  class LineMenuApplyError extends Error {}
  runInNewContext(source("api/src/functions/lineTenantManagement.js"), {
    app: {http: (name, entry) => handlers[name] = entry.handler},
    getAccess: async () => access, json: (jsonBody, status = 200) => ({status, jsonBody}), console: {error() {}},
    tenantIdValue: value => value.toLowerCase(), getTenantDirectory: async id => id === "school-a" ? {} : null,
    applyTenantLineMenuTemplates: async (...args) => {
      calls.push(args);if (failure) throw failure === "safe" ? new LineMenuApplyError("選單正在更新，請稍後重試") : Error("private-provider-body");
      return {schoolId: args[0], facebookUrl: args[1], applied: true, parentMenuId: "parent", staffMenuId: "staff"};
    }, LineConfigError, LineMenuApplyError
  });
  return {calls, run: (body, schoolId = "school-a") => handlers.tenantLineMenuApply({params: {schoolId}, json: async () => body})};
}

test("only Global can explicitly apply Facebook menu templates with a strict one-field payload", async () => {
  const unauthorized = applyRoute({access: {authenticated: false}});
  assert.equal((await unauthorized.run({facebookUrl})).status, 401); assert.equal(unauthorized.calls.length, 0);
  const schoolAdmin = applyRoute({access: {authenticated: true, capabilities: {schoolAdmin: true}}});
  assert.equal((await schoolAdmin.run({facebookUrl})).status, 403); assert.equal(schoolAdmin.calls.length, 0);
  const global = applyRoute();
  for (const body of [null, [], {}, {facebookUrl, accessToken: "never-accept"}, {facebookUrl: 123}]) assert.equal((await global.run(body)).status, 400);
  assert.equal((await global.run({facebookUrl}, "SCHOOL-A")).status, 404);
  assert.equal((await global.run({facebookUrl}, "missing")).status, 404); assert.equal(global.calls.length, 0);
  const result = await global.run({facebookUrl}); assert.equal(result.status, 200); assert.equal(result.jsonBody.applied, true);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.deepEqual(global.calls, [["school-a", facebookUrl, "global@example.test"]]);
});

test("apply failures expose safe retry guidance and do not return provider details", async () => {
  const safe = await applyRoute({failure: "safe"}).run({facebookUrl}); assert.equal(safe.status, 409); assert.match(safe.jsonBody.error, /稍後重試/);
  const privateFailure = await applyRoute({failure: "private"}).run({facebookUrl});
  assert.equal(privateFailure.status, 500); assert.doesNotMatch(JSON.stringify(privateFailure), /private-provider-body/);
  assert.match(privateFailure.jsonBody.error, /原有選單設定仍保留/);
});
