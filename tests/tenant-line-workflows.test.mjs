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

function deliveryCompatibility({schoolId="sacred-heart",binding={},channel={},profile={},bot={},modern=[],environment="production",rejectProfile=false}={}){
 const writes=[],requests=[],tables=new Map(),hash=value=>createHash("sha256").update(value).digest("hex");
 const legacy={partitionKey:schoolId,rowKey:"email_"+hash(google.email).slice(0,40),status:"ACTIVE",schoolId,parentEmail:google.email,lineUserId:userId,lineUserIdHash:hash(userId),...binding};
 tables.set("TenantLineAccountBinding",[legacy]);tables.set("TenantLineIdentity",modern);
 const db=name=>({getEntity:async(p,r)=>{const row=(tables.get(name)||[]).find(x=>x.partitionKey===p&&x.rowKey===r);if(!row)throw missing(404);return {...row}},
  async *listEntities({queryOptions:{filter}}){for(const row of tables.get(name)||[])if(filter.includes("'"+row.partitionKey+"'")&&filter.includes("'"+row.googleEmail+"'"))yield {...row}},
  createEntity:async row=>writes.push(row),updateEntity:async row=>writes.push(row),submitTransaction:async actions=>writes.push(actions)});
 const globals={createHash,randomBytes,randomUUID,process:{env:{LAB_ENVIRONMENT:environment,STORAGE_CONNECTION_STRING:"test"}},defaultTenantId:()=>"sacred-heart",tenantSchoolPartition:String,TableClient:{fromConnectionString:(_c,name)=>db(name)},lineApi:async(path,options)=>{
  requests.push({path,options});if(path==="/v2/bot/info")return {userId:botId,...bot};if(rejectProfile)throw Error("profile not verified");return {userId,displayName:"原綁定家長",...profile};
 }};
 const api=load("api/src/lib/tenantLineAccounts.js",globals,";({getTenantLineDeliveryRecipient,getTenantLineRecipient,getTenantLineAccount})");
 return {writes,requests,tables,api,channel:{schoolId,configured:true,loginConfigured:false,botUserId:botId,acceptsLegacy:true,accessToken:"verified-school-token",...channel}};
}
test("Production preserves a verified default-school legacy messaging recipient without creating LINE Login or identities",async()=>{
 const h=deliveryCompatibility();
 assert.equal(await h.api.getTenantLineRecipient("sacred-heart",google.email,botId),null);
 const result=await h.api.getTenantLineDeliveryRecipient("sacred-heart",google.email,h.channel);
 assert.equal(result.lineUserId,userId);assert.equal(result.deliveryOnly,true);assert.equal(result.botUserId,botId);
 assert.equal(await h.api.getTenantLineAccount("sacred-heart",botId,userId),null);assert.equal(h.writes.length,0);
 assert.deepEqual(h.requests.map(r=>r.path),["/v2/bot/info","/v2/bot/profile/"+userId]);
 assert.ok(h.requests.every(r=>r.options.accessToken==="verified-school-token"));
});
test("legacy delivery rejects another tenant, inactive or reassigned bindings, a foreign bot and unconfirmed proof",async()=>{
 for(const options of [{schoolId:"school-b"},{binding:{status:"INACTIVE"}},{binding:{schoolId:"other-school"}},{binding:{parentEmail:"reassigned@example.test"}},{binding:{lineUserIdHash:"changed"}},{binding:{botUserId:"another-bot"}},{channel:{schoolId:"other-school"}},{channel:{configured:false}},{channel:{acceptsLegacy:false}},{channel:{accessToken:""}},{bot:{userId:"another-bot"}},{profile:{userId:"another-user"}},{rejectProfile:true},{environment:"functional-uat"}]){
  const h=deliveryCompatibility(options);assert.equal(await h.api.getTenantLineDeliveryRecipient(h.channel.schoolId,google.email,h.channel),null);assert.equal(h.writes.length,0);
 }
});
test("modern binding and unlink markers remain authoritative over old delivery bindings",async()=>{
 const unlinked={partitionKey:"sacred-heart",rowKey:"google-old",googleEmail:google.email,googleSub:google.sub,parentEmail:google.email};
 const h=deliveryCompatibility({modern:[unlinked]});assert.equal(await h.api.getTenantLineDeliveryRecipient("sacred-heart",google.email,h.channel),null);assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
 const foreign={partitionKey:"sacred-heart",rowKey:"email-"+createHash("sha256").update(google.email).digest("hex"),lineUserId:"changed-user",botUserId:"other-bot"};
 const changed=deliveryCompatibility({modern:[foreign]});assert.equal(await changed.api.getTenantLineDeliveryRecipient("sacred-heart",google.email,changed.channel),null);assert.equal(changed.requests.length,0);
});
test("legacy private-lesson delivery sends a platform link but never creates an OAuth review capability",async()=>{
 for(const loginConfigured of [false,true]){
  const h=deliveryCompatibility({channel:{loginConfigured}}),pushes=[],reviewWrites=[];
  const current=load("api/src/lib/linePrivateLesson.js",{
   process:{env:{LAB_ENVIRONMENT:"production"}},workflowLineEnabled:()=>true,
   resolveTenantLineChannel:async()=>h.channel,getTenantLineRecipient:h.api.getTenantLineRecipient,getTenantLineDeliveryRecipient:h.api.getTenantLineDeliveryRecipient,
   labNoticeUrl:schoolId=>"https://lively-field-09afddc00.6.azurestaticapps.net/?schoolId="+schoolId,
   workflowLineRetryKey:()=>"same-provider-retry-key",pushLineMessage:async(...args)=>pushes.push(args),
   TableClient:{fromConnectionString:()=>({createTable:async()=>reviewWrites.push("table"),createEntity:async()=>reviewWrites.push("token")})},
   console:{warn(){}},createHmac:()=>{throw Error("A legacy recipient must never receive a review token")}
  },";notifyPrivateLessonLine");
  const now=new Date().toISOString(),result=await current("sacred-heart",{recipients:[google.email],entity:{rowKey:"lesson-one",partitionKey:"sacred-heart|student|one",completedAt:now,updatedAt:now},eventType:"completed",format:origin=>"個課已完成，請登入平台確認。\n"+origin});
  assert.equal(result,"accepted");assert.equal(pushes.length,1);assert.equal(pushes[0][0],userId);
  assert.match(pushes[0][1],/lively-field.*schoolId=sacred-heart/);assert.doesNotMatch(pushes[0][1],/【LAB|lineuat|#個課評鑑/);
  assert.equal(pushes[0][2].quickReply,undefined);assert.equal(reviewWrites.length,0);assert.equal(h.writes.length,0);
 }
});
test("manual and registered-payment audiences count verified legacy recipients on the same LINE transport used for delivery",async()=>{
 const h=deliveryCompatibility(),resolves=[];
 const audience=load("api/src/lib/lineAudience.js",{
  resolveTenantLineChannel:async school=>{resolves.push(school);return h.channel},
  getTenantLineDeliveryRecipient:h.api.getTenantLineDeliveryRecipient,
  listUserStudentMappings:async()=>[{studentId:"one",parentEmail:google.email},{studentId:"one",parentEmail:google.email}],
  getStudentAliasInfo:async id=>({canonicalStudentId:id})
 },";resolveLineAudience");
 const students=[{rowKey:"one",groupName:"A"}],preview=await audience("sacred-heart",botId,{roles:["parent"],groups:["A"],students});
 assert.equal(resolves.length,1);assert.equal(preview.matched,1);assert.equal(preview.unbound,0);
 assert.deepEqual([...preview.targets],[userId]);assert.equal(preview.contacts[0].userId,userId);
 assert.equal(await h.api.getTenantLineRecipient("sacred-heart",google.email,botId),null);
 const foreign=await audience("sacred-heart","foreign-bot",{roles:["parent"],groups:[],students});assert.equal(foreign.unbound,1);assert.equal(foreign.targets.length,0);
 const registered=load("api/src/lib/paidActivityLine.js",{
  process:{env:{STORAGE_CONNECTION_STRING:"test"}},getTenantLineDeliveryRecipient:h.api.getTenantLineDeliveryRecipient,
  TableClient:{fromConnectionString:(_connection,name)=>{assert.equal(name,"TenantFamilyEventRegistration");return {async *listEntities({queryOptions:{filter}}){assert.equal(filter,"PartitionKey eq 'sacred-heart'");yield {rowKey:"registration-one",payload:JSON.stringify({kind:"fieldTrip",activityId:"trip-one",registrationStatus:"REGISTERED",paymentStatus:"AWAITING_TRANSFER",parentEmail:google.email})}}}}}
 },";registeredPaymentAudience");
 const payment=await registered("sacred-heart",h.channel,"trip-one");assert.equal(payment.unbound,0);assert.deepEqual([...payment.targets],[userId]);assert.equal(payment.contacts[0].userId,userId);
 assert.equal((await registered("sacred-heart",{...h.channel,schoolId:"other-school"},"trip-one")).targets.length,0);
 assert.equal(h.writes.length,0);
});

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
    getMappedStudentsByEmail: async (email, school) => {
      const key = school + "|" + email;
      return studentRows instanceof Map ? studentRows.get(key) || [] : studentRows.has(key) ? [{}] : [];
    },
    getRegistrationsByEmail: async () => []
  }, ";({getOrCreateTenantLineAccount,getTenantGoogleLink,getTenantLineRecipient,getTenantLineParentContact,linkTenantGoogle,unlinkTenantGoogle,createTenantLineSession,tenantLineSession,createTenantLineOAuth,useTenantLineOAuth,recordTenantLineFriendship,listTenantLineRecipientStatuses,createTenantLineLinkConfirmation,readTenantLineLinkConfirmation})");
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

