import {defaultTenantId} from "./storage.js";

const buildSuppressesExternalEmail = false;
const trimSetting = value => String(value || "").trim();
const empty = Object.freeze({connectionString: "", senderAddress: "", appUrl: "", mode: "unconfigured"});

export function tenantEmailAddress(value) {
  const address = trimSetting(value).slice(0, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && !address.endsWith(".invalid") ? address : "";
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
}

export function tenantEmailConfig(schoolId) {
  if (buildSuppressesExternalEmail || process.env.LAB_ENVIRONMENT === "functional-uat") {
    return {...empty, mode: "lab_suppressed"};
  }
  if (typeof schoolId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(schoolId || "") || schoolId.length > 60) return empty;
  const key = schoolId.toUpperCase().replaceAll("-", "_");
  const prefix = `ACS_EMAIL_${key}_`;
  const setting = suffix => trimSetting(process.env[prefix + suffix]);
  const enabled = setting("ENABLED");
  if (enabled && enabled !== "true") return {...empty, mode: "disabled"};

  const connectionString = setting("CONNECTION_STRING");
  const senderAddress = tenantEmailAddress(setting("SENDER"));
  const appUrl = httpsUrl(setting("APP_URL"));
  if (connectionString || setting("SENDER") || enabled === "true") {
    if (!connectionString || !senderAddress) return empty;
    return {connectionString, senderAddress, appUrl, mode: "tenant"};
  }
  if (schoolId !== defaultTenantId()) return empty;

  const legacyConnection = trimSetting(process.env.ACS_EMAIL_CONNECTION_STRING);
  const legacySender = tenantEmailAddress(process.env.ACS_EMAIL_SENDER);
  if (!legacyConnection || !legacySender) return empty;
  return {connectionString: legacyConnection, senderAddress: legacySender, appUrl, mode: "legacy"};
}

export function emailConfigured(schoolId) {
  return Boolean(tenantEmailConfig(schoolId).connectionString);
}
