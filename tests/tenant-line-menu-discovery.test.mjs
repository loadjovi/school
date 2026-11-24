import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {tenantFacebookUrl} from "../api/src/lib/lineFacebookConfig.js";

const source = readFileSync(new URL("../api/src/lib/tenantLineMenuDiscovery.js", import.meta.url), "utf8").replace(/^import[^\n]+\n/gm, "").replace(/^export /gm, "");
const channel = {schoolId: "school-a", botUserId: "U" + "a".repeat(32), configured: true,
  appOrigin: "https://school-a.example.test", accessToken: "school-a-private-token", facebookUrl: "https://www.facebook.com/school-a"};
const id = digit => "richmenu-" + digit.repeat(32);
const targets = ["staff_today_courses", "staff_activity_calendar", "staff_announcements", "staff_attendance", "staff_todos", "staff_portal"];
const labels = ["今日課程", "活動行事曆", "最新公告"];
const uri = target => ({type: "uri", uri: channel.appOrigin + "/?line_menu=" + target + "&schoolId=school-a&openExternalBrowser=1"});
const facebook = () => ({type: "uri", uri: channel.appOrigin + "/api/line/facebook/school-a?openExternalBrowser=1"});
function menu(audience = "staff", digit = "1", legacy = false) {
  const columns = audience === "parent" ? 2 : 3, cellWidth = audience === "parent" ? 1250 : 833;
  return {richMenuId: id(digit), name: "menu name is not trusted", size: {width: columns * cellWidth, height: 1686}, areas: Array.from({length: audience === "parent" ? 4 : 6}, (_, index) => ({
    bounds: {x: index % columns * cellWidth, y: Math.floor(index / columns) * 843, width: cellWidth, height: 843},
    action: index < 3 ? legacy ? uri(targets[index]) : {type: "message", text: (audience === "staff" ? "#幹部" : "") + labels[index]} :
      audience === "staff" ? uri(targets[index]) : {type: "uri", uri: channel.appOrigin + "/?schoolId=school-a"}
  }))};
}
function parentFacebook(digit = "1") {
  const result = menu("parent", digit);result.size = {width: 2500, height: 1686};
  result.areas = [...result.areas, {action: facebook()}];
  let x = 0;
  result.areas.forEach((area, index) => {
    const width = index < 2 ? 833 : index === 2 ? 834 : 1250;
    if (index === 3) x = 0;
    area.bounds = {x, y: index < 3 ? 0 : 843, width, height: 843};x += width;
  });
  return result;
}
function harness(menus, failure) {
  const calls = [];
  const discover = runInNewContext(source + ";discoverTenantLineRoleMenu", {URL, URLSearchParams, tenantFacebookUrl, lineApi: async (path, options) => {
    calls.push({path, options});if (failure) throw Error("private-provider-body");return {richmenus: menus};
  }});
  return {calls, discover: (audience = "staff", changes = {}) => discover({...channel, ...changes}, audience)};
}

