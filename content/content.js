(function () {
  const script = document.createElement("script");
  script.src = browser.runtime.getURL("content_scripts/inject.js");
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener("privacyguard:event", (ev) => {
    const detail = ev.detail;
    if (!detail || !detail.type) return;
    try {
      browser.runtime.sendMessage(detail);
    } catch (e) {
      // contexto pode ter sido invalidado (extensão recarregada) — ignora
    }
  }, false);
})();