const $ = id => document.getElementById(id);
let pages = [];
let busy = false;
function status(text, error = false) { $("status").textContent = text; $("status").className = error ? "error" : ""; }
function syncButtons() { $("read").disabled = busy; $("send").disabled = busy || !document.querySelector(".page input:checked"); $("clear").disabled = busy || !pages.length; }
async function action(message) {
  busy = true; syncButtons();
  try { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || "The extension did not respond."); if (result.pages) { pages = result.pages; render(); } return result; }
  catch (e) { status(e.message, true); return null; }
  finally { busy = false; syncButtons(); }
}
function node(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
function render() {
  $("count").textContent = `${pages.length} / 8`;
  $("empty").hidden = pages.length > 0;
  $("pages").replaceChildren();
  for (const page of pages) {
    const card = node("article", "", "page"); const header = node("header"); const label = node("label"); const check = node("input"); check.type = "checkbox"; check.checked = true; check.value = page.id; check.addEventListener("change", syncButtons); label.append(check, document.createTextNode(page.title));
    const remove = node("button", "×", "remove"); remove.setAttribute("aria-label", `Remove ${page.title}`); remove.addEventListener("click", () => action({ type: "remove", id: page.id })); header.append(label, remove); card.append(header);
    const source = node("a", new URL(page.url).hostname + new URL(page.url).pathname); source.href = page.url; source.target = "_blank"; source.rel = "noopener noreferrer"; card.append(source);
    const preview = node("details"); preview.append(node("summary", `Preview ${page.text.length.toLocaleString()} characters`), node("pre", page.text)); card.append(preview);
    for (const warning of page.warnings) card.append(node("p", warning, "warning"));
    if (page.links.length) {
      const links = node("details", "", "links"); links.append(node("summary", `${page.links.length} linked pages — not yet read`));
      for (const link of page.links) { const a = node("a", link.title + " ↗"); a.href = link.url; a.target = "_blank"; a.rel = "noopener noreferrer"; links.append(a); } card.append(links);
    }
    $("pages").append(card);
  }
  syncButtons();
}
$("read").addEventListener("click", async () => { status("Reading this page on your device…"); const result = await action({ type: "read" }); if (result) status("Captured locally. Review the text and choose what to send."); });
$("clear").addEventListener("click", async () => { if (await action({ type: "clear" })) status("Captured pages cleared from the extension."); });
$("send").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".page input:checked")].map(i => i.value);
  status("Opening a review in Relay…");
  if (await action({ type: "send", ids, development: $("development").checked })) status("Sent for review. Nothing is saved in Relay until you confirm the import. Clear this reader when you’re done.");
});
$("development").addEventListener("change", async e => {
  if (e.target.checked && !await chrome.permissions.request({ origins: ["http://localhost:3002/*"] })) { e.target.checked = false; status("Localhost permission was not granted.", true); }
});
let enabled = false;
function renderSync(result) {
  if (!result?.ok) return;
  enabled = result.settings.enabled;
  $("sync-state").textContent = enabled ? "On" : "Off";
  $("enable-sync").disabled = enabled || !$("daily-consent").checked;
  $("pause-sync").disabled = !enabled;
  $("sync-now").disabled = !enabled || result.report?.status === "running";
  $("google-consent").disabled = enabled;
  $("daily-consent").disabled = enabled;
  if (enabled) { $("daily-consent").checked = true; $("google-consent").checked = result.settings.google; }
  const r = result.report;
  $("sync-summary").textContent = r ? `${r.status} · ${r.courses.length} courses · ${r.read} text snapshots · ${r.changed} new/changed · ${r.queued} queued. ${r.message}` : "No daily sweep yet.";
  $("sync-report").replaceChildren();
  if (r) {
    $("sync-report").append(node("p", `Started ${new Date(r.startedAt).toLocaleString()}. ${r.unreadCount} unread notices. ${r.limited ? "Safety limit reached; coverage is incomplete." : "Only discovered text pages are checked, not every file."}`));
    for (const c of r.courses) $("sync-report").append(node("p", c.title));
    for (const x of r.unread) $("sync-report").append(node("p", `${x.title}: ${x.reason}`));
  }
}
$("daily-consent").addEventListener("change", () => { $("enable-sync").disabled = enabled || !$("daily-consent").checked; });
$("enable-sync").addEventListener("click", async () => {
  if (!$("daily-consent").checked) return;
  const origins = ["https://fuhsd.schoology.com/*"];
  if ($("google-consent").checked) origins.push("https://docs.google.com/*");
  try {
    if (!await chrome.permissions.request({ origins })) { status("Daily reading is off because access was not granted.", true); return; }
    const result = await action({ type: "sync-enable", google: $("google-consent").checked });
    renderSync(result); if (result) status("Daily reading enabled. In Relay Connections, turn on automatic local imports. AI uploads remain a separate permission.");
  } catch (e) { status(e.message, true); }
});
$("pause-sync").addEventListener("click", async () => { renderSync(await action({ type: "sync-pause" })); status("Daily reads paused. Saved excerpts remain available. Disable automatic AI separately in Relay if desired."); });
$("sync-now").addEventListener("click", async () => { renderSync(await action({ type: "sync-now" })); });
$("forget-sync").addEventListener("click", async () => {
  if (!confirm("Delete the extension’s daily snapshots and revoke its automatic school/document access? Saved copies in Relay must be cleared separately.")) return;
  const result = await action({ type: "sync-forget" });
  if (result) { await chrome.permissions.remove({ origins: ["https://fuhsd.schoology.com/*", "https://docs.google.com/*"] }); renderSync(result); status("Extension sync data removed. Clear reader data in Relay separately."); }
});
const saved = await chrome.storage.session.get("pages"); pages = saved.pages || []; render();
renderSync(await chrome.runtime.sendMessage({ type: "sync-status" }));
setInterval(async () => { try { renderSync(await chrome.runtime.sendMessage({ type: "sync-status" })); } catch { /* Popup closing. */ } }, 2000);
