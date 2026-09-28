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
  if (!report) {
    domainEl.textContent = "Sem dados ainda — recarregue a página.";
    return;
  }
  domainEl.textContent = report.pageDomain || report.pageUrl;
  sections.innerHTML = `
    <div class="card">
      <h3>Domínios de terceiros conectados (${report.thirdPartyDomains.length})</h3>
      ${renderList(report.thirdPartyDomains, "nenhum detectado")}
    </div>
    <div class="card">
      <h3>Cookies injetados no carregamento</h3>
      <div>${report.cookiesInjectedCount} cookie(s) (Set-Cookie observados)</div>
    </div>
    <div class="card">
      <h3>Armazenamento local (HTML5)</h3>
      <div>localStorage: ${report.storageInfo.localStorage} chave(s)</div>
      <div>sessionStorage: ${report.storageInfo.sessionStorage} chave(s)</div>
      <div>IndexedDB: ${report.storageInfo.indexedDB.length} banco(s)${report.storageInfo.indexedDB.length ? " — " + report.storageInfo.indexedDB.join(", ") : ""}</div>
    </div>
  `;
}
loadReport();
