import {app} from "@azure/functions";
import {createHash} from "node:crypto";
import {getTenantContext, json, verifyGoogle, verifyGoogleToken} from "../lib/auth.js";
import {tenantIdValue, listTenantDirectory} from "../lib/storage.js";
import {listTenantLineLoginSchools,resolveTenantLineChannel} from "../lib/lineTenantConfig.js";
import {
  clearOAuthCookie, clearTenantLineSession, createTenantLineOAuth, createTenantLineSession,
  getOrCreateTenantLineAccount, getTenantGoogleLink, lineCookie,
  lineSessionCookie, linkTenantGoogle, LineAccountConflict, tenantLineSession, unlinkTenantGoogle,
  useTenantLineOAuth, recordTenantLineFriendship, getTenantLineFriendship, getTenantLineAccount,
  createTenantLineLinkConfirmation, readTenantLineLinkConfirmation, clearTenantLineLinkConfirmation
} from "../lib/tenantLineAccounts.js";
import {LineMenuSyncError,refreshTenantLineMenu} from "../lib/tenantLineMenu.js";
import {restoreLabGoogleLineLink} from "../lib/tenantLineLegacyLab.js";
import {notifyParentLineApproval,flushParentLineApprovalNotices} from "../lib/parentLineApprovalNotice.js";

const loginApi = "https://api.line.me/oauth2/v2.1/";
const startUrl = "https://access.line.me/oauth2/v2.1/authorize";
const privateHeaders = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"};
const accountRoles = new Set(["parent","unassigned","admin","teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]);
const teacherAccountRoles = new Set(["teacher","sectionTeacher","ensembleTeacher","comprehensiveTeacher","privateTeacher"]);

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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await refreshTenantLineMenu(channel, account, userId, {details: true});
      const audience = typeof result === "string" ? result : result?.audience;
      if (["staff", "parent", "default"].includes(audience)) return {status: "synced", audience,
        ...(Number.isInteger(result?.areaCount) ? {areaCount: result.areaCount} : {})};
      return {status: "pending", message: "帳號綁定已完成，選單版型尚未準備完成；學校管理員確認後，下次 LINE 操作會自動更新，不需重新綁定或手動同步。"};
    } catch (error) {
      const transient = !(error instanceof LineMenuSyncError) &&
        ([500, 502, 503, 504].includes(Number(error?.status || error?.statusCode)) || ["AbortError", "TimeoutError"].includes(error?.name) || ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error?.code || error?.cause?.code));
      if (attempt === 0 && transient && account && channel.botUserId) {
        try {
          // A retry must use the live identity, not a captured link that may
          // have been removed or paired with another Gmail in the meantime.
          const target = userId || account.lineUserId;
          const current = await getTenantLineAccount(channel.schoolId, channel.botUserId, target);
          if (current?.botUserId === channel.botUserId && current.lineUserId === target &&
              (!current.partitionKey || current.partitionKey === channel.schoolId) && (!current.schoolId || current.schoolId === channel.schoolId) &&
              current.googleSub === account.googleSub && current.parentEmail === account.parentEmail) {
            account = current;
            continue;
          }
        } catch { /* Keep the completed identity link; a later LINE interaction can retry. */ }
      }
      console.warn("LINE menu sync deferred", {schoolId: channel.schoolId});
      return {status: "pending", message: error instanceof LineMenuSyncError ? error.message : "帳號綁定已完成，選單暫時無法更新；下次 LINE 操作會自動再試，不需重新綁定或手動同步。"};
    }
  }
}

async function checkFriendship(channel, userId, accessToken) {
  if (!accessToken) return false;
  const checkedAt = Date.now();
  try {
    const response = await fetch("https://api.line.me/friendship/v1/status", {
      headers: {Authorization: `Bearer ${accessToken}`}, signal: AbortSignal.timeout(2500)
    });
    if (response.ok) {
      const {friendFlag} = await response.json();
      if (typeof friendFlag !== "boolean") return false;
      await recordTenantLineFriendship(channel.schoolId, channel.botUserId, userId, friendFlag, checkedAt);
      return friendFlag ? "friend" : "not_friend";
    }
  } catch {
    console.warn("LINE friendship check deferred", {schoolId: channel.schoolId});
  }
  return false;
}

