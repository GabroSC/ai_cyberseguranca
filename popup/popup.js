async function getActiveTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function scoreClass(score) {
  if (score >= 80) return "low";
  if (score >= 50) return "mid";
  return "high";
}

function renderList(items, emptyText) {
  if (!items || items.length === 0) return `<span class="muted">${emptyText}</span>`;
  return `<ul>${items.slice(0, 15).map(i => `<li>${escapeHtml(String(i))}</li>`).join("")}</ul>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadReport() {
  const tabId = await getActiveTabId();
  if (tabId === null) return;
  const report = await browser.runtime.sendMessage({ type: "GET_REPORT", tabId: tabId });

  const badge = document.getElementById("score-badge");
  const domainEl = document.getElementById("page-domain");
  const sections = document.getElementById("sections");

  if (!report) {
    domainEl.textContent = "Sem dados ainda — recarregue a página.";
    badge.textContent = "--";
    sections.innerHTML = "";
    return;
  }

  domainEl.textContent = report.pageDomain || report.pageUrl;
  badge.textContent = report.score;
  badge.className = "score-badge " + scoreClass(report.score);
  badge.title = report.classification;

  const cookiesThirdCount = report.cookies.thirdParty.session.length + report.cookies.thirdParty.persistent.length;
  const cookiesFirstCount = report.cookies.firstParty.session.length + report.cookies.firstParty.persistent.length;

  sections.innerHTML = `
    <div class="card">
      <h3>Domínios de terceiros conectados (${report.thirdPartyDomains.length})</h3>
      ${renderList(report.thirdPartyDomains, "nenhum detectado")}
    </div>

    <div class="card">
      <h3>Cookies</h3>
      <div>1ª parte: ${cookiesFirstCount} (sessão: ${report.cookies.firstParty.session.length}, persistentes: ${report.cookies.firstParty.persistent.length})</div>
      <div>3ª parte: ${cookiesThirdCount} (sessão: ${report.cookies.thirdParty.session.length}, persistentes: ${report.cookies.thirdParty.persistent.length})</div>
    </div>

    <div class="card">
      <h3>Armazenamento local (HTML5)</h3>
      <div>localStorage: ${report.storageInfo.localStorage} chave(s)</div>
      <div>sessionStorage: ${report.storageInfo.sessionStorage} chave(s)</div>
      <div>IndexedDB: ${report.storageInfo.indexedDB.length} banco(s)${report.storageInfo.indexedDB.length ? " — " + report.storageInfo.indexedDB.join(", ") : ""}</div>
    </div>

    <div class="card">
      <h3>Cookie sync / bounce tracking</h3>
      <div>Candidatos a cookie sync: ${report.cookieSyncCandidates.length}</div>
      <div>Redirecionamentos cross-site: ${report.redirectChains.filter(r => r.crossSite).length}</div>
    </div>

    <div class="card">
      <h3>Canvas fingerprinting (${report.canvasFingerprint.length} chamada(s))</h3>
      ${renderList(report.canvasFingerprint.map(c => c.api), "nenhuma chamada suspeita")}
    </div>

    <div class="card">
      <h3>Indicadores de hijacking / hook (${report.hijackIndicators.length})</h3>
      ${renderList(report.hijackIndicators.map(h => h.detail), "nenhum indicador")}
    </div>

    <div class="card">
      <h3>Detalhamento da pontuação</h3>
      <div>Base: 100</div>
      ${Object.entries(report.penaltyBreakdown).map(([k, v]) => `<div>- ${k}: -${v}</div>`).join("")}
    </div>
  `;
}

async function loadBlocklist() {
  const list = await browser.runtime.sendMessage({ type: "GET_BLOCKLIST" });
  const ul = document.getElementById("blocklist-items");
  ul.innerHTML = (list || []).map(d => `
    <li><span>${escapeHtml(d)}</span><button data-domain="${escapeHtml(d)}">remover</button></li>
  `).join("");
  ul.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async () => {
      const domain = btn.getAttribute("data-domain");
      const current = (await browser.storage.local.get("blocklist")).blocklist || [];
      await browser.storage.local.set({ blocklist: current.filter(d => d !== domain) });
      loadBlocklist();
    });
  });
}

document.getElementById("blocklist-add-btn").addEventListener("click", async () => {
  const input = document.getElementById("blocklist-input");
  const domain = input.value.trim().toLowerCase();
  if (!domain) return;
  const current = (await browser.storage.local.get("blocklist")).blocklist || [];
  if (!current.includes(domain)) current.push(domain);
  await browser.storage.local.set({ blocklist: current });
  input.value = "";
  loadBlocklist();
});

loadReport();
loadBlocklist();
