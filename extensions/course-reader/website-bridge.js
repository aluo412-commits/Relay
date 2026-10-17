// Status-only bridge. The website cannot request permissions, start a read,
// pair accounts, or retrieve cached text through this listener.
(() => {
  if (location.origin !== "https://relay.aaronluo.com" || window !== window.top || globalThis.__relayStatusBridge) return;
  globalThis.__relayStatusBridge = true;
  let busy = false;
  window.addEventListener("message", async event => {
    const m = event.data;
    if (busy || event.source !== window || event.origin !== location.origin || m?.type !== "relay.reader.status.request" || typeof m.id !== "string" || !/^[\w-]{1,80}$/.test(m.id) || typeof m.binding !== "string" || !/^[a-f0-9]{64}$/.test(m.binding)) return;
    busy = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "website-status", binding: m.binding });
      window.postMessage({ type: "relay.reader.status.response", id: m.id, binding: m.binding, result }, location.origin);
    } catch { /* Reload the Relay tab after installing/updating the extension. */ }
    finally { busy = false; }
  });
})();
