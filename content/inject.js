(function () {
  "use strict";

  function emit(type, data) {
    window.dispatchEvent(new CustomEvent("privacyguard:event", {
      detail: Object.assign({ type }, data)
    }));
  }

  async function reportStorage() {
    let idbNames = [];
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        idbNames = dbs.map(d => d.name);
      }
    } catch (e) { /* API pode não existir em todos os contextos */ }

    emit("STORAGE_INFO", {
      data: {
        localStorage: safeLen(() => localStorage.length),
        sessionStorage: safeLen(() => sessionStorage.length),
        indexedDB: idbNames
      }
    });
  }
  function safeLen(fn) { try { return fn(); } catch (e) { return 0; } }

  window.addEventListener("load", reportStorage);
})();