test("discovery uses one bounded current-bot GET and no mutation to find the exact six-grid staff contract", async () => {
  const h = harness([menu("parent", "2"), menu()]);
  assert.equal(await h.discover(), id("1"));
  assert.equal(h.calls.length, 1);assert.equal(h.calls[0].path, "/v2/bot/richmenu/list");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].options)), {method: "GET", accessToken: channel.accessToken, timeoutMs: 3000});
  assert.equal(await h.discover("parent"), id("2"));
});
test("unknown or incomplete channel context never performs a lookup", async () => {
  const h = harness([menu()]);
  for (const changes of [{configured: false}, {accessToken: ""}, {schoolId: "../school-b"}, {botUserId: ""}, {appOrigin: "http://school-a.example.test"}, {appOrigin: channel.appOrigin + "/path"}]) {
    assert.equal(await h.discover("staff", changes), "");
  }
  assert.equal(await h.discover("unknown"), "");assert.equal(h.calls.length, 0);
});
test("menu names and six arbitrary messages cannot establish staff semantics", async () => {
  const wrong = menu();wrong.name = "Official Staff Six Grid";wrong.areas[0].action.text = "今日課程";
  const allMessages = menu();allMessages.areas.slice(3).forEach(area => area.action = {type: "message", text: "staff"});
  assert.equal(await harness([wrong, allMessages]).discover(), "");
  const unsupported = menu();unsupported.areas[0].action.text = "#幹部 今日課程";
  assert.equal(await harness([unsupported]).discover(), "");
});
test("malformed, overlapping, gapped or non-grid rectangles are not guessed from their count", async () => {
  const variants = [menu(), menu(), menu(), menu(), menu()];
  variants[0].areas[0].bounds.width = 834;
  variants[1].areas[0].bounds.y = 1;
  variants[2].areas[3].bounds.y = 842;
  variants[3].areas[1].bounds.x = 832;
  delete variants[4].areas[5].bounds;
  for (const candidate of variants) assert.equal(await harness([candidate]).discover(), "");
  const reverse = menu();reverse.areas.reverse();assert.equal(await harness([reverse]).discover(), id("1"));
});
test("staff URI destinations reject other origins, schools, duplicate targets and desktop bypasses", async () => {
  const destinations = ["https://lab.example.test/?line_menu=staff_portal&schoolId=school-a",
    channel.appOrigin + "/?line_menu=staff_portal",
    channel.appOrigin + "/?line_menu=staff_portal&schoolId=school-b",
    channel.appOrigin + "/?line_menu=staff_portal&schoolId=school-a&schoolId=school-b",
    channel.appOrigin + "/?line_menu=staff_portal&line_menu=staff_todos&schoolId=school-a",
    channel.appOrigin + "/?line_menu=staff_portal&onboardingRole=schoolAdmin",
    channel.appOrigin + "/uniform-event-admin.html?line_menu=staff_portal&schoolId=school-a",
    "https://user:password@school-a.example.test/?line_menu=staff_portal&schoolId=school-a",
    channel.appOrigin + "/?line_menu=staff_portal&schoolId=school-a#extra"];
  for (const destination of destinations) {
    const candidate = menu();candidate.areas[5].action.uri = destination;
    assert.equal(await harness([candidate]).discover(), "");
    const desktop = menu();desktop.areas[5].action.altUri = {desktop: destination};
    assert.equal(await harness([desktop]).discover(), "");
  }
});
test("chat-compatible staff template takes priority over an exact legacy all-URI template", async () => {
  assert.equal(await harness([menu("staff", "1", true), menu("staff", "2")]).discover(), id("2"));
  assert.equal(await harness([menu("staff", "1", true)]).discover(), id("1"));
  const mixed = menu();mixed.areas[0].action = uri(targets[0]);assert.equal(await harness([mixed]).discover(), "");
});
test("equivalent action contracts choose a stable ID while different contracts remain ambiguous", async () => {
  const first = menu("staff", "2"), second = menu("staff", "1");second.name = "another artwork";second.areas.reverse();
  assert.equal(await harness([first, second]).discover(), id("1"));
  const reordered = menu("staff", "3");reordered.areas[5].action.uri = channel.appOrigin + "/?openExternalBrowser=1&schoolId=school-a&line_menu=staff_portal";
  assert.equal(await harness([first, reordered]).discover(), id("2"));
  const different = menu("staff", "3");different.areas[5].action.uri = different.areas[5].action.uri.replace("openExternalBrowser=1", "openExternalBrowser=0");
  assert.equal(await harness([first, different]).discover(), "");
});
test("the approved parent menu has four cells: three supported commands and one safe same-school portal", async () => {
  const candidate = menu("parent");candidate.areas[0].action.text = "#今日課程";
  assert.equal(await harness([candidate]).discover("parent"), id("1"));
  const badActions = [uri("staff_portal"), {type: "uri", uri: channel.appOrigin + "/?schoolId=school-a"},
    {type: "message", text: "#幹部今日課程"}, {type: "postback", data: "today"}];
  for (const action of badActions) {
    const wrong = menu("parent");wrong.areas[0].action = action;
    assert.equal(await harness([wrong]).discover("parent"), "");
  }
  assert.equal(await harness([menu("staff")]).discover("parent"), "");
  const oldSix = menu("staff");oldSix.areas.slice(0, 3).forEach((area, index) => area.action = {type: "message", text: labels[index]});
  assert.equal(await harness([oldSix]).discover("parent"), "");
  const defaultThree = menu("parent");defaultThree.size = {width: 2499, height: 843};
  defaultThree.areas = defaultThree.areas.slice(0, 3).map((area, index) => ({...area, bounds: {x: index * 833, y: 0, width: 833, height: 843}}));
  assert.equal(await harness([defaultThree]).discover("parent"), "");
});
test("approved parent four-grid discovery accepts complete two-by-two, horizontal or vertical layouts", async () => {
  const vertical = menu("parent");vertical.size = {width: 2500, height: 1686};
  let y = 0;vertical.areas.forEach((area, index) => {
    const height = index < 2 ? 421 : 422;area.bounds = {x: 0, y, width: 2500, height};y += height;
  });
  vertical.areas.reverse();assert.equal(await harness([vertical]).discover("parent"), id("1"));
  const horizontal = menu("parent");horizontal.size = {width: 2500, height: 843};
  horizontal.areas.forEach((area, index) => area.bounds = {x: index * 625, y: 0, width: 625, height: 843});
  assert.equal(await harness([horizontal]).discover("parent"), id("1"));
  for (const source of [menu("parent"), horizontal, vertical]) {
    const candidate = structuredClone(source);candidate.areas[1].bounds.x += 1;
    assert.equal(await harness([candidate]).discover("parent"), "");
  }
});
test("approved parent portal rejects staff/admin hints, another environment or school and unsafe desktop links", async () => {
  const unsafe = [uri("staff_portal").uri, channel.appOrigin + "/?schoolId=school-b", channel.appOrigin + "/",
    channel.appOrigin + "/?schoolId=school-a&schoolId=school-a", channel.appOrigin + "/uniform-event-admin.html?schoolId=school-a",
    channel.appOrigin + "/?schoolId=school-a&view=admin", channel.appOrigin + "/?schoolId=school-a&adminLineAccount=school-a",
    "https://lab.example.test/?schoolId=school-a"];
  for (const destination of unsafe) {
    const wrong = menu("parent");wrong.areas[3].action.uri = destination;
    assert.equal(await harness([wrong]).discover("parent"), "");
    const desktop = menu("parent");desktop.areas[3].action.altUri = {desktop: destination};
    assert.equal(await harness([desktop]).discover("parent"), "");
  }
  const parentPage = menu("parent");parentPage.areas[3].action.uri = channel.appOrigin + "/parent-uniform-events.html?schoolId=school-a";
  assert.equal(await harness([parentPage]).discover("parent"), id("1"));
});
test("provider failure, missing metadata or ambiguous matches fail closed without throwing private details", async () => {
  assert.equal(await harness([], true).discover(), "");assert.equal(await harness(undefined).discover(), "");
  const malformed = menu();malformed.richMenuId = "not-a-menu";assert.equal(await harness([malformed]).discover(), "");
});
test("parent first three commands can follow the existing image order but must be a unique supported set", async () => {
  const imageOrder = parentFacebook();[imageOrder.areas[1].action, imageOrder.areas[2].action] = [imageOrder.areas[2].action, imageOrder.areas[1].action];
  assert.equal(await harness([imageOrder]).discover("parent", {parentMenuId: id("1")}), id("1"));
  const legacyImageOrder = menu("parent");[legacyImageOrder.areas[1].action, legacyImageOrder.areas[2].action] = [legacyImageOrder.areas[2].action, legacyImageOrder.areas[1].action];
  assert.equal(await harness([legacyImageOrder]).discover("parent"), id("1"));
  imageOrder.areas[1].action = imageOrder.areas[0].action;
  assert.equal(await harness([imageOrder]).discover("parent", {parentMenuId: id("1")}), "");
});
test("the new parent five-grid has complete three-above-two geometry, a portal and the tenant Facebook redirect", async () => {
  assert.equal(await harness([parentFacebook()]).discover("parent", {parentMenuId: id("1")}), id("1"));
  const reverse = parentFacebook();reverse.areas.reverse();assert.equal(await harness([reverse]).discover("parent", {parentMenuId: id("1")}), id("1"));
  for (const index of [0, 2, 3, 4]) {
    const wrong = parentFacebook();wrong.areas[index].bounds.x += 1;
    assert.equal(await harness([wrong]).discover("parent", {parentMenuId: id("1")}), "");
  }
  const wrongSlot = parentFacebook();[wrongSlot.areas[3].action, wrongSlot.areas[4].action] = [wrongSlot.areas[4].action, wrongSlot.areas[3].action];
  assert.equal(await harness([wrongSlot]).discover("parent", {parentMenuId: id("1")}), "");
});
test("new Facebook variants take priority while staff chat actions retain priority over legacy URI queries", async () => {
  assert.equal(await harness([menu("parent", "1"), parentFacebook("2")]).discover("parent", {parentMenuId: id("2")}), id("2"));
  const newStaff = menu("staff", "2");newStaff.areas[5].action = facebook();
  assert.equal(await harness([menu("staff", "1"), newStaff]).discover("staff", {staffMenuId: id("2")}), id("2"));
  const legacyQueries = menu("staff", "2", true);legacyQueries.areas[5].action = facebook();
  assert.equal(await harness([menu("staff", "1"), legacyQueries]).discover("staff", {staffMenuId: id("2")}), id("1"));
});
test("Facebook buttons only use the exact school redirect endpoint and query, including alternate desktop targets", async () => {
  const bad = ["https://www.facebook.com/example", "https://lab.example.test/api/line/facebook/school-a?openExternalBrowser=1",
    channel.appOrigin + "/api/line/facebook/school-b?openExternalBrowser=1", channel.appOrigin + "/api/line/facebook/school-a",
    channel.appOrigin + "/api/line/facebook/school-a?openExternalBrowser=0", channel.appOrigin + "/api/line/facebook/school-a?openExternalBrowser=1&schoolId=school-a",
    channel.appOrigin + "/api/line/facebook/school-a?openExternalBrowser=1&openExternalBrowser=1"];
  for (const destination of bad) for (const audience of ["parent", "staff"]) {
    const candidate = audience === "parent" ? parentFacebook() : menu();
    const slot = audience === "parent" ? 4 : 5;
    candidate.areas[slot].action = {type: "uri", uri: destination};
    assert.equal(await harness([candidate]).discover(audience, {[audience === "parent" ? "parentMenuId" : "staffMenuId"]: id("1")}), "");
    const desktop = audience === "parent" ? parentFacebook() : menu();
    desktop.areas[slot].action = {...facebook(), altUri: {desktop: destination}};
    assert.equal(await harness([desktop]).discover(audience, {[audience === "parent" ? "parentMenuId" : "staffMenuId"]: id("1")}), "");
  }
});
test("uncommitted Facebook assets are ignored until a valid school Facebook URL is active", async () => {
  const newStaff = menu("staff", "2");newStaff.areas[5].action = facebook();
  for (const value of [undefined, "", "https://example.test/school-a", "http://www.facebook.com/school-a", "https://www.facebook.com/l.php?u=https://evil.example"]){
    assert.equal(await harness([parentFacebook("2"), menu("parent", "1")]).discover("parent", {facebookUrl: value, parentMenuId: id("2")}), id("1"));
    assert.equal(await harness([newStaff, menu("staff", "1")]).discover("staff", {facebookUrl: value, staffMenuId: id("2")}), id("1"));
    assert.equal(await harness([parentFacebook()]).discover("parent", {facebookUrl: value, parentMenuId: id("1")}), "");
    assert.equal(await harness([newStaff]).discover("staff", {facebookUrl: value, staffMenuId: id("2")}), "");
  }
});
test("an active Facebook redirect cannot adopt in-flight or orphan menu metadata before role IDs commit", async () => {
  const newStaff = menu("staff", "2");newStaff.areas[5].action = facebook();
  for (const audience of ["parent", "staff"]) {
    const newMenu = audience === "parent" ? parentFacebook("2") : newStaff;
    const roleKey = audience === "parent" ? "parentMenuId" : "staffMenuId";
    for (const committed of [undefined, "", id("1")]) {
      assert.equal(await harness([newMenu, menu(audience, "1")]).discover(audience, {[roleKey]: committed}), id("1"));
      assert.equal(await harness([newMenu]).discover(audience, {[roleKey]: committed}), "");
    }
    assert.equal(await harness([newMenu]).discover(audience, {[roleKey]: id("2")}), id("2"));
  }
});
