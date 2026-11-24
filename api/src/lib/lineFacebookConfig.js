const facebookHosts = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);

// This is only a form suggestion for the school that supplied this address.
// It never activates a redirect or becomes another school's fallback.
const schoolSuggestions = new Map([
  ["sacred-heart", "https://www.facebook.com/profile.php?id=100075610947066"]
]);

export function tenantFacebookSuggestion(schoolId) {
  return schoolSuggestions.get(schoolId) || "";
}

export function tenantFacebookUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !facebookHosts.has(url.hostname) || url.username || url.password ||
        url.port || /^(?:\/l\.php|\/flx\/warn|\/sharer(?:\.php)?|\/dialog)(?:\/|$)/i.test(url.pathname) ||
        [...url.searchParams.keys()].some(key => /^(?:u|url|href|next|redirect_uri)$/i.test(key))) return "";
    return url.href;
  } catch { return ""; }
}

export function tenantFacebookMenuUrl(channel) {
  return channel.appOrigin + "/api/line/facebook/" + encodeURIComponent(channel.schoolId) + "?openExternalBrowser=1";
}
