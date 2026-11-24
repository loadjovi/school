import {lineApi} from "./lineMessaging.mjs";
import {tenantFacebookUrl} from "./lineFacebookConfig.js";

const richMenuId = /^richmenu-[a-f0-9]{32}$/i;
const staffTargets = ["staff_today_courses", "staff_activity_calendar", "staff_announcements", "staff_attendance", "staff_todos", "staff_portal"];
const queryLabels = ["今日課程", "活動行事曆", "最新公告"];
const staffQueryKeys = new Set(["line_menu", "schoolId", "openExternalBrowser", "openInAppBrowser"]);
const parentQueryKeys = new Set(["schoolId", "openExternalBrowser", "openInAppBrowser", "page", "view", "focus", "embedded"]);

function orderedGrid(menu, audience) {
  const {width, height} = menu?.size || {};
  const counts = audience === "parent" ? [4, 5] : [6];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      !Array.isArray(menu.areas) || !counts.includes(menu.areas.length)) return null;
  const areas = [...menu.areas];
  if (areas.some(area => !area?.bounds || ["x", "y", "width", "height"].some(key => !Number.isInteger(area.bounds[key])) ||
      area.bounds.x < 0 || area.bounds.y < 0 || area.bounds.width <= 0 || area.bounds.height <= 0)) return null;
  areas.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  if (audience === "parent" && areas.length === 5) {
    // Parent menu with Facebook: three query buttons above two portal buttons.
    let y = 0;
    const heights = [];
    for (const row of [areas.slice(0, 3), areas.slice(3)]) {
      let x = 0;
      for (const area of row) {
        const bounds = area.bounds;
        if (bounds.x !== x || bounds.y !== y || bounds.height !== row[0].bounds.height ||
            Math.abs(bounds.width - width / row.length) > 1 || Math.abs(bounds.height - height / 2) > 1) return null;
        x += bounds.width;
      }
      if (x !== width) return null;
      heights.push(row[0].bounds.height);
      y += row[0].bounds.height;
    }
    return y === height && Math.abs(heights[0] - heights[1]) <= 1 ? areas : null;
  }
  const layouts = audience === "parent" ? [[2, 2], [4, 1], [1, 4]] : [[3, 2]];
  const fits = ([columns, rows]) => {
    if (width < columns || height < rows) return false;
    let y = 0;
    const rowHeights = [];
    for (let index = 0; index < rows; index++) {
      const row = areas.slice(index * columns, (index + 1) * columns);
      let x = 0;
      for (let column = 0; column < columns; column++) {
        const bounds = row[column].bounds, first = areas[column].bounds;
        if (bounds.x !== x || bounds.y !== y || bounds.height !== row[0].bounds.height ||
            Math.abs(bounds.width - width / columns) > 1 || Math.abs(bounds.height - height / rows) > 1 ||
            bounds.x !== first.x || bounds.width !== first.width) return false;
        x += bounds.width;
      }
      if (x !== width) return false;
      rowHeights.push(row[0].bounds.height);
      y += row[0].bounds.height;
    }
    return y === height && Math.max(...rowHeights) - Math.min(...rowHeights) <= 1;
  };
  return layouts.some(fits) ? areas : null;
}

function sameSchoolUrl(value, channel) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || url.origin !== channel.appOrigin || url.hash ||
      url.searchParams.getAll("schoolId").some(id => id !== channel.schoolId)) return null;
  return url;
}

function normalizedUrl(url) {
  const query = [...url.searchParams].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  return url.origin + url.pathname + (query.length ? "?" + new URLSearchParams(query) : "");
}

function uriAction(action, channel, target) {
  // Menu metadata is created before an apply transaction commits. Ignore
  // Facebook candidates until the school has a valid, active redirect target.
  if (target === "facebook" && !tenantFacebookUrl(channel.facebookUrl)) return null;
  if (action?.type !== "uri" || typeof action.uri !== "string") return null;
  const values = [action.uri];
  if (action.altUri !== undefined) {
    if (!action.altUri || typeof action.altUri.desktop !== "string" || Object.keys(action.altUri).some(key => key !== "desktop")) return null;
    values.push(action.altUri.desktop);
  }
  const urls = values.map(value => sameSchoolUrl(value, channel));
  if (urls.some(url => !url)) return null;
  for (const url of urls) {
    if (target === "facebook") {
      if (url.pathname !== "/api/line/facebook/" + encodeURIComponent(channel.schoolId) ||
          url.searchParams.getAll("openExternalBrowser").length !== 1 || url.searchParams.get("openExternalBrowser") !== "1" ||
          [...url.searchParams.keys()].some(key => key !== "openExternalBrowser")) return null;
    } else if (target) {
      if (!["/", "/index.html"].includes(url.pathname) || url.searchParams.getAll("line_menu").length !== 1 ||
          url.searchParams.get("line_menu") !== target || url.searchParams.getAll("schoolId").length !== 1 ||
          [...url.searchParams.keys()].some(key => !staffQueryKeys.has(key))) return null;
    } else {
      const parentPath = ["/", "/index.html", "/line-account.html"].includes(url.pathname) || /^\/parent-[a-z0-9-]+\.html$/.test(url.pathname);
      if (!parentPath || url.searchParams.getAll("schoolId").length !== 1 ||
          [...url.searchParams.keys()].some(key => !parentQueryKeys.has(key)) ||
          [...url.searchParams.values()].some(value => /^(?:staff_|admin|global|finance|schoolAdmin|teacher)/i.test(value))) return null;
    }
  }
  return {type: "uri", uri: normalizedUrl(urls[0]), ...(urls.length > 1 ? {desktop: normalizedUrl(urls[1])} : {})};
}

