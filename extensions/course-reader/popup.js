import { districtById, DISTRICTS } from "./districts.js";
let account = null, paired = false;
const $ = id => document.getElementById(id);
let pages = [];
let busy = false;
function status(text, error = false) { $("status").textContent = text; $("status").className = error ? "error" : ""; }
function syncButtons() { $("read").disabled = busy || !paired; $("send").disabled = busy || !document.querySelector(".page input:checked"); $("clear").disabled = busy || !pages.length; if ($('save-source')) $('save-source').disabled = busy || !paired || enabled || !$('source-course').value || !$('source-url').value.trim(); if (busy) { $('sync-now').disabled = true; $('enable-sync').disabled = true; } }
async function action(message) {
  busy = true; syncButtons();
  try { const result = await chrome.runtime.sendMessage({ ...message, binding: account?.binding }); if (!result?.ok) throw new Error(result?.error || "The extension did not respond."); if (result.pages) { const check = await chrome.runtime.sendMessage({ type: "sync-status" }); if (!check.paired || check.account?.binding !== account?.binding) { renderSync(check); throw new Error("Account changed; old data discarded."); } pages = result.pages; render(); } return result; }
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
  if (await action({ type: "send", ids })) status("Sent for review. Nothing is saved in Relay until you confirm the import. Clear this reader when you’re done.");
});
$("pair-account").addEventListener("click", async () => {
  if (!account || !confirm(`Pair with ${account.email} (${account.districtId})? Confirm that the current Schoology login belongs to you. This replaces the extension cache, not the account libraries in Relay.`)) return;
  renderSync(await action({ type: "sync-pair" }));
});
let enabled = false, websiteIsReady = false;
function renderHomeworkSources(result) {
  const choice = $('source-course').value;
  $('source-course').replaceChildren();
  const first = node('option', result?.report?.courses?.length ? 'Choose your course' : 'Run a course check first'); first.value = ''; $('source-course').append(first);
  for (const c of result?.report?.courses || []) { const option = node('option', c.title); option.value = c.id; $('source-course').append(option); }
  $('source-course').value = choice;
  $('source-course').disabled = !paired || enabled;
  $('source-url').disabled = !paired || enabled;
  $('save-source').disabled = !paired || enabled || !$('source-course').value || !$('source-url').value.trim();
  $('saved-sources').replaceChildren();
  for (const p of result?.homeworkSources || []) {
    const row = node('div'); row.append(node('p', `${p.title}: ${p.url}`));
    const remove = node('button', 'Remove selected source'); remove.disabled = !paired || enabled;
    remove.addEventListener('click', async () => { const saved = await action({ type: 'homework-source', course: p.course, url: null }); if (saved) { renderSync(saved); status('Selected source removed. Earlier snapshots and AI permission are unchanged.'); } });
    row.append(remove); $('saved-sources').append(row);
  }
}
$('source-course').addEventListener('change', () => { $('save-source').disabled = !paired || enabled || !$('source-course').value || !$('source-url').value.trim(); });
$('source-url').addEventListener('input', () => { $('save-source').disabled = !paired || enabled || !$('source-course').value || !$('source-url').value.trim(); });
$('save-source').addEventListener('click', async () => {
  const saved = await action({ type: 'homework-source', course: $('source-course').value, url: $('source-url').value.trim() });
  if (saved) { $('source-url').value = ''; renderSync(saved); status('Source saved for this course. Enable PDF reading and resume the next sweep. No AI permission changed.'); }
});
function renderSync(result) {
  if (!result?.ok) { account = null; paired = false; enabled = false; websiteIsReady = false; renderHomeworkSources(null); $("pause-sync").disabled = true; $("sync-now").disabled = true; $("school-portal").hidden = true; pages = []; render(); $("sync-report").replaceChildren(); $("account-label").textContent = "Account unavailable. Open Relay and sign in."; $("sync-summary").textContent = "No verified account."; $("enable-sync").disabled = true; $("pair-account").disabled = true; return; }
  const changed = account?.binding !== result.account?.binding;
  account = result.account; paired = result.paired === true;
  $("account-label").textContent = account ? `${account.email} · ${districtById(account.districtId)?.short} · ${paired ? "Paired" : "Pairing needed"}` : (result.message || "Open Relay and choose your school first.");
  $("pair-account").disabled = !account;
  if (!paired || changed) { pages = []; $('source-url').value = ''; render(); }
  enabled = result.settings.enabled;
  websiteIsReady = result.websiteReady === true;
  $("website-ready").textContent = websiteIsReady ? "Website ready to receive your course checks. AI permission remains a separate choice in Relay." : enabled ? "Website not open/ready. Reading can continue locally; open Relay and enable imports to receive results. AI only runs on the visible dashboard." : "Before enabling reading: open guided setup in Relay and turn on Automatically import daily snapshots in this account.";
  const district = districtById(account?.districtId);
  $("school-portal").hidden = !district;
  if (district) { $("school-portal").href = district.schoology; $("school-portal").textContent = `Open ${district.short} Schoology →`; }
  $("sync-state").textContent = enabled ? "On" : "Off";
  $("enable-sync").disabled = !paired || !websiteIsReady || enabled || !$("daily-consent").checked;
  $("pause-sync").disabled = !enabled;
  $("sync-now").disabled = !enabled || result.report?.status === "running";
  $("google-consent").disabled = enabled;
  $("pdf-consent").disabled = enabled;
  $("daily-consent").disabled = enabled;
  if (enabled) { $("daily-consent").checked = true; $("google-consent").checked = result.settings.google; $("pdf-consent").checked = result.settings.pdf === true; }
  renderHomeworkSources(paired ? result : null);
  const r = result.report;
  $("sync-summary").textContent = r ? `${r.status} · ${r.courses.length} courses · ${r.read} text snapshots · ${r.changed} new/changed · ${r.queued} queued. ${r.message}` : result.message || "No daily sweep yet.";
  $("sync-report").replaceChildren();
  if (r) {
    $("sync-report").append(node("p", `Started ${new Date(r.startedAt).toLocaleString()}. ${r.unreadCount} unread notices. ${r.limited ? "Safety limit reached; coverage is incomplete." : "Only discovered text pages are checked, not every file."}`));
    for (const c of r.courses) $("sync-report").append(node("p", c.title));
    for (const x of r.unread) $("sync-report").append(node("p", `${x.title}: ${x.reason}`));
  }
  syncButtons();
}
$("daily-consent").addEventListener("change", () => { $("enable-sync").disabled = !paired || !websiteIsReady || enabled || !$("daily-consent").checked; });
$("enable-sync").addEventListener("click", async () => {
  if (!$("daily-consent").checked || !websiteIsReady) { status("Prepare Relay first: open guided setup and enable automatic local imports.", true); return; }
  const district = districtById(account?.districtId); if (!paired || !district) return;
  const origins = [district.schoology + "/*"];
  if ($("google-consent").checked) origins.push("https://docs.google.com/*");
  try {
    if (!await chrome.permissions.request({ origins })) { status("Daily reading is off because access was not granted.", true); return; }
    const result = await action({ type: "sync-enable", google: $("google-consent").checked, pdf: $("pdf-consent").checked });
    renderSync(result); if (result) status("Daily reading enabled. Click Sync now, then return to Relay to allow AI analysis if desired. Reading alone does not create assignments.");
  } catch (e) { status(e.message, true); }
});
$("pause-sync").addEventListener("click", async () => { renderSync(await action({ type: "sync-pause" })); status("Daily reads paused. Saved excerpts remain available. Disable automatic AI separately in Relay if desired."); });
$("sync-now").addEventListener("click", async () => { renderSync(await action({ type: "sync-now" })); });
$("forget-sync").addEventListener("click", async () => {
  if (!confirm("Delete the extension’s daily snapshots and revoke its automatic school/document access? Saved copies in Relay must be cleared separately.")) return;
  const result = await action({ type: "sync-forget" });
  if (result) { await chrome.permissions.remove({ origins: [...DISTRICTS.map(d => d.schoology + "/*"), "https://docs.google.com/*"] }); renderSync(result); status("Extension sync data removed. Clear reader data in Relay separately."); }
});
render();
renderSync(await chrome.runtime.sendMessage({ type: "sync-status" }));
if (paired) await action({ type: "manual-pages" });
setInterval(async () => { try { renderSync(await chrome.runtime.sendMessage({ type: "sync-status" })); } catch { /* Popup closing. */ } }, 4000);
