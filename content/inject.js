(function () {
  "use strict";

  function emit(type, data) {
    window.dispatchEvent(new CustomEvent("privacyguard:event", {
      detail: Object.assign({ type }, data)
    }));
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
    try {
      const s = new Error().stack || "";
      return s.split("\n").slice(2, 4).join(" | ").substring(0, 300);
    } catch (e) { return ""; }
  }

  async function reportStorage() {
    let idbNames = [];
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        idbNames = dbs.map(d => d.name);
      }
    } catch (e) { /* API pode não existir */ }
    emit("STORAGE_INFO", {
      data: {
        localStorage: safeLen(() => localStorage.length),
        sessionStorage: safeLen(() => sessionStorage.length),
        indexedDB: idbNames
      }
    });
  }
  function safeLen(fn) { try { return fn(); } catch (e) { return 0; } }

  hookCanvas();
  window.addEventListener("load", reportStorage);
})();
