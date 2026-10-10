// Serialized into an extension-owned Schoology/Docs tab. No page scripts are run
// from fetched HTML. Only bounded, same-origin GETs; no forms or external tools.
export async function readSyncPage(url) {
  try {
    const target = new URL(url);
    if (target.origin !== location.origin || !["https://fuhsd.schoology.com", "https://docs.google.com"].includes(target.origin)) return { error: "The school session needs a new login.", login: true };
    const google = target.hostname === "docs.google.com";
    if (google && !/^\/(document|presentation)\/d\/[\w-]+\/edit$/.test(target.pathname)) throw new Error("Unsupported document path.");
    if (!google && !/^\/(courses|grades\/grades|assignment\/\d+|page\/\d+|course\/\d+\/(materials(?:\/gp\/\d+)?|updates))\/?$/.test(target.pathname)) throw new Error("Unsupported school path.");
    const requestUrl = google ? url.replace(/\/edit$/, target.pathname.startsWith("/document/") ? "/export?format=txt" : "/export/txt") : url;
    const response = await fetch(requestUrl, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(12000), redirect: google ? "follow" : "error" });
    if ([401, 403].includes(response.status)) return { error: "Access denied or session expired. Open the source and check your login.", login: !google && response.status === 401 };
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
    const type = response.headers.get("content-type") || "";
    if (google ? !type.includes("text/plain") : !type.includes("text/html")) throw new Error("This source is not a readable text page. PDFs and binary files are not processed.");
    const stream = response.body.getReader(), decoder = new TextDecoder(); let html = "", bytes = 0;
    try {
      while (true) {
        const { value, done } = await stream.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > (google ? 250000 : 2000000)) throw new Error("Source exceeds the safe read size.");
        html += decoder.decode(value, { stream: true });
        if (google && html.length > 6000) break;
      }
      html += decoder.decode();
    } finally { await stream.cancel(); }
    let text = html.trim(), title = "Linked course document", links = [], courses = [], attachments = [], services = [];
    const warnings = [google ? "Google text export: images, comments, layout and some document tabs may be absent." : "HTML text snapshot: dynamically loaded, collapsed or permission-restricted content may be absent. Submission status is not inferred."];
    if (!google) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (doc.querySelector('input[type="password"],form[action*="/login"]') || /sign in|log in/i.test(doc.title) && !doc.querySelector('a[href*="/course/"]')) return { error: "Schoology login expired. Sign in, then choose Sync now.", login: true };
      const root = doc.querySelector("main,#main-content,#center-top");
      if (!root) throw new Error("Schoology did not expose readable course content in this response. Check the source in your browser.");
      root.querySelectorAll("script,style,noscript,nav,header,footer,aside,input,textarea,button,select,[hidden],[aria-hidden='true'],.comments,.s-comments,.comment,.discussion-comments").forEach(el => el.remove());
      const seen = new Set();
      for (const a of root.querySelectorAll("a[href]")) {
        try {
          const u = new URL(a.getAttribute("href"), url);
          if (u.protocol !== "https:" || u.username || u.password || seen.has(u.href)) continue;
          seen.add(u.href);
          const label = (a.textContent || "Linked source").trim().replace(/\s+/g, " ").slice(0, 160);
          const row = a.closest("li,tr,.item-row,.material-row,.materials-item");
          const description = row && row.querySelectorAll("a[href]").length <= 3 ? (row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500) : (a.getAttribute("title") || "").slice(0, 500);
          if (/^(?:[a-z0-9-]+\.)*turnitin(?:uk)?\.com$/.test(u.hostname) || (/\/external_tool\//.test(u.pathname) && /\bturnitin\b/i.test(label))) services.push("turnitin");
          // Return only safe course/doc paths; attachment URLs may contain access
          // tokens, so the report records their labels, never signed URLs.
          if (u.origin === location.origin && /^\/course\/\d+(?:\/materials)?\/?$/.test(u.pathname) && target.pathname === "/courses") courses.push({ id: u.pathname.split("/")[2], title: label });
          if ((u.origin === "https://fuhsd.schoology.com" && /^\/(?:course\/\d+(?:\/(?:materials(?:\/gp\/\d+)?|updates))?|assignment\/\d+|page\/\d+)\/?$/.test(u.pathname)) || (u.origin === "https://docs.google.com" && /^\/(document|presentation)\/d\/[\w-]+(?:\/.*)?$/.test(u.pathname))) links.push({ url: u.href, title: label, description });
          else if (u.origin !== "https://fuhsd.schoology.com" || /\.pdf(?:$|\?)|\/attachment\/|\/external_tool\/|\/(discussion|assessment|quiz|test|event|link)\/|docviewer/i.test(u.href)) attachments.push(label || "Unread file / unsupported link");
        } catch { /* Non-web links aren't sources. */ }
      }
      const fileWrapper = /\/materials\/gp\//.test(target.pathname) || !!root.querySelector('iframe,object,embed');
      if (fileWrapper) { attachments.push("Embedded/file content is not read by this text-only sync."); warnings.push("File wrapper only. The linked/embedded document was NOT read."); }
      root.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,br").forEach(el => el.appendChild(doc.createTextNode("\n")));
      text = (root.textContent || "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      title = (doc.title || root.querySelector("h1,h2")?.textContent || "Course page").replace(/\s*\|\s*Schoology$/, "").slice(0, 180);
    }
    if (text.length > 6000) warnings.push("Excerpt limited to the first 6,000 characters; later content was not analyzed.");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
    const id = "page-" + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
    const page = text.length >= 30 && target.pathname !== "/courses" ? { id, url, title, text: text.slice(0, 6000), capturedAt: new Date().toISOString(), warnings, links: [], services: [...new Set(services)], readDepth: /\/materials\/gp\//.test(target.pathname) ? "description" : "excerpt" } : null;
    return { page, courses: courses.slice(0, 40), links: links.slice(0, 500), attachments: attachments.slice(0, 40), linkLimit: links.length > 500 || courses.length > 40, empty: !page && target.pathname !== "/courses" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Source could not be read." };
  }
}
