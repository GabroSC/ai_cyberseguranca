(function () {
  "use strict";

  function emit(type, data) {
    window.dispatchEvent(new CustomEvent("privacyguard:event", { detail: Object.assign({ type }, data) }));
  }

  function hookCanvas() {
    const proto = HTMLCanvasElement.prototype;
    const ctxProto = CanvasRenderingContext2D.prototype;
    const origToDataURL = proto.toDataURL;
    proto.toDataURL = function (...args) {
      emit("CANVAS_FINGERPRINT", { api: "HTMLCanvasElement.toDataURL", stackHint: shortStack() });
      return origToDataURL.apply(this, args);
    };
    const origGetImageData = ctxProto.getImageData;
    ctxProto.getImageData = function (...args) {
      emit("CANVAS_FINGERPRINT", { api: "CanvasRenderingContext2D.getImageData", stackHint: shortStack() });
      return origGetImageData.apply(this, args);
    };
  }
  function shortStack() {
    try { return (new Error().stack || "").split("\n").slice(2, 4).join(" | ").substring(0, 300); }
    catch (e) { return ""; }
  }

  async function reportStorage() {
    let idbNames = [];
    try { if (indexedDB.databases) idbNames = (await indexedDB.databases()).map(d => d.name); } catch (e) {}
    emit("STORAGE_INFO", { data: { localStorage: safeLen(() => localStorage.length), sessionStorage: safeLen(() => sessionStorage.length), indexedDB: idbNames } });
  }
  function safeLen(fn) { try { return fn(); } catch (e) { return 0; } }

  function hookWebSocket() {
    const OrigWS = window.WebSocket;
    if (!OrigWS) return;
    const pageHost = window.location.hostname;
    function PatchedWS(url, protocols) {
      try {
        const wsHost = new URL(url, window.location.href).hostname;
        if (wsHost && wsHost !== pageHost) emit("WEBSOCKET_THIRD_PARTY", { domain: wsHost, url });
      } catch (e) {}
      return protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    }
    PatchedWS.prototype = OrigWS.prototype;
    window.WebSocket = PatchedWS;
  }

  function snapshotGlobals() {
    emit("GLOBALS_REPORT", { globals: Object.getOwnPropertyNames(window).sort() });
  }

  hookCanvas();
  hookWebSocket();
  snapshotGlobals();

  window.addEventListener("load", () => {
    reportStorage();
    setTimeout(snapshotGlobals, 1500);
  });
})();
