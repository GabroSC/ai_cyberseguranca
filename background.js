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
function isSameSite(a, b) { return getRegistrableDomain(a) === getRegistrableDomain(b); }

const tabStore = {};

function freshTabData(url) {
  const hostname = getHostname(url);
  return {
    pageUrl: url,
    pageDomain: getRegistrableDomain(hostname),
    loadStartedAt: Date.now(),
    thirdPartyDomains: new Set(),
    requestLog: [],
    cookiesSeenOnLoad: [],
    redirectChains: [],
    cookieSyncCandidates: [],
    tokensSeen: {},
    canvasFingerprint: [],
    hijackIndicators: [],
    storageInfo: { localStorage: 0, sessionStorage: 0, indexedDB: [] },
    globalsBaseline: null,
    globalsAdded: []
  };
}

function ensureTab(tabId, url) {
  if (!tabStore[tabId] || (url && tabStore[tabId].pageDomain !== getRegistrableDomain(getHostname(url)))) {
    tabStore[tabId] = freshTabData(url || "");
  }
  return tabStore[tabId];
}

browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    tabStore[details.tabId] = freshTabData(details.url);
  }
});

const TOKEN_MIN_LEN = 16;

function extractTokens(url) {
  try {
    const u = new URL(url);
    const tokens = [];
    for (const [key, val] of u.searchParams.entries()) {
      if (val && val.length >= TOKEN_MIN_LEN && /^[A-Za-z0-9_\-\.]+$/.test(val)) {
        tokens.push(val);
      }
    }
    return tokens;
  } catch (e) {
    return [];
  }
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId);
    const reqDomain = getRegistrableDomain(getHostname(details.url));
    const thirdParty = tab.pageDomain && reqDomain && reqDomain !== tab.pageDomain;

    if (thirdParty) tab.thirdPartyDomains.add(reqDomain);

    tab.requestLog.push({
      url: details.url,
      domain: reqDomain,
      type: details.type,
      thirdParty,
      timestamp: Date.now()
    });

    const tokens = extractTokens(details.url);
    for (const tok of tokens) {
      if (!tab.tokensSeen[tok]) tab.tokensSeen[tok] = [];
      tab.tokensSeen[tok].push({ domain: reqDomain, url: details.url });
      const domainsForToken = new Set(tab.tokensSeen[tok].map(x => x.domain));
      if (domainsForToken.size >= 2 && thirdParty) {
        tab.cookieSyncCandidates.push({
          token: tok.substring(0, 12) + "...",
          domains: Array.from(domainsForToken),
          exampleUrl: details.url
        });
      }
    }

    if (tab.requestLog.length > 2000) tab.requestLog.shift();
  },
  { urls: ["<all_urls>"] },
  []
);

browser.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId);
    const fromDomain = getRegistrableDomain(getHostname(details.url));
    const toDomain = getRegistrableDomain(getHostname(details.redirectUrl));
    tab.redirectChains.push({
      from: details.url,
      fromDomain,
      to: details.redirectUrl,
      toDomain,
      statusCode: details.statusCode,
      timestamp: Date.now(),
      crossSite: fromDomain !== toDomain
    });
  },
  { urls: ["<all_urls>"] }
);

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId);
    const setCookieHeaders = (details.responseHeaders || []).filter(
      h => h.name.toLowerCase() === "set-cookie"
    );
    if (setCookieHeaders.length > 0) {
      const domain = getRegistrableDomain(getHostname(details.url));
      const thirdParty = tab.pageDomain && domain !== tab.pageDomain;
      for (const h of setCookieHeaders) {
        tab.cookiesSeenOnLoad.push({
          domain,
          thirdParty,
          url: details.url,
          rawFragment: (h.value || "").split(";")[0],
          timestamp: Date.now()
        });
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  if (tabId === null || tabId === undefined) return;

  if (msg.type === "GET_REPORT") return Promise.resolve(buildReport(tabId));
  if (msg.type === "GET_BLOCKLIST") return browser.storage.local.get("blocklist").then(r => r.blocklist || []);

  const tab = ensureTab(tabId);

  switch (msg.type) {
    case "CANVAS_FINGERPRINT":
      tab.canvasFingerprint.push({
        api: msg.api,
        frameUrl: sender.url,
        stackHint: msg.stackHint,
        timestamp: Date.now()
      });
      break;

    case "STORAGE_INFO":
      tab.storageInfo = msg.data;
      break;

    case "GLOBALS_REPORT":
      if (!tab.globalsBaseline) {
        tab.globalsBaseline = msg.globals;
      } else {
        const added = msg.globals.filter(g => !tab.globalsBaseline.includes(g));
        if (added.length) {
          tab.globalsAdded = Array.from(new Set([...tab.globalsAdded, ...added]));
          tab.hijackIndicators.push({
            kind: "global-object-injection",
            detail: `Novas propriedades globais detectadas: ${added.join(", ")}`,
            timestamp: Date.now()
          });
        }
      }
      break;

    case "WEBSOCKET_THIRD_PARTY":
      tab.hijackIndicators.push({
        kind: "websocket-third-party",
        detail: `WebSocket persistente para domínio de terceiro: ${msg.domain}`,
        url: msg.url,
        timestamp: Date.now()
      });
      break;
  }
});