function compatibleMenu(menu, channel, audience) {
  if (!richMenuId.test(menu?.richMenuId || "")) return null;
  const areas = orderedGrid(menu, audience);
  if (!areas) return null;
  const actions = [];
  let legacy = false, facebook = false;
  const parentQueries = new Set();
  for (let index = 0; index < areas.length; index++) {
    const action = areas[index].action;
    if (index < 3) {
      const text = typeof action?.text === "string" ? action.text.trim() : "";
      if (audience === "parent") {
        const query = text.startsWith("#") ? text.slice(1) : text;
        if (action?.type !== "message" || !queryLabels.includes(query) || parentQueries.has(query)) return null;
        parentQueries.add(query);actions.push({type: "message", text: query});
        continue;
      }
      const expected = "#幹部" + queryLabels[index];
      if (action?.type === "message" && text === expected) {
        actions.push({type: "message", text: expected});
        continue;
      }
      const uri = uriAction(action, channel, staffTargets[index]);
      if (!uri) return null;
      legacy = true;
      actions.push(uri);
    } else {
      const facebookSlot = audience === "staff" && index === 5 || audience === "parent" && index === 4;
      let uri = facebookSlot ? uriAction(action, channel, "facebook") : null;
      if (uri) facebook = true;
      else if (audience === "parent" && index === 4) return null;
      else uri = uriAction(action, channel, audience === "staff" ? staffTargets[index] : undefined);
      if (!uri) return null;
      actions.push(uri);
    }
  }
  // Mixed legacy/chat top rows are not a known platform template.
  if (legacy && actions.slice(0, 3).some(action => action.type !== "uri")) return null;
  // An apply can expose metadata before its transaction commits and may then
  // remove failed assets. Only committed role IDs may activate an FB variant.
  if (facebook && menu.richMenuId !== (audience === "staff" ? channel.staffMenuId : channel.parentMenuId)) return null;
  return {id: menu.richMenuId, priority: (legacy ? 2 : 0) + (facebook ? 0 : 1), signature: JSON.stringify({size: [menu.size.width, menu.size.height],
    areas: areas.map((area, index) => ({bounds: [area.bounds.x, area.bounds.y, area.bounds.width, area.bounds.height], action: actions[index]}))})};
}

// Discovery reads only the current official account's metadata. It neither
// creates a menu nor stores a role, account mapping, or per-user assignment.
export async function discoverTenantLineRoleMenu(channel, audience) {
  if (!["staff", "parent"].includes(audience) || !channel?.configured ||
      !channel.accessToken || !/^U[a-f0-9]{32}$/i.test(channel.botUserId || "") ||
      !/^[a-z0-9-]{2,60}$/.test(channel.schoolId || "")) return "";
  try {
    const origin = new URL(channel.appOrigin);
    if (origin.protocol !== "https:" || origin.origin !== channel.appOrigin) return "";
    const result = await lineApi("/v2/bot/richmenu/list", {method: "GET", accessToken: channel.accessToken, timeoutMs: 3000});
    if (!Array.isArray(result?.richmenus) || result.richmenus.length > 1000) return "";
    const candidates = result.richmenus.map(menu => compatibleMenu(menu, channel, audience)).filter(Boolean);
    if (!candidates.length) return "";
    const priority = Math.min(...candidates.map(menu => menu.priority)), preferred = candidates.filter(menu => menu.priority === priority);
    if (new Set(preferred.map(menu => menu.signature)).size !== 1) return "";
    return preferred.map(menu => menu.id).sort()[0];
  } catch {
    // A missing or ambiguous asset is recoverable through platform settings;
    // never expose provider bodies, credentials, or a guessed menu selection.
    return "";
  }
}
