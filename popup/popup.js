async function getActiveTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

async function loadReport() {
  const tabId = await getActiveTabId();
  if (tabId === null) return;
  const report = await browser.runtime.sendMessage({ type: "GET_REPORT", tabId: tabId });
  const domainEl = document.getElementById("page-domain");
  const statusEl = document.getElementById("status");
  if (!report) {
    domainEl.textContent = "Sem dados ainda — recarregue a página.";
    return;
  }
  domainEl.textContent = report.pageDomain || report.pageUrl;
  statusEl.textContent = report.status || "";
}

loadReport();
