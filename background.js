const MULTI_PART_SUFFIXES = new Set([
  "co.uk","org.uk","gov.uk","ac.uk","me.uk",
  "com.br","org.br","gov.br","net.br","edu.br","adv.br","app.br",
  "com.au","net.au","org.au","gov.au",
  "co.jp","ne.jp","or.jp",
  "com.mx","com.ar","com.co",
  "co.in","co.za",
  "com.cn","com.hk","com.tw"
]);
function getRegistrableDomain(hostname) {
  if (!hostname) return "";
  hostname = hostname.split(":")[0].toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}
function getHostname(url) { try { return new URL(url).hostname; } catch (e) { return ""; } }

const tabStore = {};

function freshTabData(url) {
  const hostname = getHostname(url);
  return {
    pageUrl: url,
    pageDomain: getRegistrableDomain(hostname),
    loadStartedAt: Date.now(),
    thirdPartyDomains: new Set(),
    requestLog: [],
    cookiesInjectedCount: 0,
    redirectChains: [],
    cookieSyncCandidates: [],
    tokensSeen: {},
    canvasFingerprint: [],
    storageInfo: { localStorage: 0, sessionStorage: 0, indexedDB: [] }
  };
}

function ensureTab(tabId, url) {
  if (!tabStore[tabId]) tabStore[tabId] = freshTabData(url || "");
  return tabStore[tabId];
}

browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) tabStore[details.tabId] = freshTabData(details.url);
});

const TOKEN_MIN_LEN = 16;
function extractTokens(url) {
  try {
    const u = new URL(url);
    const tokens = [];
    for (const [key, val] of u.searchParams.entries()) {
      if (val && val.length >= TOKEN_MIN_LEN && /^[A-Za-z0-9_\-\.]+$/.test(val)) tokens.push(val);
    }
    return tokens;
  } catch (e) { return []; }
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId);
    const reqDomain = getRegistrableDomain(getHostname(details.url));
    const thirdParty = tab.pageDomain && reqDomain && reqDomain !== tab.pageDomain;
    if (thirdParty) tab.thirdPartyDomains.add(reqDomain);
    tab.requestLog.push({ url: details.url, domain: reqDomain, thirdParty, timestamp: Date.now() });
    if (tab.requestLog.length > 2000) tab.requestLog.shift();

    const tokens = extractTokens(details.url);
    for (const tok of tokens) {
      if (!tab.tokensSeen[tok]) tab.tokensSeen[tok] = [];
      tab.tokensSeen[tok].push({ domain: reqDomain, url: details.url });
      const domainsForToken = new Set(tab.tokensSeen[tok].map(x => x.domain));
      if (domainsForToken.size >= 2 && thirdParty) {
        tab.cookieSyncCandidates.push({ token: tok.substring(0, 12) + "...", domains: Array.from(domainsForToken), exampleUrl: details.url });
      }
    }
  },
  { urls: ["<all_urls>"] }, []
);

browser.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId);
    const fromDomain = getRegistrableDomain(getHostname(details.url));
    const toDomain = getRegistrableDomain(getHostname(details.redirectUrl));
    tab.redirectChains.push({ from: details.url, fromDomain, to: details.redirectUrl, toDomain, statusCode: details.statusCode, timestamp: Date.now(), crossSite: fromDomain !== toDomain });
  },
  { urls: ["<all_urls>"] }
);

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId);
    const setCookieHeaders = (details.responseHeaders || []).filter(h => h.name.toLowerCase() === "set-cookie");
    tab.cookiesInjectedCount += setCookieHeaders.length;
  },
  { urls: ["<all_urls>"] }, ["responseHeaders"]
);

async function collectCookiesForTab(tabId) {
  const tab = tabStore[tabId];
  const result = { firstParty: { session: [], persistent: [] }, thirdParty: { session: [], persistent: [] } };
  if (!tab) return result;
  const domainsToCheck = new Set([tab.pageDomain, ...tab.thirdPartyDomains]);
  for (const domain of domainsToCheck) {
    if (!domain) continue;
    let cookies = [];
    try { cookies = await browser.cookies.getAll({ domain }); } catch (e) { continue; }
    const bucket = domain === tab.pageDomain ? result.firstParty : result.thirdParty;
    for (const c of cookies) {
      const entry = { name: c.name, domain: c.domain };
      if (c.session || !c.expirationDate) bucket.session.push(entry); else bucket.persistent.push(entry);
    }
  }
  return result;
}
function dedupeCookieSync(list) {
  const seen = new Set();
  return list.filter(c => {
    const key = c.token + c.domains.sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  if (tabId === null || tabId === undefined) return;
  if (msg.type === "GET_REPORT") return Promise.resolve(buildReport(tabId));

  const tab = ensureTab(tabId);
  if (msg.type === "STORAGE_INFO") tab.storageInfo = msg.data;
  if (msg.type === "CANVAS_FINGERPRINT") {
    tab.canvasFingerprint.push({ api: msg.api, frameUrl: sender.url, stackHint: msg.stackHint, timestamp: Date.now() });
  }
});

async function buildReport(tabId) {
  const tab = tabStore[tabId];
  if (!tab) return null;
  const cookies = await collectCookiesForTab(tabId);
  return {
    pageUrl: tab.pageUrl,
    pageDomain: tab.pageDomain,
    thirdPartyDomains: Array.from(tab.thirdPartyDomains),
    requestCount: tab.requestLog.length,
    cookiesInjectedCount: tab.cookiesInjectedCount,
    cookies,
    redirectChains: tab.redirectChains,
    cookieSyncCandidates: dedupeCookieSync(tab.cookieSyncCandidates),
    canvasFingerprint: tab.canvasFingerprint,
    storageInfo: tab.storageInfo
  };
}
