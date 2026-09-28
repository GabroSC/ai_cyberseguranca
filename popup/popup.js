async function getActiveTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}
function renderList(items, emptyText) {
  if (!items || items.length === 0) return `<span class="muted">${emptyText}</span>`;
  return `<ul>${items.map(i => `<li>${escapeHtml(String(i))}</li>`).join("")}</ul>`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadReport() {
  const tabId = await getActiveTabId();
  if (tabId === null) return;
  const report = await browser.runtime.sendMessage({ type: "GET_REPORT", tabId: tabId });
  const domainEl = document.getElementById("page-domain");
  const sections = document.getElementById("sections");
  if (!report) { domainEl.textContent = "Sem dados ainda — recarregue a página."; return; }
  domainEl.textContent = report.pageDomain || report.pageUrl;

  const cookiesThirdCount = report.cookies.thirdParty.session.length + report.cookies.thirdParty.persistent.length;
  const cookiesFirstCount = report.cookies.firstParty.session.length + report.cookies.firstParty.persistent.length;

  sections.innerHTML = `
    <div class="card"><h3>Domínios de terceiros conectados (${report.thirdPartyDomains.length})</h3>${renderList(report.thirdPartyDomains, "nenhum detectado")}</div>
    <div class="card"><h3>Cookies</h3>
      <div>1a parte: ${cookiesFirstCount} (sessão: ${report.cookies.firstParty.session.length}, persistentes: ${report.cookies.firstParty.persistent.length})</div>
      <div>3a parte: ${cookiesThirdCount} (sessão: ${report.cookies.thirdParty.session.length}, persistentes: ${report.cookies.thirdParty.persistent.length})</div>
    </div>
    <div class="card"><h3>Armazenamento local (HTML5)</h3>
      <div>localStorage: ${report.storageInfo.localStorage} chave(s)</div>
      <div>sessionStorage: ${report.storageInfo.sessionStorage} chave(s)</div>
      <div>IndexedDB: ${report.storageInfo.indexedDB.length} banco(s)</div>
    </div>
    <div class="card"><h3>Cookie sync / bounce tracking</h3>
      <div>Candidatos a cookie sync: ${report.cookieSyncCandidates.length}</div>
      <div>Redirecionamentos cross-site: ${report.redirectChains.filter(r => r.crossSite).length}</div>
    </div>
    <div class="card"><h3>Canvas fingerprinting (${report.canvasFingerprint.length} chamada(s))</h3>
      ${renderList(report.canvasFingerprint.map(c => c.api), "nenhuma chamada suspeita")}
    </div>
  `;
}
loadReport();