let blocklistCache = [];
browser.storage.local.get("blocklist").then(r => { blocklistCache = r.blocklist || []; });
browser.storage.onChanged.addListener((changes) => {
  if (changes.blocklist) blocklistCache = changes.blocklist.newValue || [];
});

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const domain = getRegistrableDomain(getHostname(details.url));
    if (blocklistCache.includes(domain)) {
      return { cancel: true };
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

async function collectCookiesForTab(tabId) {
  const tab = tabStore[tabId];
  if (!tab) return { firstParty: { session: [], persistent: [] }, thirdParty: { session: [], persistent: [] } };

  const domainsToCheck = new Set([tab.pageDomain, ...tab.thirdPartyDomains]);
  const result = {
    firstParty: { session: [], persistent: [] },
    thirdParty: { session: [], persistent: [] }
  };

  for (const domain of domainsToCheck) {
    if (!domain) continue;
    let cookies = [];
    try {
      cookies = await browser.cookies.getAll({ domain });
    } catch (e) { continue; }
    const bucket = domain === tab.pageDomain ? result.firstParty : result.thirdParty;
    for (const c of cookies) {
      const entry = { name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly };
      if (c.session || !c.expirationDate) bucket.session.push(entry);
      else bucket.persistent.push(entry);
    }
  }
  return result;
}

function computeScore(report) {
  let penalty = 0;
  penalty += Math.min(report.thirdPartyDomains.length * 2, 30);
  penalty += Math.min(report.cookies.thirdParty.persistent.length * 1, 20);
  penalty += Math.min(report.cookies.thirdParty.session.length * 0.5, 10);
  penalty += Math.min(report.cookieSyncCandidates.length * 5, 20);
  penalty += Math.min(report.canvasFingerprint.length * 8, 24);
  penalty += Math.min(report.hijackIndicators.length * 6, 24);
  const crossSiteRedirects = report.redirectChains.filter(r => r.crossSite).length;
  penalty += Math.min(crossSiteRedirects * 3, 15);

  const score = Math.max(0, Math.round(100 - penalty));
  let classification = "Baixo risco";
  if (score < 50) classification = "Alto risco";
  else if (score < 80) classification = "Risco moderado";

  return { score, classification, penaltyBreakdown: {
    thirdPartyDomains: Math.min(report.thirdPartyDomains.length * 2, 30),
    persistentThirdPartyCookies: Math.min(report.cookies.thirdParty.persistent.length * 1, 20),
    sessionThirdPartyCookies: Math.min(report.cookies.thirdParty.session.length * 0.5, 10),
    cookieSync: Math.min(report.cookieSyncCandidates.length * 5, 20),
    canvasFingerprint: Math.min(report.canvasFingerprint.length * 8, 24),
    hijackIndicators: Math.min(report.hijackIndicators.length * 6, 24),
    crossSiteRedirects: Math.min(crossSiteRedirects * 3, 15)
  }};
}

async function buildReport(tabId) {
  const tab = tabStore[tabId];
  if (!tab) return null;
  const cookies = await collectCookiesForTab(tabId);

  const report = {
    pageUrl: tab.pageUrl,
    pageDomain: tab.pageDomain,
    thirdPartyDomains: Array.from(tab.thirdPartyDomains),
    requestCount: tab.requestLog.length,
    cookies,
    cookiesSeenOnLoad: tab.cookiesSeenOnLoad,
    redirectChains: tab.redirectChains,
    cookieSyncCandidates: dedupeCookieSync(tab.cookieSyncCandidates),
    canvasFingerprint: tab.canvasFingerprint,
    hijackIndicators: tab.hijackIndicators,
    storageInfo: tab.storageInfo
  };
  const scoring = computeScore(report);
  report.score = scoring.score;
  report.classification = scoring.classification;
  report.penaltyBreakdown = scoring.penaltyBreakdown;
  return report;
}

function dedupeCookieSync(list) {
  const seen = new Set();
  return list.filter(c => {
    const key = c.token + c.domains.sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