function sameAccount(account, schoolId, botUserId, userId) {
  return account?.botUserId === botUserId && account.lineUserId === userId && account.parentEmail &&
    (!account.partitionKey || account.partitionKey === schoolId) && (!account.schoolId || account.schoolId === schoolId);
}

async function currentFriendshipAccount(schoolId, channel, expected) {
  const account = await getTenantLineAccount(schoolId, channel.botUserId, expected.expectedLineUserId);
  if (!sameAccount(account, schoolId, channel.botUserId, expected.expectedLineUserId) ||
      account.parentEmail !== expected.expectedParentEmail || (account.googleSub || "") !== (expected.expectedGoogleSub || "")) return null;
  if (expected.friendshipInitiator === "google") {
    const link = await getTenantGoogleLink(schoolId, expected.googleSub);
    if (!expected.googleSub || account.googleSub !== expected.googleSub || account.googleEmail !== expected.googleEmail || !sameAccount(link, schoolId, channel.botUserId, expected.expectedLineUserId) ||
        link.googleSub !== expected.googleSub || link.parentEmail !== account.parentEmail || link.googleEmail !== expected.googleEmail) return null;
  }
  return account;
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
    if (!["login", "link", "friendship"].includes(input?.mode)) return json({error: "操作不正確"}, 400);
    if (Object.hasOwn(input, "returnTo") && !["notification-center", "teacher-account", "parent-account"].includes(input.returnTo)) return json({error: "返回位置不正確"}, 400);
    const returnToCenter = input.returnTo === "notification-center";
    const returnToTeacher = input.returnTo === "teacher-account";
    const returnToParent = input.returnTo === "parent-account";
    if ((returnToCenter || returnToTeacher || returnToParent) && !["link", "friendship"].includes(input.mode)) return json({error: "此返回位置僅適用於綁定帳號"}, 400);
    let google, friendshipOptions;
    if (input.mode === "link") {
      google = await verifyGoogle(request);
      if (!google) return json({error: "請先用 Gmail 登入"}, 401);
      const context = await getTenantContext(request, {allowUnassigned: true});
      if (context.error) return context.error;
      if (context.schoolId !== schoolId || !accountRoles.has(context.access.role)) {
        return json({error: "請先切換至此校已授權的身分"}, 403);
      }
      if (returnToCenter && context.access.role !== "admin") return json({error: "僅學校管理員可返回 LINE 通知中心"}, 403);
      if (returnToTeacher && !teacherAccountRoles.has(context.access.role)) return json({error: "僅同校老師可返回老師 LINE 綁定"}, 403);
      if (returnToParent && context.access.role !== "parent") return json({error: "僅同校已核准家長可返回家長 LINE 綁定"}, 403);
    }
    if (input.mode === "friendship") {
      const context = await getTenantContext(request, {allowUnassigned: true});
      if (context.error) return context.error;
      if (context.schoolId !== schoolId || !accountRoles.has(context.access.role)) return json({error: "請先切換至此校已授權的身分"}, 403);
      if (returnToCenter && context.access.role !== "admin" || returnToTeacher && !teacherAccountRoles.has(context.access.role) ||
          returnToParent && context.access.role !== "parent") return json({error: "返回身分不符"}, 403);
      const fromLine = context.access.authProvider === "line" || request.headers.get("x-google-id-token") === "line-session";
      let account;
      if (fromLine) {
        const session = await tenantLineSession(request);
        if (session?.schoolId !== schoolId) return json({error: "請先使用此校 LINE 登入"}, 401);
        account = session.account;
      } else {
        google = await verifyGoogle(request);
        if (!google) return json({error: "請先登入後再確認好友狀態"}, 401);
        const link = await getTenantGoogleLink(schoolId, google.sub);
        if (!link || link.botUserId !== channel.botUserId || !link.lineUserId || link.googleSub !== google.sub || link.googleEmail !== google.email) return json({error: "請先完成此校 LINE 綁定"}, 409);
        account = await getTenantLineAccount(schoolId, channel.botUserId, link.lineUserId);
        if (!sameAccount(account, schoolId, channel.botUserId, link.lineUserId) || account.googleSub !== google.sub || account.googleEmail !== google.email || account.parentEmail !== link.parentEmail) return json({error: "此校 LINE 綁定已變更，請重新讀取"}, 409);
      }
      if (!sameAccount(account, schoolId, channel.botUserId, account?.lineUserId) || !/^U[0-9a-f]{32}$/i.test(account.lineUserId || "")) return json({error: "請先完成此校 LINE 綁定"}, 409);
      friendshipOptions = {purpose: "friendship", expectedLineUserId: account.lineUserId, expectedParentEmail: account.parentEmail,
        expectedGoogleSub: account.googleSub || "", friendshipInitiator: fromLine ? "line" : "google",
        ...(!fromLine && (returnToCenter || returnToTeacher || returnToParent) ? {returnTo: input.returnTo} : {})};
    }
    const txn = await createTenantLineOAuth(schoolId, channel, google, friendshipOptions || (returnToCenter || returnToTeacher || returnToParent ? {returnTo: input.returnTo} : undefined));
    const url = new URL(startUrl);
    url.search = new URLSearchParams({
      response_type: "code", client_id: channel.loginId, redirect_uri: callbackUrl(channel),
      state: txn.state, nonce: txn.nonce, scope: "openid profile",
      code_challenge: createHash("sha256").update(txn.verifier).digest("base64url"),
      code_challenge_method: "S256", bot_prompt: "aggressive"
    });
    const cookies = [txn.cookie, ...(input.mode === "friendship" ? [] : [clearTenantLineLinkConfirmation()])];
    if (returnToTeacher || returnToParent || friendshipOptions?.friendshipInitiator === "google") {
      // iOS may return from LINE in a new browser tab without sessionStorage.
      // Persist only the exact Google credential verified for this transaction;
      // an existing cookie may otherwise have taken precedence over the header.
      const credential = String(request.headers.get("x-google-id-token") || "").trim();
      if (credential && !["cookie-session", "line-session"].includes(credential) &&
          google?.authSessionId === createHash("sha256").update(credential).digest("hex")) {
        cookies.push(lineCookie("orchestra_google_id_token", credential, 3600));
      }
    }
    return {...json({url: url.toString()}), headers: privateHeaders, cookies};
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
    let failure = "authorization", friendshipTxn = null;
    try {
      const txn = await useTenantLineOAuth(request, schoolId, state, channel);
      if (txn?.purpose === "friendship") {
        friendshipTxn = txn;
        resultUrl.pathname = "/line-account.html";
        resultUrl.searchParams.set("schoolId", schoolId);
      }
      // The destination is a fixed enum stored during the authenticated start.
      // Never accept a redirect path or destination from the callback query.
      const googleReturn = txn?.googleSub && (!friendshipTxn || txn.friendshipInitiator === "google");
      if (googleReturn && txn.returnTo === "notification-center") {
        // Restore the authenticated school workspace so the original account
        // context and Global switch remain available around the account panel.
        resultUrl.pathname = "/";resultUrl.searchParams.delete("schoolId");resultUrl.searchParams.set("adminLineAccount", schoolId);
      }
      if (googleReturn && txn.returnTo === "teacher-account") {resultUrl.pathname = "/";resultUrl.searchParams.delete("schoolId");resultUrl.searchParams.set("teacherLineAccount", schoolId);}
      if (googleReturn && txn.returnTo === "parent-account") {resultUrl.pathname = "/";resultUrl.searchParams.delete("schoolId");resultUrl.searchParams.set("parentLineAccount", schoolId);}
      if (googleReturn && (!txn.purpose || txn.purpose === "friendship") && ["teacher-account", "parent-account"].includes(txn.returnTo)) {
        // The verified start preserved this Gmail credential in an HttpOnly
        // cookie. A resumed tab may still hold an older raw token; let the
        // existing first-boot handoff select the cookie for this fixed return.
        resultUrl.searchParams.set("google_redirect", "1");
      }
      if (!txn || !code) throw new Error("Expired or invalid authorization");
      if (txn.purpose && txn.purpose !== "friendship") throw new Error("Invalid authorization purpose");
      failure = "verification";
      if(googleReturn && !["notification-center", "teacher-account", "parent-account"].includes(txn.returnTo))resultUrl.pathname="/line-account.html";
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
      if (friendshipTxn) {
        if (!["google", "line"].includes(txn.friendshipInitiator) ||
            userId !== txn.expectedLineUserId || !await currentFriendshipAccount(schoolId, channel, txn)) {
          resultUrl.searchParams.set("line_friend", "mismatch");
          return redirect(resultUrl, cookies);
        }
        const checked = await checkFriendship(channel, userId, tokens.access_token);
        if (checked === "friend") {
          try { await flushParentLineApprovalNotices(schoolId, channel.botUserId, userId); }
          catch { /* Friendship and account identity remain valid if a receipt is deferred. */ }
        }
        resultUrl.searchParams.set("line_friend", checked ? "checked" : "unavailable");
        return redirect(resultUrl, cookies);
      }
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
      await Promise.all([txn.googleSub ? undefined : tryMenuSync(channel, account), checkFriendship(channel, userId, tokens.access_token).then(async checked => {
        if (checked === "friend") {
          try { await flushParentLineApprovalNotices(schoolId, channel.botUserId, userId); }
          catch { /* Only existing approval intents may be deferred after login. */ }
        }
      })]);
    } catch (error) {
      const reason = error instanceof LineAccountConflict ? "conflict" :
        ["configuration", "authorization", "verification"].includes(error?.lineFailure) ? error.lineFailure : failure;
      resultUrl.searchParams.set(friendshipTxn ? "line_friend" : "line_error", friendshipTxn ? "unavailable" : reason);
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
    const google = access.authProvider === "line" || request.headers.get("x-google-id-token") === "line-session" ? null : await verifyGoogle(request);
    const session = !google ? await tenantLineSession(request) : null;
    const line = session?.schoolId === schoolId ? session.account : null;
    const link = google && await getTenantGoogleLink(schoolId, google.sub);
    const sameOrigin=allowedOrigin(request,channel.appOrigin);
    const pending = await readTenantLineLinkConfirmation(request, channel, google, line);
    const currentLink=!pending&&google&&access.role==="parent"&&(request.method==="GET"||request.method==="POST"&&sameOrigin)
      ? await restoreLabGoogleLineLink(schoolId,channel,google,link):link;
    const account = line || (currentLink?.botUserId === channel.botUserId && currentLink.lineUserId ? currentLink : null);
    let friendship = {status: "unknown", checkedAt: null};
    if (account) {
      try { friendship = await getTenantLineFriendship(schoolId, channel.botUserId, account.lineUserId); }
      catch { console.warn("Own LINE friendship status unavailable", {schoolId}); }
    }
    const result = {configured: true, bound: Boolean(account), googleLinked: Boolean(account?.googleSub),
      authProvider: line ? "line" : "google", lineDisplayName: account?.displayName || "",
      friendStatus: friendship.status, friendCheckedAt: friendship.checkedAt,
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
        let lineNotification;
        try { lineNotification = await notifyParentLineApproval(schoolId, {parentEmail: linked.parentEmail, expectedLineUserId: linked.lineUserId}); }
        catch { lineNotification = {status: "pending"}; }
        return {...json({configured: true, bound: true, googleLinked: true, authProvider: line ? "line" : "google",
          lineDisplayName: linked.displayName, menuSync, lineNotification}), headers: privateHeaders, cookies: cleared};
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