test("verified dual enrollment keeps Gmail primary and preserves historical LINE ownership", async () => {
  const students = new Map(), store = identities(students);
  const school = "school-a";
  const line = await store.getOrCreateTenantLineAccount(school, botId, userId, "家長");
  students.set(school + "|" + line.parentEmail, [{studentId:"100001"}, {studentId:"100002"}]);
  students.set(school + "|" + google.email, [{studentId:"100001"}, {studentId:"100003"}]);
  await assert.rejects(store.linkTenantGoogle(school, line, google), /各有學生紀錄/);
  students.set(school + "|" + google.email, [{studentId:"100002"}, {studentId:"100001"}]);
  const linked = await store.linkTenantGoogle(school, line, google);
  assert.equal(linked.parentEmail, google.email);
  assert.equal(linked.parentAlias, line.parentEmail);
  assert.equal((await store.getTenantGoogleLink(school, google.sub)).parentAlias, line.parentEmail);
  assert.equal((await store.getTenantLineRecipient(school, line.parentEmail, botId)).lineUserId, userId);
  assert.equal(await store.getTenantLineParentContact(school, line.parentEmail), google.email);
  await store.recordTenantLineFriendship(school, botId, userId, true, 1000);
  const statuses = await store.listTenantLineRecipientStatuses(school, botId);
  assert.equal(statuses.get(google.email).status, "friend");
  assert.equal(statuses.get(line.parentEmail).linkedParentEmail, google.email);
  await store.unlinkTenantGoogle(school, google.sub);
  assert.equal(await store.getTenantLineRecipient(school, line.parentEmail, botId), null);
  assert.equal(await store.getTenantLineRecipient(school, google.email, botId), null);
  assert.equal((await store.getTenantGoogleLink(school, google.sub)).parentAlias, line.parentEmail);
  assert.equal((await store.listTenantLineRecipientStatuses(school, botId)).get(line.parentEmail).linkedParentEmail, google.email);
  const replacement = await store.getOrCreateTenantLineAccount(school, botId, userId, "家長");
  const reconnected = await store.linkTenantGoogle(school, replacement, google);
  assert.equal(reconnected.parentAlias, line.parentEmail);
  assert.equal((await store.getTenantLineRecipient(school, line.parentEmail, botId)).lineUserId, userId);
});

