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
const saved = await chrome.storage.session.get("pages"); pages = saved.pages || []; render();
