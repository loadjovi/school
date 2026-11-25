import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {teacherCourseAccess} from "../api/src/lib/teacherAccountType.js";

const source = readFileSync(new URL("../api/src/lib/auth.js", import.meta.url), "utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const teacherEmail = "teacher@example.test", teacherSub = "teacher-google-sub";
const freshToken = "fresh-teacher-token", otherToken = "different-valid-google-cookie";
const teacherHeaders = {"X-Google-ID-Token": freshToken, "X-School-Id": "school-a", "X-Role-Context": "teacher"};
const lineCookie = "__Host-school-line-session=existing-unpaired-line-session";
const cookie = token => "orchestra_google_id_token=" + token + "; " + lineCookie;

function fixture() {
  const verified = [], directoryReads = [], mappingReads = [];
  let lineReads = 0;
  const state = {line: true, directory: {status: "active", teacherName: "正式老師姓名"},
    account: {botUserId: "school-a-bot", lineUserId: "line-user", parentEmail: "line-account@line.invalid", displayName: "wen"}};
  const tenants = new Map(["school-a", "school-b"].map(school => [school, {rowKey: school, status: "active", schoolName: school}]));
  const payloads = new Map([[freshToken, {sub: teacherSub, email: teacherEmail, email_verified: true, name: "Google 老師名稱"}],
    [otherToken, {sub: "other-sub", email: "other@example.test", email_verified: true, name: "另一個 Google 帳號"}]]);
  const context = {createHash, teacherCourseAccess, process: {env: {GOOGLE_CLIENT_ID: "configured-google-audience"}}, console: {error() {}, warn() {}},
    OAuth2Client: class {async verifyIdToken({idToken, audience}) {
      assert.equal(audience, "configured-google-audience"); verified.push(idToken);
      const payload = payloads.get(idToken); if (!payload) throw Error("Expired or invalid credential");
      return {getPayload: () => payload};
    }},
    tenantIdValue: value => String(value || "").trim(), defaultTenantId: () => "school-a",
    ensureDefaultTenant: async () => tenants.get("school-a"), ensureBootstrapGlobalAdmin: async () => {},
    getTenantDirectory: async school => tenants.get(school) || null,
    listTenantRolesByEmail: async () => [], financeAssigned: async () => false,
    getTeacherDirectory: async (email, school) => {directoryReads.push({email, school}); return email === teacherEmail && school === "school-a" ? state.directory : null;},
    getTeacherProfile: async () => ({ensembleGroups: '["A"]'}), activeTeacherSupport: async () => null,
    listStudentMaster: async () => [], listUserStudentMappings: async () => [],
    getMappedStudentsByEmail: async (email, school) => {mappingReads.push({email, school}); return [];},
    tenantLineSession: async () => {lineReads++; return state.line ? {schoolId: "school-a", account: state.account} : null;},
    tenantLineParentStudents: async () => [],
    resolveTenantLineChannel: async () => ({loginConfigured: true, botUserId: "school-a-bot"}),
    getTenantGoogleLink: async () => state.account.googleSub ? {...state.account} : null
  };
  const api = runInNewContext(source + ";({googleToken,verifyGoogle,getAccess,getTenantContext})", context);
  const request = headers => ({headers: new Headers(headers)});
  return {api, state, verified, directoryReads, mappingReads, lineReads: () => lineReads,
    access: (headers = {}, options) => api.getAccess(request(headers), options),
    tenant: (headers = {}, options) => api.getTenantContext(request(headers), options),
    google: headers => api.verifyGoogle(request(headers)), request};
}

test("a fresh explicit Google teacher credential wins over expired or different valid cookies and a stale LINE session", async () => {
  for (const stale of ["expired-google-cookie", otherToken]) {
    const h = fixture(), headers = {...teacherHeaders, cookie: cookie(stale)};
    const access = await h.access(headers);
    assert.equal(access.authenticated, true); assert.equal(access.email, teacherEmail); assert.equal(access.sub, teacherSub);
    assert.equal(access.role, "ensembleTeacher"); assert.equal(access.schoolId, "school-a");
    assert.equal(access.displayName, "正式老師姓名"); assert.equal(access.capabilities.ensemble, true);
    assert.equal(access.authSessionId, createHash("sha256").update(freshToken).digest("hex"));
    assert.deepEqual(h.verified, [freshToken]); assert.equal(h.lineReads(), 0);
    assert.deepEqual(h.directoryReads, [{email: teacherEmail, school: "school-a"}]);
    assert.deepEqual(h.mappingReads, []);
    const verified = await h.google(headers); assert.equal(verified.email, teacherEmail);
    assert.deepEqual(h.verified, [freshToken, freshToken]);
  }
});

test("invalid explicit Google headers fail with 401 instead of falling back to another Google cookie or existing LINE account", async () => {
  for (const token of ["expired-explicit-token", "not-a-google-id-token"]) for (const savedCookie of ["expired-cookie", otherToken]) {
    const h = fixture(), headers = {...teacherHeaders, "X-Google-ID-Token": token, cookie: cookie(savedCookie)};
    const context = await h.tenant(headers, {allowUnassigned: true});
    assert.equal(context.error.status, 401); assert.equal(context.access.authenticated, false);
    assert.deepEqual(h.verified, [token]); assert.equal(h.lineReads(), 0); assert.deepEqual(h.directoryReads, []);
  }
});

test("cookie-session explicitly selects Google and cannot silently downgrade to LINE when its cookie is missing or invalid", async () => {
  for (const cookies of [lineCookie, cookie("expired-cookie"), cookie("malformed%ZZcookie")]) {
    const h = fixture(), headers = {"X-Google-ID-Token": "cookie-session", cookie: cookies};
    const access = await h.access(headers), context = await h.tenant(headers, {allowUnassigned: true});
    assert.equal(access.authenticated, false); assert.equal(context.error.status, 401); assert.equal(h.lineReads(), 0);
    assert.equal(h.verified.includes(otherToken), false);
  }
  const h = fixture(), access = await h.access({"X-Google-ID-Token": "cookie-session", cookie: cookie(freshToken),
    Authorization: "Bearer " + otherToken, "X-School-Id": "school-a", "X-Role-Context": "teacher"});
  assert.equal(access.email, teacherEmail); assert.equal(access.role, "ensembleTeacher"); assert.deepEqual(h.verified, [freshToken]);
});

test("explicit LINE selection ignores Google cookies and bearer credentials without borrowing their teacher authority", async () => {
  for (const googleCookie of [freshToken, otherToken, "expired-cookie"]) {
    const h = fixture(), access = await h.access({"X-Google-ID-Token": "line-session", cookie: cookie(googleCookie), Authorization: "Bearer " + freshToken});
    assert.equal(access.authProvider, "line"); assert.equal(access.displayName, "wen"); assert.equal(access.contactEmail, "");
    assert.equal(access.role, "unassigned"); assert.equal(access.capabilities.teacherSettings, undefined);
    assert.deepEqual(h.verified, []); assert.equal(h.lineReads(), 1); assert.deepEqual(h.directoryReads, []);
  }
  const absent = fixture(); absent.state.line = false;
  assert.equal((await absent.access({"X-Google-ID-Token": "line-session", cookie: cookie(freshToken)})).authenticated, false);
  assert.deepEqual(absent.verified, []);
});

test("bearer Google credentials take precedence over cookies and fail closed when invalid or empty", async () => {
  const h = fixture(), access = await h.access({Authorization: "Bearer " + freshToken, cookie: cookie(otherToken),
    "X-School-Id": "school-a", "X-Role-Context": "teacher"});
  assert.equal(access.email, teacherEmail); assert.equal(access.role, "ensembleTeacher"); assert.deepEqual(h.verified, [freshToken]); assert.equal(h.lineReads(), 0);
  for (const authorization of ["Bearer expired-token", "Bearer", "Bearer   "]) {
    const invalid = fixture(), context = await invalid.tenant({Authorization: authorization, cookie: cookie(freshToken)}, {allowUnassigned: true});
    assert.equal(context.error.status, 401); assert.equal(invalid.lineReads(), 0);
    assert.equal(invalid.verified.includes(freshToken), false);
  }
  const explicit = fixture(), chosen = await explicit.google({"X-Google-ID-Token": freshToken, Authorization: "Bearer " + otherToken, cookie: cookie(otherToken)});
  assert.equal(chosen.email, teacherEmail); assert.deepEqual(explicit.verified, [freshToken]);
});

test("automatic cookie detection, anonymous access and LINE-only sessions retain their existing behavior", async () => {
  const auto = fixture(), google = await auto.access({cookie: cookie(freshToken)});
  assert.equal(google.role, "ensembleTeacher"); assert.equal(google.email, teacherEmail); assert.equal(auto.lineReads(), 0);
  for (const headers of [{cookie: lineCookie}, {cookie: cookie("expired-automatic-cookie")}]) {
    const h = fixture(), line = await h.access(headers);
    assert.equal(line.authProvider, "line"); assert.equal(line.role, "unassigned"); assert.equal(line.displayName, "wen"); assert.equal(h.lineReads(), 1);
  }
  const anonymous = fixture(); anonymous.state.line = false;
  assert.equal((await anonymous.access()).authenticated, false);
  assert.equal((await anonymous.tenant({}, {allowUnassigned: true})).error.status, 401);
});

test("selecting Google does not create cross-school or inactive-directory teacher privileges", async () => {
  for (const headers of [{...teacherHeaders, "X-School-Id": "school-b"}, {...teacherHeaders, "X-School-Id": ""}]) {
    const h = fixture(), context = await h.tenant({...headers, cookie: cookie(otherToken)});
    assert.equal(context.error.status, 403); assert.equal(context.access.role, "contextDenied"); assert.equal(h.lineReads(), 0);
    assert.equal(context.access.capabilities.teacherSettings, undefined); assert.equal(context.access.capabilities.admin, undefined);
  }
  const inactive = fixture(); inactive.state.directory = {status: "inactive", teacherName: "停用老師"};
  const context = await inactive.tenant({...teacherHeaders, cookie: cookie(otherToken)});
  assert.equal(context.error.status, 403); assert.equal(context.access.role, "contextDenied"); assert.equal(inactive.lineReads(), 0);
  assert.equal(context.access.capabilities.teacherSettings, undefined);
});

test("a verified canonical LINE teacher still uses its own current same-school roster rather than Google cookie identity", async () => {
  const h = fixture(); h.state.account = {...h.state.account, googleSub: teacherSub, googleEmail: teacherEmail};
  const context = await h.tenant({"X-Google-ID-Token": "line-session", cookie: cookie(otherToken),
    "X-School-Id": "school-a", "X-Role-Context": "teacher"});
  assert.equal(context.error, null); assert.equal(context.access.authProvider, "line"); assert.equal(context.access.role, "ensembleTeacher");
  assert.equal(context.access.email, teacherEmail); assert.equal(context.access.displayName, "正式老師姓名"); assert.deepEqual(h.verified, []);
});
