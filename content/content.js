(function () {
  const ALLOWED_TYPES = new Set([
    "CANVAS_FINGERPRINT",
    "COOKIE_WRITE",
    "GLOBALS_REPORT",
    "STORAGE_INFO",
    "WEBSOCKET_PERSISTENT"
  ]);

  window.addEventListener("privacyguard:event", (ev) => {
    try {
      // Firefox bloqueia objetos de outro realm em CustomEvent.detail.
      // O script da página envia JSON, que é uma string primitiva segura.
      if (typeof ev.detail !== "string" || ev.detail.length > 100000) return;
      const detail = JSON.parse(ev.detail);
      if (!detail || !ALLOWED_TYPES.has(detail.type)) return;
      browser.runtime.sendMessage(detail).catch(() => {
        // A extensão pode ter sido recarregada durante a navegação.
      });
    } catch (e) {
      // Mensagem inválida ou contexto da extensão recarregado.
    }
  }, false);
})();
