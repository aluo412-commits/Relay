import { readActivePage } from "./capture.js";
import { installScheduler, configureSync, forgetSync, syncNow, syncStatus } from "./sync.js";
import { pairedAccount, pairCurrentAccount, ownedGet, ownedSet, ownedRemove } from "./owned-storage.js";
installScheduler();
const PRODUCTION = "https://relay.aaronluo.com";
chrome.runtime.onInstalled.addListener(async () => {
  for (const tab of await chrome.tabs.query({ url: PRODUCTION + "/*" })) {
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["website-bridge.js"] }); } catch { /* Reload the website to detect this update. */ }
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(""))) {
      if (message.type !== "website-status" || sender.frameId !== 0 || !sender.url?.startsWith(PRODUCTION + "/")) throw new Error("This bridge only reports reader status.");
      const s = await syncStatus();
      if (!s.account || s.account.binding !== message.binding) throw new Error("Sign in and choose your school, then pair this account.");
      return { version: chrome.runtime.getManifest().version, paired: s.paired, enabled: s.settings.enabled, websiteReady: s.websiteReady === true, status: s.report?.status || null, read: s.report?.read || 0, message: s.report?.message || s.message || "No course check yet." };
    }
    if (message.type === "sync-status") return syncStatus();
    if (message.type === "sync-pair") { await pairCurrentAccount(message.binding); return syncStatus(); }
    const account = await pairedAccount();
    if (message.binding !== account.binding) throw new Error("Account changed. Reopen the extension before continuing.");
    if (message.type === "sync-enable") return configureSync(true, message.google === true);
    if (message.type === "sync-pause") return configureSync(false);
    if (message.type === "sync-forget") return forgetSync();
    if (message.type === "sync-now") return syncNow();
    const manual = async () => { const data = await ownedGet("manualPages"); if (data.__binding !== account.binding) throw new Error("Account changed; result discarded."); return data.manualPages || []; };
    if (message.type === "manual-pages") return { pages: await manual() };
    if (message.type === "read") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const origin = (() => { try { return new URL(tab?.url).origin; } catch { return ""; } })();
      if (!tab?.id || ![account.district.schoology, "https://docs.google.com"].includes(origin)) throw new Error("Open Schoology in your selected district, or your course Google Doc/Slides.");
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readActivePage, args: [account.district.schoology] });
      const page = results[0]?.result;
      if (page?.error) throw new Error(page.error);
      if (!page?.text) throw new Error("The page could not be read.");
      const pages = (await manual()).filter(p => p.url !== page.url);
      if (pages.length >= 8) throw new Error("The manual reader holds 8 pages. Send or clear them first.");
      pages.push(page); await ownedSet({ manualPages: pages }, account.binding); return { pages };
    }
    if (message.type === "clear") { await ownedRemove("manualPages", account.binding); return { pages: [] }; }
    if (message.type === "remove") {
      const pages = (await manual()).filter(p => p.id !== message.id);
      await ownedSet({ manualPages: pages }, account.binding); return { pages };
    }
    if (message.type === "send") {
      const pages = (await manual()).filter(p => Array.isArray(message.ids) && message.ids.includes(p.id));
      if (!pages.length) throw new Error("Choose a captured page first.");
      const tabs = await chrome.tabs.query({ url: PRODUCTION + "/*" });
      const existing = tabs.find(t => { try { return new URL(t.url).pathname === "/"; } catch { return false; } });
      const tab = existing ? await chrome.tabs.update(existing.id, { active: true }) : await chrome.tabs.create({ url: PRODUCTION + "/?reader=import" });
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      const id = crypto.randomUUID(), payload = { version: 1, pages };
      for (let i = 0; i < 25; i++) {
        let ready = false;
        try { const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [account.binding], func: binding => document.documentElement.dataset.relayReaderReady === "1" && JSON.parse(document.documentElement.dataset.relayReaderAccount || "null")?.binding === binding }); ready = result[0]?.result === true; } catch { /* Navigating. */ }
        if (ready) {
          if ((await pairedAccount()).binding !== account.binding) throw new Error("Account changed; import canceled.");
          const sent = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [payload, id, account.scope, account.binding], func: (payload, id, scope, binding) => {
            if (location.origin !== "https://relay.aaronluo.com" || JSON.parse(document.documentElement.dataset.relayReaderAccount || "null")?.binding !== binding) return false;
            return new Promise(resolve => {
              const timer = setTimeout(() => { window.removeEventListener("message", ack); resolve(false); }, 8000);
              function ack(e) { if (e.source === window && e.origin === location.origin && e.data?.type === "relay.reader.received" && e.data.id === id) { clearTimeout(timer); window.removeEventListener("message", ack); resolve(true); } }
              window.addEventListener("message", ack); window.postMessage({ type: "relay.reader.capture", id, payload, scope, binding }, location.origin);
            });
          } });
          if (!sent[0]?.result) throw new Error("Import not acknowledged. Check the account and any open preview.");
          return { sent: true };
        }
        await new Promise(r => setTimeout(r, 400));
      }
      throw new Error("Open Relay in the paired account and district, then send again.");
    }
    throw new Error("Unknown action.");
  })().then(result => respond({ ok: true, ...result })).catch(error => respond({ ok: false, error: error.message || "Reader failed." }));
  return true;
});
