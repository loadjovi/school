import test from "node:test";
import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (path, globals, result = "") => runInNewContext(
  source(path).replace(/^import\s+[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "") + result, globals
);
const missing = statusCode => Object.assign(new Error(), {statusCode});
const botId = "U" + "a".repeat(32);
const userId = "U" + "b".repeat(32);
const google = {sub: "google-id", email: "parent@example.com"};

function dataTables() {
  const rows = new Map();
  let version = 0;
  const key = (p, r) => JSON.stringify([p, r]);
  function apply(table, action, row, options) {
    const id = key(row.partitionKey, row.rowKey), old = table.get(id);
    if (action === "create" && old) throw missing(409);
    if (action !== "create" && !old) throw missing(404);
    if (options?.etag && old.etag !== options.etag) throw missing(412);
    if (action === "delete") table.delete(id);
    else table.set(id, {...row, etag: String(++version)});
  }
  const db = {
    async createTable() {},
    async getEntity(partition, row) {
      const item = rows.get(key(partition, row));
      if (!item) throw missing(404);
      return {...item};
    },
    async createEntity(row) {apply(rows, "create", row);},
    async deleteEntity(partitionKey, rowKey, options) {apply(rows, "delete", {partitionKey, rowKey}, options);},
    async updateEntity(row, mode, options) {apply(rows, "update", {...rows.get(key(row.partitionKey, row.rowKey)), ...row}, options);},
    async *listEntities({queryOptions: {filter}}) {
      const [, partition, bot, start, end] = /^PartitionKey eq '(.*?)' and botUserId eq '(.*?)' and RowKey ge '(.*?)' and RowKey lt '(.*?)'$/.exec(filter);
      for (const row of rows.values()) {
        if (row.partitionKey === partition && row.botUserId === bot && row.rowKey >= start && row.rowKey < end) yield {...row};
      }
    },
    async submitTransaction(actions) {
      const draft = new Map(rows);
      for (const action of actions) apply(draft, action[0], action[1], action[3]);
      rows.clear();
      for (const [id, row] of draft) rows.set(id, row);
    }
  };
  return {TableClient: {fromConnectionString: () => db}, rows};
}

function identities(studentRows = new Set()) {
  return load("api/src/lib/tenantLineAccounts.js", {
    ...dataTables(), createHash, randomBytes, randomUUID, process: {env: {}},
    defaultTenantId: () => "sacred-heart", tenantSchoolPartition: value => value,
    getMappedStudentsByEmail: async (email, school) => studentRows.has(school + "|" + email) ? [{}] : [],
    getRegistrationsByEmail: async () => []
  }, ";({getOrCreateTenantLineAccount,getTenantGoogleLink,getTenantLineRecipient,getTenantLineParentContact,linkTenantGoogle,unlinkTenantGoogle,createTenantLineSession,tenantLineSession,createTenantLineOAuth,useTenantLineOAuth,recordTenantLineFriendship,listTenantLineRecipientStatuses})");
}

test("both login methods resolve a single account without crossing schools", async () => {
  const students = new Set(), store = identities(students);
  const a = await store.getOrCreateTenantLineAccount("school-a", botId, userId, "家長");
  const b = await store.getOrCreateTenantLineAccount("school-b", botId, userId, "家長");
  students.add("school-a|" + a.parentEmail);
  const linkedA = await store.linkTenantGoogle("school-a", a, google);
  const linkedB = await store.linkTenantGoogle("school-b", b, google);
  assert.equal(linkedA.parentEmail, a.parentEmail);
  assert.equal(linkedB.parentEmail, google.email);
  assert.equal((await store.getTenantGoogleLink("school-a", google.sub)).parentEmail, a.parentEmail);
  assert.equal(await store.getTenantLineRecipient("school-b", a.parentEmail, botId), null);
  assert.equal(await store.getTenantLineParentContact("school-a", a.parentEmail), google.email);
  assert.equal(await store.getTenantLineParentContact("school-b", a.parentEmail), "");
  const cookie = await store.createTenantLineSession("school-a", linkedA);
  const request = {headers: new Headers({cookie: "__Host-school-line-session=" + cookie})};
  assert.equal((await store.tenantLineSession(request)).schoolId, "school-a");
  await store.unlinkTenantGoogle("school-a", google.sub);
  assert.equal(await store.tenantLineSession(request), null);
  assert.equal((await store.getTenantGoogleLink("school-a", google.sub)).parentEmail, a.parentEmail);
  assert.equal(await store.getTenantLineParentContact("school-a", a.parentEmail), google.email);
  assert.equal((await store.getTenantGoogleLink("school-b", google.sub)).lineUserId, userId);
});

test("ambiguous links with both accounts holding school history do not change either account", async () => {
  const rows = new Set(), store = identities(rows);
  const a = await store.getOrCreateTenantLineAccount("school-a", botId, userId, "家長");
  rows.add("school-a|" + a.parentEmail);
  rows.add("school-a|" + google.email);
  await assert.rejects(store.linkTenantGoogle("school-a", a, google), /各有學生紀錄/);
  assert.equal(await store.getTenantGoogleLink("school-a", google.sub), null);
});

test("LINE OAuth state is one-use and bound to browser, school, and configuration", async () => {
  const store = identities(), config = {oauthVersion: "A"};
  const txn = await store.createTenantLineOAuth("school-a", config, google);
  const headers = new Headers({cookie: txn.cookie.name + "=" + txn.cookie.value});
  assert.equal(await store.useTenantLineOAuth({headers: new Headers()}, "school-a", txn.state, config), null);
  assert.equal(await store.useTenantLineOAuth({headers}, "school-b", txn.state, config), null);
  assert.equal(await store.useTenantLineOAuth({headers}, "school-a", txn.state, {oauthVersion: "B"}), null);
  const results = await Promise.all([
    store.useTenantLineOAuth({headers}, "school-a", txn.state, config),
    store.useTenantLineOAuth({headers}, "school-a", txn.state, config)
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean).nonce, txn.nonce);
});

test("LINE authentication never reads students for a different school or staff context", async () => {
  let reads = 0;
  const {lineParentAccess} = load("api/src/lib/auth.js", {
    OAuth2Client: class {}, tenantLineSession: async () => ({schoolId: "school-a", account: {botUserId: botId}}),
    resolveTenantLineChannel: async () => ({loginConfigured: true, botUserId: botId}),
    tenantLineParentStudents: async () => {reads++;return [];},
    getTenantDirectory: async () => ({status: "active"})
  }, ";({lineParentAccess})");
  for (const headers of [{"X-School-Id": "school-b"}, {"X-Role-Context": "teacher"}]) {
    assert.equal((await lineParentAccess({headers: new Headers(headers)})).role, "contextDenied");
  }
  assert.equal(reads, 0);
});

test("student parent links expose LINE status only to the school's admin", async () => {
  let handler;
  let role = "parent";
  let lookups = 0;
  let botAvailable = true;
  load("api/src/functions/studentParentLinks.js", {
    app: {http(name, options) { handler = options.handler; }},
    getTenantContext: async () => ({schoolId: "school-a", access: {role}}),
    getStudentAliasInfo: async () => ({}), json: (items, status = 200) => ({items, status}),
    ensureTenantTables: async () => {}, tenantSchoolPartition: id => id,
    table: () => ({async *listEntities() {
      yield {rowKey: "100001", parentEmail: google.email};
      yield {rowKey: "100002", parentEmail: "other@example.com"};
    }}),
    resolveTenantLineChannel: async () => ({botUserId: botAvailable ? botId : ""}),
    listTenantLineRecipientStatuses: async (schoolId, bot) => {
      lookups++;
      assert.equal(schoolId, "school-a");
      assert.equal(bot, botId);
      return new Map([[google.email, {status: "friend", checkedAt: 1000}]]);
    }
  });
  const request = {method: "GET", query: new URLSearchParams("includeLineStatus=1")};
  assert.equal((await handler(request)).status, 403);
  assert.equal(lookups, 0);
  role = "admin";
  const linked = (await handler(request)).items.items;
  assert.equal(linked[0].lineBound, true);
  assert.equal(linked[0].lineFriendStatus, "friend");
  assert.equal(linked[0].lineFriendCheckedAt, 1000);
  assert.equal(linked[1].lineBound, false);
  assert.equal(Object.hasOwn(linked[0], "lineUserId"), false);
  assert.equal((await handler({...request, query: new URLSearchParams()})).items.items[0].lineBound, undefined);
  botAvailable = false;
  assert.equal((await handler(request)).items.items[0].lineBound, null);
  assert.equal(lookups, 1);
});

test("student LINE coverage preserves binding and uses the latest friendship for the same school and bot", async () => {
  const store = identities();
  const account = await store.getOrCreateTenantLineAccount("school-a", botId, userId, "家長");
  const lookup = (school = "school-a", bot = botId) => store.listTenantLineRecipientStatuses(school, bot);
  assert.equal((await lookup()).get(account.parentEmail).status, "unknown");
  await store.recordTenantLineFriendship("school-a", botId, userId, true, 1000);
  assert.equal((await lookup()).get(account.parentEmail).status, "friend");
  await store.recordTenantLineFriendship("school-a", botId, userId, false, 2000);
  await store.recordTenantLineFriendship("school-a", botId, userId, true, 1500);
  assert.equal((await lookup()).get(account.parentEmail).status, "not_friend");
  assert.equal((await lookup()).get(account.parentEmail).checkedAt, 2000);
  assert.equal((await lookup("school-b")).size, 0);
  assert.equal((await lookup("school-a", "U" + "c".repeat(32))).size, 0);
});

test("parent home keeps the service card and syncs with the active school account", async () => {
  const state = {me: {role: "parent", capabilities: {lineAccount: true, feeCollections: true}}, page: "home"};
  const calls = [];
  const file = source("app/app-v3.js");
  const {tenantServicesEntry, syncOwnLineMenu} = runInNewContext(
    file.slice(file.indexOf("async function syncOwnLineMenu("), file.indexOf("async function renderLogin(")) +
    ";({tenantServicesEntry,syncOwnLineMenu})", {
      state, api: async (url, options) => {calls.push({url, options});return {audience: "parent"};}
    }
  );
  assert.match(tenantServicesEntry(), /LINE 通知與家長服務/);
  assert.match(tenantServicesEntry(), /開啟 LINE 通知／費用資訊/);
  assert.match(tenantServicesEntry(), /重新同步我的 LINE 選單/);
  const output = {};
  const button = {disabled: false, closest: () => ({querySelector: () => output})};
  await syncOwnLineMenu(button);
  assert.equal(calls[0].url, "/api/line/school-account");
  assert.equal(JSON.parse(calls[0].options.body).action, "sync-menu");
  assert.match(output.textContent, /已同步為家長選單/);
  assert.equal(button.disabled, false);
  state.me.role = "unassigned";
  assert.doesNotMatch(tenantServicesEntry(), /重新同步我的 LINE 選單/);
  state.me.role = "admin";
  assert.doesNotMatch(tenantServicesEntry(), /LINE 通知與家長服務/);
  state.page = "admin";
  state.me.capabilities.lineRoleMenus = {parent: true, staff: false};
  assert.match(tenantServicesEntry(), /收費專案與匯款核帳/);
  assert.match(tenantServicesEntry(), /LINE 角色選單/);
  assert.match(tenantServicesEntry(), /家長選單已設定・幹部選單待設定/);
  assert.match(tenantServicesEntry(), /重新同步我的 LINE 選單/);
  state.me.capabilities.feeCollections = false;
  assert.doesNotMatch(tenantServicesEntry(), /收費專案與匯款核帳/);
  state.teacherAdminOpen = true;
  assert.equal(tenantServicesEntry(), "");
});

test("LINE admin sync protects the existing menu and verifies LINE actually assigned the staff six-grid", async () => {
  const calls = [];
  const parentMenuId = "richmenu-" + "1".repeat(32), staffMenuId = "richmenu-" + "2".repeat(32);
  const account = {lineUserId: userId, googleEmail: google.email};
  const channel = {schoolId: "sacred-heart", accessToken: "school-token", configured: true, parentMenuId, staffMenuId};
  let schoolAdmin = true, areaCount = 4, linkedMenuId = parentMenuId, chatActions = false;
  const {refreshTenantLineMenu} = load("api/src/lib/tenantLineMenu.js", {
    listTenantRolesByEmail: async () => schoolAdmin ? [{role:"schoolAdmin", schoolId:"sacred-heart"}] : [],
    getTeacherDirectory: async () => null, defaultTenantId: () => "sacred-heart",
    getMappedStudentsByEmail: async () => [], process: {env: {LAB_ENVIRONMENT: "functional-uat"}},
    lineApi: async (path, options) => {
      calls.push({path, method:options.method});
      assert.equal(options.accessToken, "school-token");
      if (path.startsWith("/v2/bot/richmenu/")) return {areas: Array.from({length:areaCount}, (_, index) => ({
        bounds:{x:index%3,y:Math.floor(index/3)},
        action:chatActions&&index<3?{type:"message",text:"#幹部"+["今日課程","活動行事曆","最新公告"][index]}:{type:"uri"}
      })).reverse()};
      if (options.method === "GET") return {richMenuId:linkedMenuId};
      return {};
    }
  }, ";({refreshTenantLineMenu})");
  const verify = changes => refreshTenantLineMenu({...channel,...changes}, account, undefined, {verify:true,expectStaff:true});
  await assert.rejects(verify({staffMenuId: ""}), /幹部選單尚未設定/);
  await assert.rejects(verify({staffMenuId: parentMenuId}), /同一個 ID/);
  assert.equal(calls.length, 0);
  await assert.rejects(verify(), /六宮格/);
  assert.equal(calls.length, 1);
  areaCount = 6;
  await assert.rejects(verify(), /今日課程.*聊天室回覆/);
  assert.equal(calls.length, 2);
  chatActions = true;
  await assert.rejects(verify(), /LINE 尚未確認/);
  linkedMenuId = staffMenuId;
  const result = await verify();
  assert.equal(result.audience, "staff");
  assert.equal(result.areaCount, 6);
  assert.equal(result.chatActionsVerified, true);
  schoolAdmin = false;
  await assert.rejects(verify(), /未判定為此校管理員/);
});

test("LINE staff links open the six workspaces only for the matching school administrator", async () => {
  const script = source("app/webview-guard.js");
  const routing = script.slice(script.indexOf("  const staffMenuRoutes="), script.indexOf("  window.__lineEmbedded="));
  const tests = {
    staff_today_courses: ["attendance", "followup"], staff_activity_calendar: ["workspace", "courses"],
    staff_announcements: ["activity"], staff_attendance: ["attendance", "regular"],
    staff_todos: ["workspace", "tasks"], staff_portal: ["workspace", "home"]
  };
  for (const [target, expected] of Object.entries(tests)) {
    for (const me of [{role:"admin",schoolId:"school-a"}, {role:"admin",schoolId:"school-b"}, {role:"parent",schoolId:"school-a"}]) {
      const current = new URL(`https://uat.example/?line_menu=${target}&schoolId=school-a`);
      const storage = new Map(), calls = [], warnings = [];
      const open = runInNewContext(routing + ";openStaffMenuEntry", {
        current, URL, location: current, state:{me}, history:{replaceState(){}},
        sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
        toast: message => warnings.push(message),
        window:{
          openSchoolAdminWorkspace: async group => calls.push(["workspace",group]),
          openSchoolAdminAttendanceTask: async task => calls.push(["attendance",task]),
          openSchoolAdminActivitySettings: async () => calls.push(["activity"])
        }
      });
      assert.equal(storage.get("school_context_id"), "school-a");
      assert.equal(storage.get("role_context"), "schoolAdmin");
      await open();
      const authorized=me.role==="admin"&&me.schoolId==="school-a";
      assert.deepEqual(calls, authorized?[expected]:[]);
      assert.equal(warnings.length, authorized?0:1);
      assert.equal(storage.has("line_staff_entry"), false);
    }
  }
});

test("a new LINE staff tab resumes a verified Google cookie only for the requested school", async () => {
  const script = source("app/app-v3.js");
  const bootScript = script.slice(script.indexOf("async function restoreLineStaffSession("), script.indexOf("const schoolViewScript="));
  const entry = {target:"staff_attendance", schoolId:"school-a"};
  const authorized = {role:"admin", schoolId:"school-a"};
  const cases = [
    {entry, profile:authorized, resumes:true},
    {entry, status:401},
    {entry, status:403},
    {entry, profile:{role:"admin", schoolId:"school-b"}},
    {entry, profile:{role:"parent", schoolId:"school-a"}},
    {entry, profile:{role:"globalAdmin", schoolId:null}},
    {entry:null, profile:authorized},
    {entry, token:"already-in-tab", profile:authorized}
  ];
  for (const {entry: pending, profile, resumes, status = 200, token = ""} of cases) {
    const storage = new Map(), requests = [], profiles = [], loginScreens = [];
    const state = {token};
    const boot = runInNewContext(bootScript + ";boot", {
      state, URLSearchParams, location:{search:""}, window:{getLineStaffEntry:()=>pending},
      sessionStorage:{setItem:(key,value)=>storage.set(key,value)},
      fetch:async (url, options) => {
        requests.push({url, options});
        return {status, ok:status===200, json:async()=>profile};
      },
      loadProfile:async profile => profiles.push(profile),
      renderLogin:message => loginScreens.push(message)
    });
    await boot();
    assert.equal(requests.length, pending&&!token?1:0);
    if (requests.length) {
      assert.equal(requests[0].url,"/api/me");
      assert.equal(requests[0].options.credentials,"same-origin");
      assert.equal(requests[0].options.headers["X-School-Id"],"school-a");
      assert.equal(requests[0].options.headers["X-Role-Context"],"schoolAdmin");
    }
    if (resumes) {
      assert.deepEqual(profiles,[authorized]);
      assert.equal(state.token,"cookie-session");
      assert.equal(storage.get("google_id_token"),"cookie-session");
      assert.equal(storage.get("school_context_id"),"school-a");
      assert.equal(storage.get("role_context"),"schoolAdmin");
    } else {
      assert.equal(storage.size,0);
      assert.deepEqual(profiles,token?[undefined]:[]);
    }
    assert.equal(loginScreens.length,resumes||token?0:1);
  }
});

test("staff LINE queries require an active administrator of the selected school and never read private lessons", async () => {
  let roles = [], reads = [];
  const events = [
    {title:"全校重要公告", eventDate:"2026-11-16", visibleToParents:true},
    {title:"內部重要提醒", eventDate:"2026-11-16", visibleToParents:false},
    {title:"比賽加練", eventType:"training", eventDate:"2026-11-16"}
  ];
  const {tenantLineStaffReplyKind,tenantLineStaffReply} = load("api/src/lib/tenantLineReplies.mjs", {
    listTenantRolesByEmail: async (email,status) => {assert.equal(email,google.email);assert.equal(status,"active");return roles;},
    resolveSchoolCourses: async school => {reads.push(school);return [];},
    listCalendarEvents: async school => {reads.push(school);return events;},
    isTrainingEventType: type => type === "training", isImportantAnnouncement: row => row.title.includes("重要"),
    formatLineTodayCourses: args => args, formatLineActivityCalendar: args => args, formatLineLatestAnnouncements: args => args
  }, ";({tenantLineStaffReplyKind,tenantLineStaffReply})");
  const request = {googleEmail:google.email}, date = new Date("2026-11-16T03:00:00Z");
  assert.equal(tenantLineStaffReplyKind("今日課程"), "");
  assert.equal(tenantLineStaffReplyKind("#幹部今日課程"), "today");
  assert.equal(tenantLineStaffReplyKind("#幹部活動行事曆"), "calendar");
  assert.equal(tenantLineStaffReplyKind("#幹部最新公告"), "announcements");
  for (roles of [[], [{schoolId:"school-a",role:"teacher"}], [{schoolId:"school-b",role:"schoolAdmin"}], [{schoolId:"*",role:"globalAdmin"}]]) {
    assert.match(await tenantLineStaffReply("today","school-a",request,date), /限本校/);
  }
  assert.equal(reads.length,0);
  roles = [{schoolId:"school-a",role:"schoolAdmin"}];
  const today = await tenantLineStaffReply("today","school-a",request,date);
  assert.equal(today.schoolWide,true);
  assert.equal(today.students[0].training[0].title,"比賽加練");
  assert.equal(today.students[0].privateLessons,undefined);
  const calendar = await tenantLineStaffReply("calendar","school-a",request,date);
  assert.equal(calendar.events.length,3);
  const announcements = await tenantLineStaffReply("announcements","school-a",request,date);
  assert.equal(announcements.events.length,1);
  assert.equal(announcements.events[0].title,"全校重要公告");
  assert.deepEqual(reads,["school-a","school-a","school-a","school-a"]);
});

test("fee notification retry keeps the initial target and provider retry key", async () => {
  const calls = [];
  let target = userId;
  const {sendTenantFeeLine} = load("api/src/lib/tenantLineFeeNotice.js", {
    ...dataTables(), randomUUID, process: {env: {}}, console: {warn() {}},
    lineHash: value => createHash("sha256").update(value).digest("hex"),
    resolveTenantLineChannel: async school => ({loginConfigured: true, paymentLineEnabled: true, botUserId: botId, accessToken: "token-" + school}),
    getTenantLineRecipient: async () => ({lineUserId: target}),
    pushLineMessage: async (user, text, request) => {
      calls.push({user, request});
      if(calls.length === 1)throw new Error("timeout");
    }
  }, ";({sendTenantFeeLine})");
  const entry = {id: "school-fee-event", at: new Date().toISOString(), parentEmail: google.email, text: "測試"};
  assert.equal((await sendTenantFeeLine("school-a", entry)).status, "pending");
  target = "U" + "c".repeat(32);
  assert.equal((await sendTenantFeeLine("school-a", entry)).status, "target_changed");
  target = userId;
  assert.equal((await sendTenantFeeLine("school-a", entry)).status, "accepted");
  assert.equal((await sendTenantFeeLine("school-a", entry)).status, "accepted");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].request.retryKey, calls[1].request.retryKey);
  assert.equal(calls[1].request.accessToken, "token-school-a");
});
