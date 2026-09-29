"use strict";

const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk",
  "com.br", "org.br", "gov.br", "net.br", "edu.br", "adv.br", "app.br",
  "com.au", "net.au", "org.au", "gov.au",
  "co.jp", "ne.jp", "or.jp",
  "com.mx", "com.ar", "com.co",
  "co.in", "co.za",
  "com.cn", "com.hk", "com.tw"
]);

const TOKEN_MIN_LEN = 16;
const MAX_REQUESTS = 2000;
const MAX_CANVAS_EVENTS = 500;
const MAX_HIJACK_INDICATORS = 100;

function getRegistrableDomain(hostname) {
  if (!hostname) return "";
  hostname = String(hostname).replace(/^\.+|\.+$/g, "").toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  if (hostname.includes(":")) return hostname;
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

function getHostname(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ""); }
  catch (e) { return ""; }
}

function getOrigin(url, frameId) {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? `opaque-frame:${frameId}` : origin;
  } catch (e) {
    return `unknown-frame:${frameId}`;
  }
}

function isSameSite(hostnameA, hostnameB) {
  const a = getRegistrableDomain(hostnameA);
  const b = getRegistrableDomain(hostnameB);
  return Boolean(a && b && a === b);
}

const tabStore = {};

function freshTabData(url) {
  const hostname = getHostname(url);
  return {
    pageUrl: url || "",
    pageDomain: getRegistrableDomain(hostname),
    loadStartedAt: Date.now(),
    loadCompletedAt: null,
    thirdPartyDomains: new Set(),
    requestLog: [],
    cookiesSetOnLoad: [],
    cookieWriteIndex: Object.create(null),
    redirectChains: [],
    cookieSyncCandidates: [],
    tokensSeen: Object.create(null),
    canvasFingerprint: [],
    hijackIndicators: [],
    hijackIndicatorKeys: new Set(),
    storageByFrame: Object.create(null),
    storageInfo: { localStorage: 0, sessionStorage: 0, indexedDB: [], origins: [] },
    globalsByFrame: Object.create(null)
  };
}

function ensureTab(tabId, url) {
  if (!tabStore[tabId]) tabStore[tabId] = freshTabData(url || "");
  return tabStore[tabId];
}

browser.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId === 0) tabStore[details.tabId] = freshTabData(details.url);
});

browser.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  const tab = ensureTab(details.tabId, details.url);
  tab.pageUrl = details.url;
  tab.pageDomain = getRegistrableDomain(getHostname(details.url));
});

browser.webNavigation.onCompleted.addListener(details => {
  if (details.frameId === 0 && tabStore[details.tabId]) {
    tabStore[details.tabId].loadCompletedAt = Date.now();
  }
});

function extractTokens(url) {
  try {
    const parsed = new URL(url);
    const tokens = [];
    for (const value of parsed.searchParams.values()) {
      if (value && value.length >= TOKEN_MIN_LEN && /^[A-Za-z0-9_.-]+$/.test(value)) {
        tokens.push(value);
      }
    }
    return tokens;
  } catch (e) {
    return [];
  }
}

browser.webRequest.onBeforeRequest.addListener(
  details => {
    if (details.tabId < 0) return;
    const initialUrl = details.type === "main_frame" ? details.url : "";
    const tab = ensureTab(details.tabId, initialUrl);
    const requestDomain = getRegistrableDomain(getHostname(details.url));
    const thirdParty = Boolean(tab.pageDomain && requestDomain && requestDomain !== tab.pageDomain);

    if (thirdParty) tab.thirdPartyDomains.add(requestDomain);
    tab.requestLog.push({
      url: details.url,
      domain: requestDomain,
      type: details.type,
      thirdParty,
      timestamp: Date.now()
    });
    if (tab.requestLog.length > MAX_REQUESTS) tab.requestLog.shift();

    for (const token of extractTokens(details.url)) {
      if (!tab.tokensSeen[token]) tab.tokensSeen[token] = [];
      const observations = tab.tokensSeen[token];
      observations.push({ domain: requestDomain, url: details.url });
      if (observations.length > 30) observations.shift();
      const domainsForToken = new Set(observations.map(item => item.domain).filter(Boolean));
      if (domainsForToken.size >= 2 && thirdParty) {
        tab.cookieSyncCandidates.push({
          token: token.substring(0, 12) + "...",
          domains: Array.from(domainsForToken),
          exampleUrl: details.url
        });
      }
    }
  },
  { urls: ["<all_urls>"] }
);

