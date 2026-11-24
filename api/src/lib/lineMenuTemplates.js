import {createHash} from "node:crypto";
import {tenantFacebookUrl} from "./lineFacebookConfig.js";

export const LINE_MENU_TEMPLATE_VERSION = "facebook-v1";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function inspectLineMenuAsset(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length < 20 || bytes.length > 1024 * 1024) throw new Error("選單圖片須小於 1 MB");
  let width, height, contentType;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(pngSignature) && bytes.toString("ascii", 12, 16) === "IHDR") {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); contentType = "image/png";
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let position = 2;
    while (position + 3 < bytes.length) {
      if (bytes[position] !== 255) break;
      while (bytes[position] === 255) position++;
      const marker = bytes[position++];
      if ([0xD9, 0xDA].includes(marker)) break;
      if (marker === 0x01 || marker >= 0xD0 && marker <= 0xD8) continue;
      if (position + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(position);
      if (length < 2 || position + length > bytes.length) break;
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
        if (length < 7) break;
        height = bytes.readUInt16BE(position + 3); width = bytes.readUInt16BE(position + 5); contentType = "image/jpeg"; break;
      }
      position += length;
    }
  }
  if (!contentType) throw new Error("選單圖片不是有效的 PNG 或 JPEG");
  if (width < 800 || width > 2500 || height < 250 || width / height < 1.45) {
    throw new Error("選單圖片尺寸不符合 LINE 規格");
  }
  return {bytes, width, height, contentType, sha256: createHash("sha256").update(bytes).digest("hex")};
}

export function normalizeLineFacebookUrl(value) {
  return tenantFacebookUrl(value);
}

function rowBounds(width, y, height, columns) {
  return Array.from({length: columns}, (_, index) => {
    const x = Math.floor(width * index / columns), end = Math.floor(width * (index + 1) / columns);
    return {x, y, width: end - x, height};
  });
}

export function buildLineMenuTemplate(channel, audience, asset, facebookUrl) {
  const {schoolId, botUserId, appOrigin} = channel;
  if (!["parent", "staff"].includes(audience) || !normalizeLineFacebookUrl(facebookUrl)) throw new Error("Facebook 選單設定不正確");
  const origin = new URL(appOrigin);
  if (origin.protocol !== "https:" || origin.origin !== appOrigin || !/^[a-z0-9-]{2,60}$/.test(schoolId || "") ||
      !/^U[a-f0-9]{32}$/i.test(botUserId || "")) throw new Error("學校 LINE 設定不正確");
  const route = target => new URL("/?" + new URLSearchParams({line_menu: target, schoolId, openExternalBrowser: "1"}), appOrigin).href;
  const facebook = new URL("/api/line/facebook/" + encodeURIComponent(schoolId) + "?openExternalBrowser=1", appOrigin).href;
  const portal = new URL("/?" + new URLSearchParams({schoolId, openExternalBrowser: "1"}), appOrigin).href;
  const message = (label, staff = false) => ({type: "message", label, text: (staff ? "#幹部" : "") + label});
  const uri = (label, value) => ({type: "uri", label, uri: value});
  const split = Math.floor(asset.height / 2);
  const bounds = [
    ...rowBounds(asset.width, 0, split, 3),
    ...rowBounds(asset.width, split, asset.height - split, audience === "parent" ? 2 : 3)
  ];
  const actions = audience === "parent" ? [
    message("今日課程"), message("最新公告"), message("活動行事曆"), uri("開啟家長平台", portal), uri("活動影音", facebook)
  ] : [
    message("今日課程", true), message("活動行事曆", true), message("最新公告", true),
    uri("點名管理", route("staff_attendance")), uri("待辦事項", route("staff_todos")), uri("活動影音", facebook)
  ];
  const version = createHash("sha256").update(JSON.stringify([schoolId, botUserId, appOrigin, facebookUrl, audience, asset.sha256])).digest("hex").slice(0, 16);
  return {
    size: {width: asset.width, height: asset.height}, selected: true,
    name: `school-${schoolId}-${audience}-${LINE_MENU_TEMPLATE_VERSION}-${version}`,
    chatBarText: audience === "parent" ? "家長功能" : "幹部功能",
    areas: bounds.map((bounds, index) => ({bounds, action: actions[index]}))
  };
}

export function lineMenuTemplateSignature(menu) {
  if (!menu || !Array.isArray(menu.areas)) return "";
  return JSON.stringify({size: [menu.size?.width, menu.size?.height], selected: menu.selected, name: menu.name, chatBarText: menu.chatBarText,
    areas: [...menu.areas].sort((a, b) => a.bounds?.y - b.bounds?.y || a.bounds?.x - b.bounds?.x).map(area => ({
      bounds: [area.bounds?.x, area.bounds?.y, area.bounds?.width, area.bounds?.height],
      action: {type: area.action?.type, label: area.action?.label || "", text: area.action?.text || "", uri: area.action?.uri || "",
        ...(area.action?.altUri ? {altUri: area.action.altUri} : {})}
    }))});
}