test("two guardians of the same student retain separate verified Gmail and LINE pairs", async () => {
  const students = new Map(), store = identities(students);
  const school = "school-a", secondLine = "U" + "c".repeat(32);
  const secondGoogle = {sub:"second-google-id",email:"second-parent@example.com"};
  const first = await store.getOrCreateTenantLineAccount(school, botId, userId, "家長");
  const second = await store.getOrCreateTenantLineAccount(school, botId, secondLine, "家長");
  for (const email of [first.parentEmail, second.parentEmail, google.email, secondGoogle.email]) {
    students.set(school + "|" + email, [{studentId:"100001"}]);
  }
  await store.linkTenantGoogle(school, first, google);
  await store.linkTenantGoogle(school, second, secondGoogle);
  await assert.rejects(store.linkTenantGoogle(school, second, google), /已有其他/);
  assert.equal((await store.getTenantLineRecipient(school, google.email, botId)).lineUserId, userId);
  assert.equal((await store.getTenantLineRecipient(school, secondGoogle.email, botId)).lineUserId, secondLine);
});

test("a link confirmation requires the displayed preview, original login, school and bot", async () => {
  const store = identities(), schoolId = "school-a", channel = {schoolId, botUserId:botId};
  const first = await store.getOrCreateTenantLineAccount(schoolId, botId, userId, "家長甲");
  const second = await store.getOrCreateTenantLineAccount(schoolId, botId, "U"+"c".repeat(32), "家長乙");
  const otherGoogle = {sub:"other-google",email:"other@example.com"};
  const chosen = await store.createTenantLineLinkConfirmation(schoolId, first, google, "google");
  const other = await store.createTenantLineLinkConfirmation(schoolId, second, google, "google");
  const requestFor = pending => ({headers:new Headers({cookie:pending.cookie.name+"="+pending.cookie.value})});
  const request = requestFor(chosen);
  const check = store.readTenantLineLinkConfirmation;
  assert.equal((await check(request, channel, google, null)).lineDisplayName, "家長甲");
  assert.equal(await check(request, {...channel,schoolId:"school-b"}, google, null), null);
  assert.equal(await check(request, {...channel,botUserId:second.lineUserId}, google, null), null);
  assert.equal(await check(request, channel, otherGoogle, null, chosen.confirmationId), null);
  assert.equal(await check(requestFor(other), channel, google, null, chosen.confirmationId), null);
  assert.equal(await check(request, channel, google, null, ""), null);
  assert.equal(await store.getTenantGoogleLink(schoolId, google.sub), null);
  const outcomes = await Promise.all([1,2].map(() => check(request, channel, google, null, chosen.confirmationId)));
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(outcomes.find(Boolean).lineUserId, first.lineUserId);
  const linePending = await store.createTenantLineLinkConfirmation(schoolId, second, otherGoogle, "line");
  assert.equal(await check(requestFor(linePending), channel, null, first, linePending.confirmationId), null);
  assert.equal((await check(requestFor(linePending), channel, null, second, linePending.confirmationId)).googleEmail, otherGoogle.email);
});

