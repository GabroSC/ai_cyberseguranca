const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk",
  "com.br", "org.br", "gov.br", "net.br", "edu.br", "adv.br", "app.br",
  "com.au", "net.au", "org.au", "gov.au",
  "co.jp", "ne.jp", "or.jp",
  "com.mx", "com.ar", "com.co",
  "co.in", "co.za",
  "com.cn", "com.hk", "com.tw"
]);

function getRegistrableDomain(hostname) {
  if (!hostname) return "";
  hostname = hostname.split(":")[0].toLowerCase();

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;

  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

function isSameSite(hostnameA, hostnameB) {
  return getRegistrableDomain(hostnameA) === getRegistrableDomain(hostnameB);
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

if (typeof module !== "undefined") {
  module.exports = { getRegistrableDomain, isSameSite, getHostname };
}
