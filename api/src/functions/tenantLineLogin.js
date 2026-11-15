import {app} from "@azure/functions";
import {createHash} from "node:crypto";
import {getTenantContext, json, verifyGoogle, verifyGoogleToken} from "../lib/auth.js";
import {tenantIdValue, listTenantDirectory} from "../lib/storage.js";
import {listTenantLineLoginSchools,resolveTenantLineChannel} from "../lib/lineTenantConfig.js";
import {
  clearOAuthCookie, clearTenantLineSession, createTenantLineOAuth, createTenantLineSession,
  getOrCreateTenantLineAccount, getTenantGoogleLink, lineCookie,
  lineSessionCookie, linkTenantGoogle, LineAccountConflict, tenantLineSession, unlinkTenantGoogle,
  useTenantLineOAuth
} from "../lib/tenantLineAccounts.js";
import {refreshTenantLineMenu} from "../lib/tenantLineMenu.js";

const loginApi = "https://api.line.me/oauth2/v2.1/";
const startUrl = "https://access.line.me/oauth2/v2.1/authorize";
const privateHeaders = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"};

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
  if (!response.ok) throw new Error("LINE OAuth response " + response.status);
  return response.json();
}

async function tryMenuSync(channel, account, userId) {
  try {
    await refreshTenantLineMenu(channel, account, userId);
  } catch {
    console.warn("LINE menu sync deferred", {schoolId: channel.schoolId});
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
    let google;
    if (input.mode === "link") {
      google = await verifyGoogle(request);
      if (!google) return json({error: "請先用 Gmail 登入"}, 401);
      const context = await getTenantContext(request, {allowUnassigned: true});
      if (context.error) return context.error;
      if (context.schoolId !== schoolId || !["parent", "unassigned", "admin"].includes(context.access.role)) {
        return json({error: "請先切換至此校家長身分"}, 403);
      }
    }
    const txn = await createTenantLineOAuth(schoolId, channel, google);
    const url = new URL(startUrl);
    url.search = new URLSearchParams({
      response_type: "code", client_id: channel.loginId, redirect_uri: callbackUrl(channel),
      state: txn.state, nonce: txn.nonce, scope: "openid profile",
      code_challenge: createHash("sha256").update(txn.verifier).digest("base64url"),
      code_challenge_method: "S256", bot_prompt: "normal"
    });
    return {...json({url: url.toString()}), headers: privateHeaders, cookies: [txn.cookie]};
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
    try {
      const txn = await useTenantLineOAuth(request, schoolId, state, channel);
      if (!txn || !code) throw new Error("Expired or invalid authorization");
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
      let account = await getOrCreateTenantLineAccount(schoolId, channel.botUserId, userId, identity.name);
      if (txn.googleSub) {
        account = await linkTenantGoogle(schoolId, account, {sub: txn.googleSub, email: txn.googleEmail});
        resultUrl.pathname = "/fee-collections.html";
        resultUrl.searchParams.set("line_link", "ok");
      } else {
        cookies.push(lineSessionCookie(await createTenantLineSession(schoolId, account)));
        cookies.push(lineCookie("orchestra_google_id_token", "", 0));
        resultUrl.searchParams.set("line_session", schoolId);
      }
      await tryMenuSync(channel, account);
    } catch (error) {
      resultUrl.searchParams.set("line_error", error instanceof LineAccountConflict ? "conflict" : "verification");
    }
    return redirect(resultUrl, cookies);
  }
});

app.http("tenantLineLogout", {
  methods: ["POST"], route: "line/session/logout", authLevel: "anonymous",
  handler: async request => {
    if (request.headers.get("sec-fetch-site") === "cross-site") return json({error: "來源不符"}, 403);
    await clearTenantLineSession(request);
    return {...json({ok: true}), headers: privateHeaders, cookies: [lineSessionCookie(""), clearOAuthCookie()]};
  }
});

app.http("tenantLineAccount", {
  methods: ["GET", "POST", "DELETE"], route: "line/school-account", authLevel: "anonymous",
  handler: async request => {
    const context = await getTenantContext(request, {allowUnassigned: true});
    if (context.error) return context.error;
    const {schoolId, access} = context;
    if (!["parent", "unassigned", "admin"].includes(access.role)) return json({error: "無權操作此校帳號"}, 403);
    const channel = await resolveTenantLineChannel(schoolId);
    if (!channel.loginConfigured) return json({configured: false, bound: false});
    const google = await verifyGoogle(request);
    const session = !google ? await tenantLineSession(request) : null;
    const line = session?.schoolId === schoolId ? session.account : null;
    const link = google && await getTenantGoogleLink(schoolId, google.sub);
    const account = line || (link?.botUserId === channel.botUserId && link.lineUserId ? link : null);
    const result = {configured: true, bound: Boolean(account), googleLinked: Boolean(account?.googleSub),
      authProvider: line ? "line" : "google", lineDisplayName: account?.displayName || ""};
    if (request.method === "GET") return {...json(result), headers: privateHeaders};
    if (!allowedOrigin(request, channel.appOrigin)) return json({error: "來源不符"}, 403);
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
        return json({audience: await refreshTenantLineMenu(channel, account)});
      }
      if (!line || line.botUserId !== channel.botUserId) return json({error: "請先完成此校 LINE 登入"}, 403);
      const verified = await verifyGoogleToken(body?.credential);
      if (!verified) return json({error: "Gmail 驗證失敗"}, 401);
      const linked = await linkTenantGoogle(schoolId, line, verified);
      const token = await createTenantLineSession(schoolId, linked);
      await clearTenantLineSession(request);
      await tryMenuSync(channel, linked);
      return {...json({configured: true, bound: true, googleLinked: true, authProvider: "line", lineDisplayName: linked.displayName}),
        headers: privateHeaders, cookies: [lineSessionCookie(token)]};
    } catch (error) {
      if (error instanceof LineAccountConflict) return json({error: error.message}, 409);
      console.error("Tenant LINE account update failed", {schoolId, status: error?.statusCode});
      return json({error: "LINE 帳號處理失敗"}, 500);
    }
  }
});
