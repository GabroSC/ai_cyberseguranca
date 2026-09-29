(function () {
  "use strict";

  const WRAPPED = Symbol("privacyGuardWrapped");

  function emit(type, data) {
    try {
      const detail = JSON.stringify(Object.assign({ type }, data));
      window.dispatchEvent(new CustomEvent("privacyguard:event", { detail }));
    } catch (e) {
      // A instrumentação nunca deve interromper o JavaScript da página.
    }
  }

  function shortStack() {
    try {
      return (new Error().stack || "")
        .split("\n")
        .slice(2, 5)
        .join(" | ")
        .substring(0, 400);
    } catch (e) {
      return "";
    }
  }

  function wrapReadout(proto, methodName, apiName) {
    if (!proto) return;
    const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
    const original = descriptor && descriptor.value;
    if (typeof original !== "function" || original[WRAPPED]) return;

    function wrapped(...args) {
      emit("CANVAS_FINGERPRINT", { api: apiName, stackHint: shortStack() });
      return Reflect.apply(original, this, args);
    }
    Object.defineProperty(wrapped, WRAPPED, { value: true });
    Object.defineProperty(proto, methodName, Object.assign({}, descriptor, { value: wrapped }));
  }

  function hookCanvas() {
    wrapReadout(window.HTMLCanvasElement && HTMLCanvasElement.prototype,
      "toDataURL", "HTMLCanvasElement.toDataURL");
    wrapReadout(window.HTMLCanvasElement && HTMLCanvasElement.prototype,
      "toBlob", "HTMLCanvasElement.toBlob");
    wrapReadout(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype,
      "getImageData", "CanvasRenderingContext2D.getImageData");
    wrapReadout(window.WebGLRenderingContext && WebGLRenderingContext.prototype,
      "readPixels", "WebGLRenderingContext.readPixels");
    wrapReadout(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype,
      "readPixels", "WebGL2RenderingContext.readPixels");
  }

  function hookCookieWrites() {
    const proto = window.Document && Document.prototype;
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "cookie");
    if (!descriptor || typeof descriptor.get !== "function" ||
        typeof descriptor.set !== "function" || descriptor.set[WRAPPED]) return;

    const originalSet = descriptor.set;
    function cookieSetter(value) {
      const raw = String(value).substring(0, 4096);
      emit("COOKIE_WRITE", { raw });
      return Reflect.apply(originalSet, this, [value]);
    }
    Object.defineProperty(cookieSetter, WRAPPED, { value: true });
    Object.defineProperty(proto, "cookie", Object.assign({}, descriptor, { set: cookieSetter }));
  }

  async function reportStorage() {
    let idbNames = [];
    try {
      if (typeof indexedDB.databases === "function") {
        idbNames = (await indexedDB.databases())
          .map(database => database && database.name)
          .filter(name => typeof name === "string");
      }
    } catch (e) {}

    emit("STORAGE_INFO", {
      data: {
        localStorage: safeLength(() => localStorage.length),
        sessionStorage: safeLength(() => sessionStorage.length),
        indexedDB: idbNames
      }
    });
  }

  function safeLength(readLength) {
    try { return readLength(); } catch (e) { return 0; }
  }

  function hookWebSocket() {
    const OriginalWebSocket = window.WebSocket;
    if (typeof OriginalWebSocket !== "function" || OriginalWebSocket[WRAPPED]) return;

    const PatchedWebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        const url = String(args[0] || "").substring(0, 2048);
        let persistenceTimer = null;

        socket.addEventListener("open", () => {
          persistenceTimer = window.setTimeout(() => {
            if (socket.readyState === OriginalWebSocket.OPEN) {
              emit("WEBSOCKET_PERSISTENT", { url });
            }
          }, 10000);
        }, { once: true });

        const clearTimer = () => {
          if (persistenceTimer !== null) window.clearTimeout(persistenceTimer);
        };
        socket.addEventListener("close", clearTimer, { once: true });
        socket.addEventListener("error", clearTimer, { once: true });
        return socket;
      }
    });

    Object.defineProperty(PatchedWebSocket, WRAPPED, { value: true });
    window.WebSocket = PatchedWebSocket;
  }

  function snapshotGlobals() {
    emit("GLOBALS_REPORT", {
      globals: Object.getOwnPropertyNames(window).sort().slice(0, 4000)
    });
  }

  const safeHook = hook => {
    try { hook(); } catch (e) {}
  };

  safeHook(hookCanvas);
  safeHook(hookCookieWrites);
  safeHook(hookWebSocket);
  snapshotGlobals();

  window.addEventListener("load", () => {
    reportStorage();
    window.setTimeout(() => {
      reportStorage();
      snapshotGlobals();
    }, 1500);
  }, { once: true });
})();
