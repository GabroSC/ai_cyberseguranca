"use strict";

const EMPTY_COOKIES = {
  firstParty: { session: [], persistent: [] },
  thirdParty: { session: [], persistent: [] }
};

const PENALTY_LABELS = {
  thirdPartyDomains: "Domínios de terceiros",
  persistentThirdPartyCookies: "Cookies persistentes de terceiros definidos no carregamento",
  sessionThirdPartyCookies: "Cookies de sessão de terceiros definidos no carregamento",
  cookieSync: "Candidatos a cookie sync",
  canvasFingerprint: "Leituras de canvas/WebGL",
  hijackIndicators: "Indicadores de hijacking/hook",
  crossSiteRedirects: "Redirecionamentos cross-site da navegação principal"
};

async function getActiveTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function scoreClass(score) {
  if (score >= 80) return "low";
  if (score >= 50) return "mid";
  return "high";
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function createCard(title) {
  const card = element("div", "card");
  card.appendChild(element("h3", "", title));
  return card;
}

function appendLine(parent, text, className) {
  parent.appendChild(element("div", className || "", text));
}

function createList(items, emptyText) {
  if (!items || items.length === 0) return element("span", "muted", emptyText);
  const list = document.createElement("ul");
  items.forEach(item => list.appendChild(element("li", "", item)));
  return list;
}

function countCookies(cookies) {
  return cookies.session.length + cookies.persistent.length;
}

function formatPenalty(value) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

async function loadReport() {
  const tabId = await getActiveTabId();
  if (tabId === null) return;

  const badge = document.getElementById("score-badge");
  const domainElement = document.getElementById("page-domain");
  const sections = document.getElementById("sections");

  try {
    const report = await browser.runtime.sendMessage({ type: "GET_REPORT", tabId });
    if (!report) {
      domainElement.textContent = "Sem dados ainda — recarregue a página.";
      badge.textContent = "--";
      sections.replaceChildren();
      return;
    }

    const currentCookies = report.cookies || EMPTY_COOKIES;
    const loadCookies = report.cookiesSetOnLoad || EMPTY_COOKIES;
    const storage = report.storageInfo || { localStorage: 0, sessionStorage: 0, indexedDB: [], origins: [] };
    const redirects = (report.redirectChains || []).filter(item => item.crossSite);

    domainElement.textContent = report.pageDomain || report.pageUrl;
    badge.textContent = report.score;
    badge.className = "score-badge " + scoreClass(report.score);
    badge.title = report.classification;

    const thirdPartyCard = createCard(`Domínios de terceiros conectados (${report.thirdPartyDomains.length})`);
    thirdPartyCard.appendChild(createList(report.thirdPartyDomains, "nenhum detectado"));

    const loadCookiesCard = createCard("Cookies únicos definidos durante o carregamento");
    appendLine(loadCookiesCard,
      `1ª parte: ${countCookies(loadCookies.firstParty)} (sessão: ${loadCookies.firstParty.session.length}, persistentes: ${loadCookies.firstParty.persistent.length})`);
    appendLine(loadCookiesCard,
      `3ª parte: ${countCookies(loadCookies.thirdParty)} (sessão: ${loadCookies.thirdParty.session.length}, persistentes: ${loadCookies.thirdParty.persistent.length})`);
    appendLine(loadCookiesCard,
      "Inclui Set-Cookie de rede e escritas em document.cookie observadas até a conclusão do carregamento.", "muted note");

    const currentCookiesCard = createCard("Cookies atualmente armazenados no perfil");
    appendLine(currentCookiesCard,
      `1ª parte: ${countCookies(currentCookies.firstParty)} (sessão: ${currentCookies.firstParty.session.length}, persistentes: ${currentCookies.firstParty.persistent.length})`);
    appendLine(currentCookiesCard,
      `3ª parte: ${countCookies(currentCookies.thirdParty)} (sessão: ${currentCookies.thirdParty.session.length}, persistentes: ${currentCookies.thirdParty.persistent.length})`);

    const storageCard = createCard(`Armazenamento HTML5 (${(storage.origins || []).length} origem(ns))`);
    appendLine(storageCard, `localStorage: ${storage.localStorage} chave(s)`);
    appendLine(storageCard, `sessionStorage: ${storage.sessionStorage} chave(s)`);
    appendLine(storageCard, `IndexedDB: ${storage.indexedDB.length} banco(s)`);
    storageCard.appendChild(createList(storage.indexedDB, "nenhum banco detectado"));

    const syncCard = createCard("Cookie sync / bounce tracking");
    appendLine(syncCard, `Candidatos a cookie sync: ${report.cookieSyncCandidates.length}`);
    syncCard.appendChild(createList(
      report.cookieSyncCandidates.map(item => item.domains.join(" ↔ ")), "nenhum candidato"));
    appendLine(syncCard, `Redirecionamentos cross-site da navegação principal: ${redirects.length}`);

    const canvasCard = createCard(`Canvas/WebGL (${report.canvasFingerprint.length} leitura(s))`);
    canvasCard.appendChild(createList(
      report.canvasFingerprint.map(item => item.api), "nenhuma leitura detectada"));

    const hijackCard = createCard(`Indicadores de hijacking/hook (${report.hijackIndicators.length})`);
    hijackCard.appendChild(createList(
      report.hijackIndicators.map(item => item.detail), "nenhum indicador"));

    const scoreCard = createCard(`Detalhamento da pontuação — ${report.classification}`);
    appendLine(scoreCard, "Base: 100");
    Object.entries(report.penaltyBreakdown).forEach(([key, value]) => {
      appendLine(scoreCard, `− ${PENALTY_LABELS[key] || key}: −${formatPenalty(value)}`);
    });

    sections.replaceChildren(
      thirdPartyCard,
      loadCookiesCard,
      currentCookiesCard,
      storageCard,
      syncCard,
      canvasCard,
      hijackCard,
      scoreCard
    );
  } catch (error) {
    domainElement.textContent = "Não foi possível consultar o relatório. Recarregue a extensão e a página.";
    badge.textContent = "!";
    sections.replaceChildren();
  }
}

function normalizeDomainInput(value) {
  let candidate = String(value || "").trim().toLowerCase().replace(/^\*\./, "");
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    candidate = parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, "");
  } catch (error) {
    return "";
  }
  return candidate;
}