test("historical family and fee records require both verified account and current student access", () => {
  const alias = "line-00000000-0000-0000-0000-000000000000@line.invalid";
  const access = {role:"parent", email:google.email, parentAlias:alias, students:["100001"]};
  const globals = {app:{http(){}}, process:{env:{}}, ensureStudentAccess:(access, id) => access.students.includes(id)};
  const ownsRegistration = load("api/src/functions/familyEventRegistration.js", {...globals}, ";ownsRegistration");
  const ownsCharge = load("api/src/functions/feeCollections.js", {...globals}, ";ownsCharge");
  const allowed = {parentEmail:alias, studentIds:["100001"], studentId:"100001"};
  const differentStudent = {...allowed, studentIds:["100001","100002"], studentId:"100002"};
  const otherParent = {...allowed, parentEmail:"other@example.com"};
  for (const owns of [ownsRegistration, (access, record) => ownsCharge(access, {sourceType:"family"}, record)]) {
    assert.equal(owns(access, allowed), true);
    assert.equal(owns(access, differentStudent), false);
    assert.equal(owns(access, otherParent), false);
    assert.equal(owns({...access,parentAlias:""}, allowed), false);
  }
  assert.equal(ownsCharge(access, {sourceType:"uniform"}, allowed), true);
  assert.equal(ownsCharge(access, {sourceType:"uniform"}, differentStudent), false);
});

