import {app} from "@azure/functions";
import {createHash} from "node:crypto";
import {getTenantContext, json, verifyGoogle, verifyGoogleToken} from "../lib/auth.js";
import {tenantIdValue, listTenantDirectory} from "../lib/storage.js";
import {listTenantLineLoginSchools,resolveTenantLineChannel} from "../lib/lineTenantConfig.js";
import {
  clearOAuthCookie, clearTenantLineSession, createTenantLineOAuth, createTenantLineSession,
  getOrCreateTenantLineAccount, getTenantGoogleLink, lineCookie,
  lineSessionCookie, linkTenantGoogle, LineAccountConflict, tenantLineSession, unlinkTenantGoogle,
  useTenantLineOAuth, recordTenantLineFriendship, getTenantLineAccount,
  createTenantLineLinkConfirmation, readTenantLineLinkConfirmation, clearTenantLineLinkConfirmation
} from "../lib/tenantLineAccounts.js";
import {LineMenuSyncError,refreshTenantLineMenu} from "../lib/tenantLineMenu.js";
import {restoreLabGoogleLineLink} from "../lib/tenantLineLegacyLab.js";

const loginApi = "https://api.line.me/oauth2/v2.1/";
const startUrl = "https://access.line.me/oauth2/v2.1/authorize";
const privateHeaders = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"};
const accountRoles = new Set(["parent","unassigned","admin","teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]);

function allowedOrigin(request, origin) {
  return Boolean(origin && request.headers.get("origin") === origin);
}

function callbackUrl(channel) {
  return channel.appOrigin + "/api/line/tenant-login/" + encodeURIComponent(channel.schoolId) + "/callback";
}

function redirect(url, cookies) {
  return {status: 303, headers: {...privateHeaders, Location: url.toString()}, cookies};
}

async function lineOAuthRequest(endpoint, fields) {
  const response = await fetch(loginApi + endpoint, {
    method: "POST", body: new URLSearchParams(fields), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    // Classify provider failures without returning or logging OAuth credentials,
    // authorization codes, tokens, or the provider's raw response text.
    const detail = await response.json().catch(() => ({}));
    const code = String(detail?.error || "");
    const description = String(detail?.error_description || "").slice(0, 300);
    const configuration = endpoint === "token" && (response.status === 401 || code === "invalid_client" ||
      code === "invalid_request" && /client[_\s-]?(?:id|secret)|redirect[_\s-]?uri/i.test(description));
    const error = new Error("LINE OAuth response " + response.status);
    error.lineFailure = configuration ? "configuration" : endpoint === "token" && code === "invalid_grant" ? "authorization" : "verification";
    throw error;
  }
  return response.json();
}

async function tryMenuSync(channel, account, userId) {
  try {
    const audience = await refreshTenantLineMenu(channel, account, userId);
    if (["staff", "parent", "default"].includes(audience)) return {status: "synced", audience};
    return {status: "pending", message: "帳號綁定已完成，選單版型尚未準備完成；不需重新綁定或指派人員。"};
  } catch (error) {
    console.warn("LINE menu sync deferred", {schoolId: channel.schoolId});
    return {status: "pending", message: error instanceof LineMenuSyncError ? error.message : "帳號綁定已完成，選單暫時無法更新；可稍後重試，不需重新綁定。"};
  }
}

async function checkFriendship(channel, userId, accessToken) {
  if (!accessToken) return;
  const checkedAt = Date.now();
  try {
    const response = await fetch("https://api.line.me/friendship/v1/status", {
      headers: {Authorization: `Bearer ${accessToken}`}, signal: AbortSignal.timeout(2500)
    });
    if (response.ok) {
      const {friendFlag} = await response.json();
      await recordTenantLineFriendship(channel.schoolId, channel.botUserId, userId, friendFlag, checkedAt);
    }
  } catch {
    console.warn("LINE friendship check deferred", {schoolId: channel.schoolId});
  }
}

app.http("tenantLineLoginSchools", {
  methods: ["GET"], route: "line/login-schools", authLevel: "anonymous",
  handler: async () => {
    const schools = (await listTenantDirectory()).filter(school => ["active", "onboarding"].includes(school.status));
    return {...json({items: await listTenantLineLoginSchools(schools)}), headers: privateHeaders};
  }
});

app.http("tenantLineLoginStart", {
  methods: ["POST"], route: "line/tenant-login/{schoolId}/start", authLevel: "anonymous",
  handler: async request => {
    const schoolId = request.params.schoolId;
    if (!schoolId || tenantIdValue(schoolId) !== schoolId) return json({error: "學校不存在"}, 404);
    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.loginConfigured) return json({error: "此校尚未開啟 LINE 登入"}, 409);
    if (!allowedOrigin(request, channel.appOrigin)) return json({error: "來源不符"}, 403);
    const input = await request.json().catch(() => null);
    if (!["login", "link"].includes(input?.mode)) return json({error: "操作不正確"}, 400);
    if (Object.hasOwn(input, "returnTo") && input.returnTo !== "notification-center") return json({error: "返回位置不正確"}, 400);
    const returnToCenter = input.returnTo === "notification-center";
    if (returnToCenter && input.mode !== "link") return json({error: "此返回位置僅適用於管理員綁定帳號"}, 400);
    let google;
    if (input.mode === "link") {
      google = await verifyGoogle(request);
      if (!google) return json({error: "請先用 Gmail 登入"}, 401);
      const context = await getTenantContext(request, {allowUnassigned: true});
      if (context.error) return context.error;
      if (context.schoolId !== schoolId || !accountRoles.has(context.access.role)) {
        return json({error: "請先切換至此校已授權的身分"}, 403);
      }
      if (returnToCenter && context.access.role !== "admin") return json({error: "僅學校管理員可返回 LINE 通知中心"}, 403);
    }
    const txn = await createTenantLineOAuth(schoolId, channel, google, returnToCenter ? {returnTo: "notification-center"} : undefined);
    const url = new URL(startUrl);
    url.search = new URLSearchParams({
      response_type: "code", client_id: channel.loginId, redirect_uri: callbackUrl(channel),
      state: txn.state, nonce: txn.nonce, scope: "openid profile",
      code_challenge: createHash("sha256").update(txn.verifier).digest("base64url"),
      code_challenge_method: "S256", bot_prompt: "normal"
    });
    return {...json({url: url.toString()}), headers: privateHeaders, cookies: [txn.cookie, clearTenantLineLinkConfirmation()]};
  }
});

app.http("tenantLineLoginCallback", {
  methods: ["GET"], route: "line/tenant-login/{schoolId}/callback", authLevel: "anonymous",
  handler: async request => {
    const schoolId = request.params.schoolId;
    if (!schoolId || tenantIdValue(schoolId) !== schoolId) return json({error: "學校不存在"}, 404);
    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.loginConfigured) return json({error: "此校尚未開啟 LINE 登入"}, 409);
    const resultUrl = new URL("/", channel.appOrigin);
    const cookies = [clearOAuthCookie()];
    const state = request.query.get("state"), code = request.query.get("code");
    let failure = "authorization";
    try {
      const txn = await useTenantLineOAuth(request, schoolId, state, channel);
      // The destination is a fixed enum stored during the authenticated start.
      // Never accept a redirect path or destination from the callback query.
      if (txn?.googleSub && txn.returnTo === "notification-center") {
        // Restore the authenticated school workspace so the original account
        // context and Global switch remain available around the account panel.
        resultUrl.searchParams.set("adminLineAccount", schoolId);
      }
      if (!txn || !code) throw new Error("Expired or invalid authorization");
      failure = "verification";
      if(txn.googleSub && txn.returnTo !== "notification-center")resultUrl.pathname="/line-account.html";
      const tokens = await lineOAuthRequest("token", {
        grant_type: "authorization_code", code, redirect_uri: callbackUrl(channel), client_id: channel.loginId,
        client_secret: channel.loginSecret, code_verifier: txn.verifier
      });
      if (!tokens.id_token) throw new Error("Missing ID token");
      const identity = await lineOAuthRequest("verify", {id_token: tokens.id_token, client_id: channel.loginId, nonce: txn.nonce});
      if (identity.iss !== "https://access.line.me" || String(identity.aud) !== channel.loginId ||
          identity.nonce !== txn.nonce || !/^U[0-9a-f]{32}$/i.test(identity.sub || "")) {
        throw new Error("Unverified LINE identity");
      }
      const userId = identity.sub.toLowerCase().replace(/^u/, "U");
      const account = await getOrCreateTenantLineAccount(schoolId, channel.botUserId, userId, identity.name);
      if (txn.googleSub) {
        const pending = await createTenantLineLinkConfirmation(schoolId, account,
          {sub: txn.googleSub, email: txn.googleEmail}, "google");
        cookies.push(pending.cookie);
        resultUrl.searchParams.set("line_link", "confirm");
      } else {
        cookies.push(lineSessionCookie(await createTenantLineSession(schoolId, account)));
        cookies.push(lineCookie("orchestra_google_id_token", "", 0));
        resultUrl.searchParams.set("line_session", schoolId);
      }
      await Promise.all([txn.googleSub ? undefined : tryMenuSync(channel, account), checkFriendship(channel, userId, tokens.access_token)]);
    } catch (error) {
      const reason = error instanceof LineAccountConflict ? "conflict" :
        ["configuration", "authorization", "verification"].includes(error?.lineFailure) ? error.lineFailure : failure;
      resultUrl.searchParams.set("line_error", reason);
      console.warn("LINE authorization callback failed", {schoolId, reason});
    }
    return redirect(resultUrl, cookies);
  }
});

app.http("tenantLineLogout", {
  methods: ["POST"], route: "line/session/logout", authLevel: "anonymous",
  handler: async request => {
    if (request.headers.get("sec-fetch-site") === "cross-site") return json({error: "來源不符"}, 403);
    await clearTenantLineSession(request);
    return {...json({ok: true}), headers: privateHeaders, cookies: [lineSessionCookie(""), clearOAuthCookie(), clearTenantLineLinkConfirmation()]};
  }
});

app.http("tenantLineAccount", {
  methods: ["GET", "POST", "DELETE"], route: "line/school-account", authLevel: "anonymous",
  handler: async request => {
    const context = await getTenantContext(request, {allowUnassigned: true});
    if (context.error) return context.error;
    const {schoolId, access} = context;
    if (!accountRoles.has(access.role)) return json({error: "無權操作此校帳號"}, 403);
    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.loginConfigured) return json({configured: false, bound: false});
    const google = await verifyGoogle(request);
    const session = !google ? await tenantLineSession(request) : null;
    const line = session?.schoolId === schoolId ? session.account : null;
    const link = google && await getTenantGoogleLink(schoolId, google.sub);
    const sameOrigin=allowedOrigin(request,channel.appOrigin);
    const pending = await readTenantLineLinkConfirmation(request, channel, google, line);
    const currentLink=!pending&&google&&access.role==="parent"&&(request.method==="GET"||request.method==="POST"&&sameOrigin)
      ? await restoreLabGoogleLineLink(schoolId,channel,google,link):link;
    const account = line || (currentLink?.botUserId === channel.botUserId && currentLink.lineUserId ? currentLink : null);
    const result = {configured: true, bound: Boolean(account), googleLinked: Boolean(account?.googleSub),
      authProvider: line ? "line" : "google", lineDisplayName: account?.displayName || "",
      ...(pending ? {pendingLink: {confirmationId: pending.rowKey, googleEmail: pending.googleEmail, lineDisplayName: pending.lineDisplayName}} : {})};
    if (request.method === "GET") return {...json(result), headers: privateHeaders};
    if (!sameOrigin) return json({error: "來源不符"}, 403);
    try {
      if (request.method === "DELETE") {
        if (!google) return json({error: "請切換為 Gmail 登入後再解除 LINE 綁定"}, 409);
        const removed = await unlinkTenantGoogle(schoolId, google.sub);
        if (removed?.botUserId === channel.botUserId) await tryMenuSync(channel, null, removed.lineUserId);
        return json({configured: true, bound: false});
      }
      const body = await request.json().catch(() => ({}));
      if (body?.action === "sync-menu") {
        if (!account) return json({error: "請先連結 LINE 帳號"}, 409);
        const result = await refreshTenantLineMenu(channel, account, undefined, {verify: true, expectStaff: access.role === "admin"});
        return json(typeof result === "string" ? {audience: result} : result);
      }
      if (["confirm-link", "cancel-link"].includes(body.action)) {
        const confirmationId = typeof body.confirmationId === "string" ? body.confirmationId : "";
        const pair = await readTenantLineLinkConfirmation(request, channel, google, line, confirmationId);
        if (!pair) return json({error: "帳號確認已逾時或變更，請重新核對 Gmail 與 LINE"}, 409);
        const cleared = [clearTenantLineLinkConfirmation()];
        if (body.action === "cancel-link") return {...json({ok: true}), headers: privateHeaders, cookies: cleared};
        const verifiedLine = await getTenantLineAccount(schoolId, channel.botUserId, pair.lineUserId);
        if (!verifiedLine) return {...json({error: "LINE 帳號已變更，請重新開始綁定"}, 409), cookies: cleared};
        const linked = await linkTenantGoogle(schoolId, verifiedLine, {sub: pair.googleSub, email: pair.googleEmail});
        if (line) {
          const token = await createTenantLineSession(schoolId, linked);
          await clearTenantLineSession(request);
          cleared.push(lineSessionCookie(token));
        }
        const menuSync = await tryMenuSync(channel, linked);
        return {...json({configured: true, bound: true, googleLinked: true, authProvider: line ? "line" : "google",
          lineDisplayName: linked.displayName, menuSync}), headers: privateHeaders, cookies: cleared};
      }
      if (!line || line.botUserId !== channel.botUserId) return json({error: "請先完成此校 LINE 登入"}, 403);
      const verified = await verifyGoogleToken(body?.credential);
      if (!verified) return json({error: "Gmail 驗證失敗"}, 401);
      const {cookie, confirmationId} = await createTenantLineLinkConfirmation(schoolId, line, verified, "line");
      return {...json({...result, pendingLink: {confirmationId, googleEmail: verified.email, lineDisplayName: line.displayName || ""}}),
        headers: privateHeaders, cookies: [cookie]};
    } catch (error) {
      if (error instanceof LineAccountConflict || error instanceof LineMenuSyncError) return json({error: error.message}, 409);
      console.error("Tenant LINE account update failed", {schoolId, status: error?.statusCode});
      return json({error: "LINE 帳號處理失敗"}, 500);
    }
  }
});