function setBlocklistStatus(message, isError) {
  const status = document.getElementById("blocklist-status");
  status.textContent = message;
  status.className = isError ? "blocklist-status error" : "blocklist-status";
}

async function loadBlocklist() {
  const list = await browser.runtime.sendMessage({ type: "GET_BLOCKLIST" });
  const domains = Array.isArray(list) ? list : [];
  const listElement = document.getElementById("blocklist-items");
  listElement.replaceChildren();
  domains.forEach(domain => {
    const item = document.createElement("li");
    item.appendChild(element("span", "", domain));
    const button = element("button", "", "remover");
    button.type = "button";
    button.dataset.domain = domain;
    item.appendChild(button);
    listElement.appendChild(item);

    button.addEventListener("click", async () => {
      const domain = button.getAttribute("data-domain");
      const stored = (await browser.storage.local.get("blocklist")).blocklist || [];
      await browser.storage.local.set({ blocklist: stored.filter(item => item !== domain) });
      setBlocklistStatus(`${domain} removido.`, false);
      await loadBlocklist();
    });
  });
}

async function addBlocklistDomain() {
  const input = document.getElementById("blocklist-input");
  const domain = normalizeDomainInput(input.value);
  if (!domain) {
    setBlocklistStatus("Informe um domínio válido, como doubleclick.net.", true);
    return;
  }

  const stored = (await browser.storage.local.get("blocklist")).blocklist || [];
  const normalized = stored.map(normalizeDomainInput).filter(Boolean);
  if (!normalized.includes(domain)) normalized.push(domain);
  await browser.storage.local.set({ blocklist: normalized.sort() });
  input.value = "";
  setBlocklistStatus(`${domain} será bloqueado nas próximas requisições.`, false);
  await loadBlocklist();
}

document.getElementById("blocklist-add-btn").addEventListener("click", addBlocklistDomain);
document.getElementById("blocklist-input").addEventListener("keydown", event => {
  if (event.key === "Enter") addBlocklistDomain();
});

loadReport();
loadBlocklist().catch(() => setBlocklistStatus("Não foi possível carregar a lista.", true));