test("legacy LAB restores a confirmed Google and LINE pair only on the current school bot", async () => {
  const students = new Map([["sacred-heart|" + google.email, [{studentId:"100001"}]]]);
  const store = identities(students);
  const lineOnly = await store.getOrCreateTenantLineAccount("sacred-heart", botId, userId, "LAB 家長");
  students.set("sacred-heart|" + lineOnly.parentEmail, [{studentId:"100001"}]);
  const lineHash=value=>createHash("sha256").update(value).digest("hex"), hash=lineHash(userId);
  const pair={status:"ACTIVE",parentEmail:google.email,lineUserIdHash:hash,pairKey:lineHash(hash+":"+google.email)};
  const rows=new Map([
    ["TenantLineAccountBinding/sacred-heart/email_"+lineHash(google.email).slice(0,40),
      {...pair,lineUserId:userId,schoolId:"sacred-heart"}],
    ["LabParentIdentityLinks/IDENTITY/gmail_"+lineHash(google.email).slice(0,48),{...pair,kind:"GMAIL"}],
    ["LabParentIdentityLinks/IDENTITY/line_"+hash.slice(0,48),{...pair,kind:"LINE"}]
  ]);
  const env={LAB_ENVIRONMENT:"functional-uat"};
  const channel={schoolId:"sacred-heart",loginConfigured:true,botUserId:botId,accessToken:"current-token"};
  let verifiedUser="U"+"c".repeat(32),calls=0;
  const restore=load("api/src/lib/tenantLineLegacyLab.js",{
    ...store,lineHash,process:{env},
    TableClient:{fromConnectionString:(_conn,name)=>({getEntity:async(partition,key)=>{
      const row=rows.get([name,partition,key].join("/"));
      if(!row)throw missing(404);
      return row;
    }})},
    lineApi:async(path,options)=>{
      assert.equal(path,"/v2/bot/profile/"+userId);
      assert.equal(options.accessToken,"current-token");
      calls++;
      return {userId:verifiedUser,displayName:"LAB 家長"};
    }
  },";restoreLabGoogleLineLink");
  assert.equal(await restore("other-school",channel,google,null),null);
  assert.equal(await restore("sacred-heart",channel,google,null),null);
  assert.equal(await store.getTenantGoogleLink("sacred-heart",google.sub),null);
  verifiedUser=userId;
  const linked=await restore("sacred-heart",channel,google,null);
  assert.equal(linked.parentEmail,google.email);
  assert.equal((await store.getTenantGoogleLink("sacred-heart",google.sub)).lineUserId,userId);
  assert.equal((await store.getTenantLineRecipient("sacred-heart",google.email,botId)).googleSub,google.sub);
  await store.unlinkTenantGoogle("sacred-heart",google.sub);
  const unlinked=await store.getTenantGoogleLink("sacred-heart",google.sub);
  assert.equal((await restore("sacred-heart",channel,google,unlinked)).lineUserId,undefined);
  assert.equal(calls,2);
  const newAccount=await store.getOrCreateTenantLineAccount("sacred-heart",botId,userId,"家長");
  await assert.rejects(store.linkTenantGoogle("sacred-heart",newAccount,google,{requireAbsentGoogleLink:true}),/已有其他/);
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

test("verified LINE staff gets current school permissions and can still select parent access",async()=>{
  const account={botUserId:botId,lineUserId:userId,parentEmail:"line-account@example.com",googleSub:google.sub,googleEmail:google.email};
  const assignment={role:"schoolAdmin",schoolId:"school-a",status:"active"};
  let link={...account},roles=[assignment],finance=true;
  let studentReads=0,roleReads=0;
  const {lineParentAccess,googleToken}=load("api/src/lib/auth.js",{
    OAuth2Client:class{},
    getTeacherDirectory:async()=>null,
    tenantLineSession:async()=>({schoolId:"school-a",account}),
    getTenantDirectory:async()=>({status:"active",schoolName:"甲校"}),
    resolveTenantLineChannel:async()=>({loginConfigured:true,botUserId:botId}),
    getTenantGoogleLink:async(school,sub)=>{assert.deepEqual([school,sub],["school-a",google.sub]);return link},
    listTenantRolesByEmail:async(email,status)=>{roleReads++;assert.deepEqual([email,status],[google.email,"active"]);return roles},
    financeAssigned:async(school,email)=>{assert.deepEqual([school,email],["school-a",google.email]);return finance},
    tenantLineParentStudents:async()=>{
      studentReads++;
      return [{studentId:"990101",name:"家長身分"}];
    },
    listStudentMaster:async()=>[],listUserStudentMappings:async()=>[],tenantIdValue:value=>value,defaultTenantId:()=>"sacred-heart"
  },";({lineParentAccess,googleToken})");
  const check=(role="",school="school-a",contexts=false)=>lineParentAccess({headers:new Headers({
    "X-Role-Context":role,"X-School-Id":school
  })},contexts);
  assert.equal((await check("schoolAdmin","school-b")).role,"contextDenied");
  assert.equal((await check("global")).role,"contextDenied");
  assert.equal(roleReads,0);
  const first=await check();
  assert.equal(first.role,"admin");
  assert.equal(first.email,google.email);
  assert.equal(first.capabilities.financeVerifier,true);
  assert.equal(studentReads,0);
  const profile=await check("schoolAdmin","school-a",true);
  assert.equal(Array.from(profile.contexts,x=>x.type).join(","),"schoolAdmin,parent");
  assert.equal(profile.activeContextKey,"schoolAdmin:school-a");
  const parent=await check("parent");
  assert.equal(parent.role,"parent");
  assert.equal(parent.email,account.parentEmail);
  assert.equal(parent.capabilities.financeVerifier,undefined);
  finance=false;
  assert.equal((await check("schoolAdmin")).capabilities.financeVerifier,false);
  roles=[{...assignment,status:"inactive"},{...assignment,role:"globalAdmin"},{...assignment,schoolId:"school-b"}];
  assert.equal((await check("schoolAdmin")).role,"contextDenied");
  assert.equal((await check()).role,"parent");
  roles=[assignment];
  link={...account,lineUserId:"U"+"d".repeat(32)};
  assert.equal((await check("schoolAdmin")).role,"contextDenied");
  link=null;
  assert.equal((await check("schoolAdmin")).role,"contextDenied");
  const cookie="orchestra_google_id_token=other-account";
  assert.equal(googleToken({headers:new Headers({cookie,"X-Google-ID-Token":"line-session"})}),"");
  assert.equal(googleToken({headers:new Headers({cookie})}),"other-account");
});

test("student parent links expose LINE status only to the school's admin", async () => {
  let handler;
  let role = "parent";
  let lookups = 0;
  let botAvailable = true;
  const oldParent = "line-00000000-0000-0000-0000-000000000000@line.invalid";
  load("api/src/functions/studentParentLinks.js", {
    app: {http(name, options) { handler = options.handler; }},
    getTenantContext: async () => ({schoolId: "school-a", access: {role}}),
    getStudentAliasInfo: async () => ({}), json: (items, status = 200) => ({items, status}),
    ensureTenantTables: async () => {}, tenantSchoolPartition: id => id,
    table: () => ({async *listEntities() {
      yield {rowKey: "100001", parentEmail: google.email};
      yield {rowKey: "100001", parentEmail: oldParent};
      yield {rowKey: "100002", parentEmail: "other@example.com"};
    }}),
    resolveTenantLineChannel: async () => ({botUserId: botAvailable ? botId : ""}),
    listTenantLineRecipientStatuses: async (schoolId, bot) => {
      lookups++;
      assert.equal(schoolId, "school-a");
      assert.equal(bot, botId);
      return new Map([[google.email, {status: "friend", checkedAt: 1000, googleEmail: google.email}],
        [oldParent, {linkedParentEmail: google.email}]]);
    }
  });
  const request = {method: "GET", query: new URLSearchParams("includeLineStatus=1")};
  assert.equal((await handler(request)).status, 403);
  assert.equal(lookups, 0);
  role = "admin";
  const linked = (await handler(request)).items.items;
  assert.equal(linked.length, 2);
  assert.equal(linked[0].lineGoogleEmail, google.email);
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

test("parent account tools are collapsed and can still sync with the active school account", async () => {
  const state = {me: {role: "parent", capabilities: {lineAccount: true, feeCollections: true}}, page: "home"};
  const calls = [];
  const file = source("app/app-v3.js");
  const {tenantServicesEntry, syncOwnLineMenu} = runInNewContext(
    file.slice(file.indexOf("async function syncOwnLineMenu("), file.indexOf("async function renderLogin(")) +
    ";({tenantServicesEntry,syncOwnLineMenu})", {
      state, window: {}, api: async (url, options) => {calls.push({url, options});return {audience: "parent"};}
    }
  );
  assert.match(tenantServicesEntry(), /<details class="card" id="parentAccountSettings">/);
  assert.doesNotMatch(tenantServicesEntry(), /<details[^>]* open/);
  assert.match(tenantServicesEntry(), /管理我的 LINE 通知設定/);
  assert.match(tenantServicesEntry(), /line-account.html/);
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
  assert.match(tenantServicesEntry(), /收費與核帳/);
  assert.match(tenantServicesEntry(), /LINE 通知中心/);
  assert.match(tenantServicesEntry(), /line-announcement.html/);
  assert.match(tenantServicesEntry(), /活動志工 LINE 群組/);
  state.me.capabilities.feeCollections = false;
  assert.doesNotMatch(tenantServicesEntry(), /收費與核帳/);
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
    discoverTenantLineRoleMenu: async () => "",
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

test("a new staff tab resumes a verified Google or LINE session only for the requested school", async () => {
  const script = source("app/app-v3.js");
  const bootScript = script.slice(script.indexOf("async function restoreLineStaffSession("), script.indexOf("const schoolViewScript="));
  const entry = {target:"staff_attendance", schoolId:"school-a"};
  const authorized = {role:"admin", schoolId:"school-a"};
  const cases = [
    {entry, profile:authorized, resumes:true},
    {entry, profile:{...authorized,authProvider:"line"}, resumes:true},
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
      assert.deepEqual(profiles,[profile]);
      const session=profile.authProvider==="line"?"line-session":"cookie-session";
      assert.equal(state.token,session);
      assert.equal(storage.get("google_id_token"),session);
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
    assert.match(await tenantLineStaffReply("today","school-a",request,date), /尚無本校學校管理員權限/);
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

test("confirmed payments privately notify the bound parent using the correct next step and send once", async () => {
  const {notifyTenantPaymentVerified:notify}=load("api/src/lib/tenantLineFeeNotice.js",{
    ...dataTables(),randomUUID,process:{env:{LAB_ENVIRONMENT:"functional-uat"}},
    workflowLineEnabled:()=>true, lineHash:value=>createHash("sha256").update(value).digest("hex"),
    resolveTenantLineChannel:async school=>{
      assert.equal(school,"school-a");
      return {loginConfigured:true,paymentConfirmationLineEnabled:true,paymentLineEnabled:false,botUserId:botId,accessToken:"school-token"};
    },
    getTenantLineRecipient:async (school,email,bot)=>{
      assert.deepEqual([school,email,bot],["school-a",google.email,botId]);
      return {lineUserId:userId};
    },
    pushLineMessage:async (...args)=>calls.push(args)
  },";({notifyTenantPaymentVerified})");
  const calls=[];
  const order={kind:"regularUniform",id:"order-1",at:new Date().toISOString(),parentEmail:google.email,requestStatus:"APPROVED",verificationNote:"internal only"};
  assert.equal((await notify("school-a",order)).status,"accepted");
  assert.equal((await notify("school-a",order)).status,"accepted");
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],userId);
  assert.match(calls[0][1],/【LAB】.*團 T[\s\S]+匯款入帳[\s\S]+備貨／採購/);
  assert.doesNotMatch(calls[0][1],/internal only/);
  assert.equal((await notify("school-a",{...order,kind:"yearEndDinner",id:"family-1"})).status,"accepted");
  assert.doesNotMatch(calls[1][1],/採購/);
  assert.equal((await notify("school-a",{...order,parentEmail:""})).status,"not_bound");
});
