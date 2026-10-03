import { readActivePage } from "./capture.js";
const PRODUCTION = "https://relay.aaronluo.com";
const DEVELOPMENT = "http://localhost:3002";

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    if (message.type === "read") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/(fuhsd\.schoology\.com|docs\.google\.com)\//.test(tab.url || "")) throw new Error("Open your signed-in Schoology page or a course Google Doc/Slides, then click the extension again.");
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readActivePage });
      const page = results[0]?.result;
      if (page?.error) throw new Error(page.error);
      if (!page?.text) throw new Error("The page could not be read. Reload it and try again.");
      const saved = await chrome.storage.session.get("pages");
      const pages = (saved.pages || []).filter(p => p.url !== page.url);
      if (pages.length >= 8) throw new Error("The reader holds up to 8 pages. Send or clear the current selection first.");
      pages.push(page);
      await chrome.storage.session.set({ pages });
      return { pages };
    }
    if (message.type === "clear") { await chrome.storage.session.remove("pages"); return { pages: [] }; }
    if (message.type === "remove") {
      const saved = await chrome.storage.session.get("pages");
      const pages = (saved.pages || []).filter(p => p.id !== message.id);
      await chrome.storage.session.set({ pages }); return { pages };
    }
    if (message.type === "send") {
      const saved = await chrome.storage.session.get("pages");
      const pages = (saved.pages || []).filter(p => Array.isArray(message.ids) && message.ids.includes(p.id));
      if (!pages.length) throw new Error("Select at least one page to review in Relay.");
      const origin = message.development === true ? DEVELOPMENT : PRODUCTION;
      if (origin === DEVELOPMENT && !await chrome.permissions.contains({ origins: [DEVELOPMENT + "/*"] })) throw new Error("Enable localhost permission in the extension’s developer options first.");
      const tabs = await chrome.tabs.query({ url: origin + "/*" });
      const existing = tabs.find(t => { try { return new URL(t.url).pathname === "/"; } catch { return false; } });
      const tab = existing ? await chrome.tabs.update(existing.id, { active: true }) : await chrome.tabs.create({ url: origin + "/?reader=import" });
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      const payload = { version: 1, pages };
      const id = crypto.randomUUID();
      for (let i = 0; i < 25; i++) {
        let ready = false;
        try {
          const state = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.dataset.relayReaderReady === "1" });
          ready = state[0]?.result === true;
        } catch { /* The tab may still be navigating. Retry only readiness, not delivery. */ }
        if (ready) {
            const sent = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [payload, id, origin], func: (data, requestId, expectedOrigin) => {
              if (location.origin !== expectedOrigin) return false;
              return new Promise(resolve => {
                const timer = setTimeout(() => { window.removeEventListener("message", ack); resolve(false); }, 8000);
                function ack(e) { if (e.source === window && e.origin === expectedOrigin && e.data?.type === "relay.reader.received" && e.data.id === requestId) { clearTimeout(timer); window.removeEventListener("message", ack); resolve(true); } }
                window.addEventListener("message", ack);
                window.postMessage({ type: "relay.reader.capture", id: requestId, payload: data }, expectedOrigin);
              });
            } });
            if (!sent[0]?.result) throw new Error("Relay did not acknowledge the preview. Finish or dismiss any open import, then try again.");
            return { sent: true };
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      throw new Error("Relay’s reader is not ready. Reload your Relay dashboard tab, then send again.");
    }
    throw new Error("Unknown reader action.");
  })().then(result => respond({ ok: true, ...result })).catch(error => respond({ ok: false, error: error.message || "The reader could not finish." }));
  return true;
});