browser.webRequest.onBeforeRedirect.addListener(
  details => {
    if (details.tabId < 0 || details.frameId !== 0 || details.type !== "main_frame") return;
    const tab = ensureTab(details.tabId, details.url);
    const fromDomain = getRegistrableDomain(getHostname(details.url));
    const toDomain = getRegistrableDomain(getHostname(details.redirectUrl));
    tab.redirectChains.push({
      from: details.url,
      fromDomain,
      to: details.redirectUrl,
      toDomain,
      statusCode: details.statusCode,
      timestamp: Date.now(),
      crossSite: Boolean(fromDomain && toDomain && fromDomain !== toDomain)
    });
  },
  { urls: ["<all_urls>"] }
);

function parseCookieWrite(rawValue, sourceUrl, mechanism) {
  if (typeof rawValue !== "string" || !rawValue) return null;
  const parts = rawValue.split(";").map(part => part.trim());
  const nameValue = parts.shift() || "";
  const separator = nameValue.indexOf("=");
  if (separator <= 0) return null;

  const name = nameValue.slice(0, separator).trim();
  if (!name || name.length > 256) return null;

  const attributes = Object.create(null);
  for (const part of parts) {
    const attributeSeparator = part.indexOf("=");
    const key = (attributeSeparator >= 0 ? part.slice(0, attributeSeparator) : part)
      .trim().toLowerCase();
    const value = attributeSeparator >= 0 ? part.slice(attributeSeparator + 1).trim() : true;
    if (key) attributes[key] = value;
  }

  if (attributes["max-age"] !== undefined && Number(attributes["max-age"]) <= 0) return null;
  if (attributes.expires) {
    const expiresAt = Date.parse(attributes.expires);
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) return null;
  }

  const sourceHost = getHostname(sourceUrl);
  const cookieHost = String(attributes.domain || sourceHost).replace(/^\.+/, "").toLowerCase();
  if (!cookieHost) return null;

  return {
    name,
    host: cookieHost,
    domain: getRegistrableDomain(cookieHost),
    path: typeof attributes.path === "string" ? attributes.path : "/",
    persistent: attributes.expires !== undefined || attributes["max-age"] !== undefined,
    secure: attributes.secure === true,
    httpOnly: attributes.httponly === true,
    sameSite: typeof attributes.samesite === "string" ? attributes.samesite : "",
    mechanism,
    sourceUrl,
    timestamp: Date.now()
  };
}

function recordCookieWrite(tab, entry) {
  if (!entry || tab.loadCompletedAt) return;
  entry.thirdParty = Boolean(tab.pageDomain && entry.domain && entry.domain !== tab.pageDomain);
  const key = `${entry.host}|${entry.path}|${entry.name}`;
  const existingIndex = tab.cookieWriteIndex[key];

  if (existingIndex !== undefined) {
    const existing = tab.cookiesSetOnLoad[existingIndex];
    existing.persistent = entry.persistent;
    existing.secure = entry.secure;
    existing.httpOnly = entry.httpOnly;
    existing.sameSite = entry.sameSite;
    existing.timestamp = entry.timestamp;
    if (!existing.mechanisms.includes(entry.mechanism)) existing.mechanisms.push(entry.mechanism);
    return;
  }

  entry.mechanisms = [entry.mechanism];
  delete entry.mechanism;
  tab.cookieWriteIndex[key] = tab.cookiesSetOnLoad.length;
  tab.cookiesSetOnLoad.push(entry);
}

