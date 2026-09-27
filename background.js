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
    loadStartedAt: Date.now()
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

async function buildReport(tabId) {
  const tab = tabStore[tabId];
  if (!tab) return null;
  return {
    pageUrl: tab.pageUrl,
    pageDomain: tab.pageDomain,
    status: "Deteccao ainda nao implementada"
  };
}

browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  if (tabId === null || tabId === undefined) return;
  if (msg.type === "GET_REPORT") return Promise.resolve(buildReport(tabId));
});