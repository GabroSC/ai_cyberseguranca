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
    cookiesInjectedCount: 0
  };
}

function ensureTab(tabId, url) {
  if (!tabStore[tabId]) tabStore[tabId] = freshTabData(url || "");
  return tabStore[tabId];
}

browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    tabStore[details.tabId] = freshTabData(details.url);
  }
});

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId);
    const reqDomain = getRegistrableDomain(getHostname(details.url));
    const thirdParty = tab.pageDomain && reqDomain && reqDomain !== tab.pageDomain;
    if (thirdParty) tab.thirdPartyDomains.add(reqDomain);
    tab.requestLog.push({ url: details.url, domain: reqDomain, thirdParty, timestamp: Date.now() });
    if (tab.requestLog.length > 2000) tab.requestLog.shift();
  },
  { urls: ["<all_urls>"] },
  []
);

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId);
    const setCookieHeaders = (details.responseHeaders || []).filter(
      h => h.name.toLowerCase() === "set-cookie"
    );
    tab.cookiesInjectedCount += setCookieHeaders.length;
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

async function buildReport(tabId) {
  const tab = tabStore[tabId];
  if (!tab) return null;
  return {
    pageUrl: tab.pageUrl,
    pageDomain: tab.pageDomain,
    thirdPartyDomains: Array.from(tab.thirdPartyDomains),
    requestCount: tab.requestLog.length,
    cookiesInjectedCount: tab.cookiesInjectedCount
  };
}

browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  if (tabId === null || tabId === undefined) return;
  if (msg.type === "GET_REPORT") return Promise.resolve(buildReport(tabId));
});