browser.webRequest.onHeadersReceived.addListener(
  details => {
    if (details.tabId < 0) return;
    const tab = ensureTab(details.tabId, details.url);
    const setCookieHeaders = (details.responseHeaders || [])
      .filter(header => String(header.name).toLowerCase() === "set-cookie");
    for (const header of setCookieHeaders) {
      recordCookieWrite(tab, parseCookieWrite(header.value || "", details.url, "network"));
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeStorageData(data) {
  return {
    localStorage: safeCount(data && data.localStorage),
    sessionStorage: safeCount(data && data.sessionStorage),
    indexedDB: Array.isArray(data && data.indexedDB)
      ? Array.from(new Set(data.indexedDB.filter(name => typeof name === "string").slice(0, 100)))
      : []
  };
}

function aggregateStorage(storageByFrame) {
  const byOrigin = Object.create(null);
  for (const frame of Object.values(storageByFrame)) {
    if (!byOrigin[frame.origin]) {
      byOrigin[frame.origin] = {
        origin: frame.origin,
        localStorage: 0,
        sessionStorage: 0,
        indexedDB: new Set()
      };
    }
    const origin = byOrigin[frame.origin];
    // Storage é por origem; usar o maior valor evita duplicar a mesma origem
    // quando ela aparece em mais de um iframe.
    origin.localStorage = Math.max(origin.localStorage, frame.localStorage);
    origin.sessionStorage = Math.max(origin.sessionStorage, frame.sessionStorage);
    frame.indexedDB.forEach(name => origin.indexedDB.add(name));
  }

  const origins = Object.values(byOrigin).map(item => ({
    origin: item.origin,
    localStorage: item.localStorage,
    sessionStorage: item.sessionStorage,
    indexedDB: Array.from(item.indexedDB)
  }));

  return {
    localStorage: origins.reduce((sum, item) => sum + item.localStorage, 0),
    sessionStorage: origins.reduce((sum, item) => sum + item.sessionStorage, 0),
    indexedDB: origins.flatMap(item => item.indexedDB.map(name => `${item.origin} → ${name}`)),
    origins
  };
}

function addHijackIndicator(tab, indicator) {
  const key = [indicator.kind, indicator.frameId, indicator.url, indicator.detail].join("|");
  if (tab.hijackIndicatorKeys.has(key)) return;
  tab.hijackIndicatorKeys.add(key);
  tab.hijackIndicators.push(indicator);
  if (tab.hijackIndicators.length > MAX_HIJACK_INDICATORS) tab.hijackIndicators.shift();
}

browser.runtime.onMessage.addListener((message, sender) => {
  const msg = message || {};

  // Mensagens originadas pelo popup não têm sender.tab nem precisam de tabId.
  if (msg.type === "GET_BLOCKLIST") {
    return browser.storage.local.get("blocklist")
      .then(result => (result.blocklist || []).map(normalizeBlockRule).filter(Boolean));
  }

  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  if (tabId === null || tabId === undefined) return undefined;
  if (msg.type === "GET_REPORT") return buildReport(tabId);

  const tab = ensureTab(tabId, sender.url || "");
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const frameKey = String(frameId);

  switch (msg.type) {
    case "CANVAS_FINGERPRINT": {
      if (tab.canvasFingerprint.length >= MAX_CANVAS_EVENTS) break;
      const api = typeof msg.api === "string" ? msg.api.substring(0, 100) : "canvas-readout";
      tab.canvasFingerprint.push({
        api,
        frameId,
        frameUrl: sender.url || "",
        stackHint: typeof msg.stackHint === "string" ? msg.stackHint.substring(0, 400) : "",
        timestamp: Date.now()
      });
      break;
    }

    case "COOKIE_WRITE": {
      const raw = typeof msg.raw === "string" ? msg.raw.substring(0, 4096) : "";
      recordCookieWrite(tab, parseCookieWrite(raw, sender.url || tab.pageUrl, "javascript"));
      break;
    }

    case "STORAGE_INFO": {
      const data = normalizeStorageData(msg.data);
      tab.storageByFrame[frameKey] = Object.assign(data, {
        frameId,
        frameUrl: sender.url || "",
        origin: getOrigin(sender.url || "", frameId)
      });
      tab.storageInfo = aggregateStorage(tab.storageByFrame);
      break;
    }

    case "GLOBALS_REPORT": {
      const globals = Array.isArray(msg.globals)
        ? Array.from(new Set(msg.globals.filter(value => typeof value === "string").slice(0, 4000)))
        : [];
      if (!tab.globalsByFrame[frameKey]) {
        tab.globalsByFrame[frameKey] = { baseline: globals, added: [] };
      } else {
        const state = tab.globalsByFrame[frameKey];
        const baseline = new Set(state.baseline);
        const added = globals.filter(name => !baseline.has(name)).slice(0, 50);
        if (added.length) {
          state.added = Array.from(new Set(state.added.concat(added)));
          addHijackIndicator(tab, {
            kind: "global-object-change",
            detail: `Novas propriedades globais no frame ${frameId}: ${added.join(", ")}`,
            frameId,
            url: sender.url || "",
            timestamp: Date.now()
          });
        }
      }
      break;
    }

    case "WEBSOCKET_PERSISTENT": {
      const url = typeof msg.url === "string" ? msg.url.substring(0, 2048) : "";
      const socketDomain = getRegistrableDomain(getHostname(url));
      if (socketDomain && tab.pageDomain && socketDomain !== tab.pageDomain) {
        addHijackIndicator(tab, {
          kind: "persistent-third-party-websocket",
          detail: `WebSocket de terceiro aberto por mais de 10 s: ${socketDomain}`,
          frameId,
          url,
          timestamp: Date.now()
        });
      }
      break;
    }
  }

  return undefined;
});

function normalizeBlockRule(value) {
  if (typeof value !== "string") return "";
  let candidate = value.trim().toLowerCase().replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
  if (!candidate) return "";
  try {
    if (candidate.includes("://") || candidate.includes("/") || candidate.includes(":")) {
      candidate = new URL(candidate.includes("://") ? candidate : `https://${candidate}`)
        .hostname.toLowerCase().replace(/^\.+|\.+$/g, "");
    }
  } catch (e) {
    return "";
  }
  return /^[a-z0-9:[\]._-]+$/i.test(candidate) ? candidate : "";
}

function hostnameMatchesRule(hostname, rule) {
  return Boolean(hostname && rule && (hostname === rule || hostname.endsWith(`.${rule}`)));
}

let blocklistCache = [];
browser.storage.local.get("blocklist").then(result => {
  blocklistCache = (result.blocklist || []).map(normalizeBlockRule).filter(Boolean);
});
browser.storage.onChanged.addListener(changes => {
  if (changes.blocklist) {
    blocklistCache = (changes.blocklist.newValue || []).map(normalizeBlockRule).filter(Boolean);
  }
});

browser.webRequest.onBeforeRequest.addListener(
  details => {
    const hostname = getHostname(details.url);
    if (blocklistCache.some(rule => hostnameMatchesRule(hostname, rule))) return { cancel: true };
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

async function collectCookiesForTab(tabId) {
  const tab = tabStore[tabId];
  const empty = { firstParty: { session: [], persistent: [] }, thirdParty: { session: [], persistent: [] } };
  if (!tab) return empty;

  const domainsToCheck = new Set([tab.pageDomain, ...tab.thirdPartyDomains]);
  for (const domain of domainsToCheck) {
    if (!domain) continue;
    let cookies = [];
    try { cookies = await browser.cookies.getAll({ domain }); }
    catch (e) { continue; }

    const bucket = domain === tab.pageDomain ? empty.firstParty : empty.thirdParty;
    for (const cookie of cookies) {
      const entry = {
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly
      };
      if (cookie.session || !cookie.expirationDate) bucket.session.push(entry);
      else bucket.persistent.push(entry);
    }
  }
  return empty;
}

function categorizeCookieWrites(entries) {
  const result = { firstParty: { session: [], persistent: [] }, thirdParty: { session: [], persistent: [] } };
  for (const entry of entries) {
    const party = entry.thirdParty ? result.thirdParty : result.firstParty;
    (entry.persistent ? party.persistent : party.session).push(entry);
  }
  return result;
}

function computeScore(report) {
  const loadCookies = report.cookiesSetOnLoad;
  const penalties = {
    thirdPartyDomains: Math.min(report.thirdPartyDomains.length * 2, 30),
    persistentThirdPartyCookies: Math.min(loadCookies.thirdParty.persistent.length, 20),
    sessionThirdPartyCookies: Math.min(loadCookies.thirdParty.session.length * 0.5, 10),
    cookieSync: Math.min(report.cookieSyncCandidates.length * 5, 20),
    canvasFingerprint: Math.min(report.canvasFingerprint.length * 8, 24),
    hijackIndicators: Math.min(report.hijackIndicators.length * 6, 24),
    crossSiteRedirects: Math.min(report.redirectChains.filter(item => item.crossSite).length * 3, 15)
  };
  const totalPenalty = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  const score = Math.max(0, Math.round(100 - totalPenalty));
  const classification = score < 50 ? "Alto risco" : score < 80 ? "Risco moderado" : "Baixo risco";
  return { score, classification, penaltyBreakdown: penalties };
}

async function buildReport(tabId) {
  const tab = tabStore[tabId];
  if (!tab) return null;
  const cookies = await collectCookiesForTab(tabId);
  const cookiesSetOnLoad = categorizeCookieWrites(tab.cookiesSetOnLoad);
  const report = {
    pageUrl: tab.pageUrl,
    pageDomain: tab.pageDomain,
    loadStartedAt: tab.loadStartedAt,
    loadCompletedAt: tab.loadCompletedAt,
    thirdPartyDomains: Array.from(tab.thirdPartyDomains).sort(),
    requestCount: tab.requestLog.length,
    cookies,
    cookiesSetOnLoad,
    cookiesSeenOnLoad: tab.cookiesSetOnLoad,
    redirectChains: tab.redirectChains,
    cookieSyncCandidates: dedupeCookieSync(tab.cookieSyncCandidates),
    canvasFingerprint: tab.canvasFingerprint,
    hijackIndicators: tab.hijackIndicators,
    storageInfo: tab.storageInfo
  };
  Object.assign(report, computeScore(report));
  return report;
}

function dedupeCookieSync(list) {
  const seen = new Set();
  return list.filter(candidate => {
    const key = `${candidate.token}|${[...candidate.domains].sort().join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
