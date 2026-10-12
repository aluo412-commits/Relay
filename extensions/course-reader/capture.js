// Executed in the active tab's ISOLATED world only after a user action.
// Keep this function self-contained: Chrome serializes it across contexts.
export async function readActivePage(schoolOrigin = "https://fuhsd.schoology.com") {
  try {
  if (!["https://fuhsd.schoology.com", "https://pausd.schoology.com"].includes(schoolOrigin)) throw new Error("Unsupported district.");
  function safeUrl(value) {
    try {
      const u = new URL(value, location.href);
      if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
      if (u.origin === schoolOrigin) {
        if (!/^\/(home(?:\/assignments)?|grades\/grades|assignment\/\d+|page\/\d+|course\/\d+\/(?:materials(?:\/gp\/\d+)?|updates))\/?$/.test(u.pathname)) return null;
        const folder = u.searchParams.get("f");
        u.search = folder && /^\d{1,20}$/.test(folder) ? `?f=${folder}` : "";
      } else if (u.hostname === "docs.google.com") {
        const m = /^\/(document|presentation)\/d\/([a-zA-Z0-9_-]+)(?:\/.*)?$/.exec(u.pathname);
        if (!m) return null;
        u.pathname = `/${m[1]}/d/${m[2]}/edit`; u.search = "";
      } else return null;
      u.hash = ""; return u.href;
    } catch { return null; }
  }
  const url = safeUrl(location.href);
  if (!url) throw new Error("Open a Schoology course in your selected district, or an allowed Google Doc/Slides file first. Login and external-tool pages are not read.");
  const warnings = [];
  let text = "";
  let links = [];
  if (location.hostname === "docs.google.com") {
    const m = /^\/(document|presentation)\/d\/([^/]+)/.exec(location.pathname);
    const exportPath = m[1] === "document" ? `/document/d/${m[2]}/export?format=txt` : `/presentation/d/${m[2]}/export/txt`;
    const response = await fetch(exportPath, { credentials: "include", signal: AbortSignal.timeout(12000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/plain")) throw new Error("Google did not provide a text export. Check that you can open this file and that export is allowed.");
    const reader = response.body.getReader(); let length = 0; const decoder = new TextDecoder();
    try {
      while (text.length < 6001) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.length;
        if (length > 250000) throw new Error("This export is too large. Use a shorter source.");
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally { await reader.cancel(); }
    warnings.push("Text export only. Images, comments, layout and some document tabs may be absent.");
  } else {
    const root = document.querySelector("main") || document.querySelector("#main-content");
    if (!root) throw new Error("No course content found. Finish signing in and wait for the Schoology page to load.");
    const copy = root.cloneNode(true);
    copy.querySelectorAll("script,style,noscript,nav,header,footer,aside,input,textarea,button,select,[hidden],[aria-hidden='true'],.comments,.s-comments,.comment,.discussion-comments").forEach(el => el.remove());
    copy.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,br").forEach(el => { el.appendChild(document.createTextNode("\n")); });
    text = (copy.textContent || "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const unique = new Map();
    root.querySelectorAll("a[href]").forEach(a => { const target = safeUrl(a.href); const title = a.textContent.trim().replace(/\s+/g, " ").slice(0, 160); if (target && target !== url && title) unique.set(target, { url: target, title }); });
    links = [...unique.values()].slice(0, 30);
    warnings.push("Loaded page text only. PDFs, images, linked files and collapsed content may be missing. Linked pages are not read automatically.");
    if (document.querySelector('iframe[src*="docviewer"]') || /\/materials\/gp\//.test(location.pathname)) warnings.push("This page may be a file wrapper. Finding a PDF link does not mean its pages were read.");
  }
  text = text.trim();
  if (text.length < 30) throw new Error("Too little readable text. Open the assignment itself rather than an empty folder or file preview.");
  if (text.length > 6000) warnings.push("Only the first 6,000 characters are included. Review this excerpt before importing.");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return { id: "page-" + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24), url, title: document.title.replace(/\s*\|\s*Schoology$/, "").slice(0, 180), text: text.slice(0, 6000), capturedAt: new Date().toISOString(), warnings, links };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "This page could not be read." };
  }
}
