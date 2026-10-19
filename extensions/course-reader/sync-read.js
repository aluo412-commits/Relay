// Serialized into an extension-owned Schoology/Docs tab. No page scripts are run
// from fetched HTML. Only bounded, same-origin GETs; no forms or external tools.
export async function readSyncPage(url, schoolOrigin = "https://fuhsd.schoology.com", readPdfs = false, sourceTitle = "", expectedIdentity = null) {
  try {
    if (!["https://fuhsd.schoology.com", "https://pausd.schoology.com"].includes(schoolOrigin)) throw new Error("Unsupported district.");
    const target = new URL(url);
    if (target.origin !== location.origin || ![schoolOrigin, "https://docs.google.com"].includes(target.origin)) return { error: "The school session needs a new login.", login: true };
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
        // Read the bounded export before segmenting; homework tables can be after the first 6k.
      }
      html += decoder.decode();
    } finally { await stream.cancel(); }
    let text = html.trim(), title = "Linked course document", links = [], courses = [], attachments = [], services = [], schoolIdentity = null, pdfFiles = [];
    const warnings = [google ? "Google text export: images, comments, layout and some document tabs may be absent." : "HTML text snapshot: dynamically loaded, collapsed or permission-restricted content may be absent. Submission status is not inferred."];
    if (!google) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (doc.querySelector('input[type="password"],form[action*="/login"]') || /sign in|log in/i.test(doc.title) && !doc.querySelector('a[href*="/course/"]')) return { error: "Schoology login expired. Sign in, then choose Sync now.", login: true };
      {
        const ids = new Set(Array.from(doc.querySelectorAll('#profile a[href],#profile-menu a[href],.s-user-menu a[href],a[aria-label="Your Profile"]')).map(a => { try { const u = new URL(a.getAttribute("href"), schoolOrigin); return u.origin === schoolOrigin ? /^\/user\/(\d+)\/?$/.exec(u.pathname)?.[1] : null; } catch { return null; } }).filter(Boolean));
        if (ids.size === 1) { const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(schoolOrigin + ":" + [...ids][0])); schoolIdentity = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join(""); }
      }
      if (expectedIdentity && schoolIdentity !== expectedIdentity) return { error: 'The school login changed or could not be verified.', login: true, identityChanged: true };
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
          if ((u.origin === schoolOrigin && /^\/(?:course\/\d+(?:\/(?:materials(?:\/gp\/\d+)?|updates))?|assignment\/\d+|page\/\d+)\/?$/.test(u.pathname)) || (u.origin === "https://docs.google.com" && /^\/(document|presentation)\/d\/[\w-]+(?:\/.*)?$/.test(u.pathname))) links.push({ url: u.href, title: label, description });
          else if (u.origin !== schoolOrigin || /\.pdf(?:$|\?)|\/attachment\/|\/external_tool\/|\/(discussion|assessment|quiz|test|event|link)\/|docviewer/i.test(u.href)) attachments.push(label || "Unread file / unsupported link");
        } catch { /* Non-web links aren't sources. */ }
      }
      if (readPdfs) {
        const candidates = [...root.querySelectorAll('a[href],iframe[src],object[data],embed[src]')];
        const read = new Set(); let attempts = 0;
        for (const el of candidates) {
          if (attempts >= 2) { warnings.push('At most two important PDFs per source page were attempted. Other files remain unread.'); break; }
          const label = (el.textContent || el.getAttribute('title') || doc.title || '').replace(/[_-]/g, ' ').trim();
          if (!/homework|\bhw\b|assignments?|calendars?|schedules?|syllabus|rubric/i.test(`${label} ${/\/materials\/gp\//.test(target.pathname) ? sourceTitle : ''}`) || /answer.?key|solutions?|worked.?examples?/i.test(label)) continue;
          try {
            const file = new URL(el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data'), url);
            if (file.protocol !== 'https:' || file.username || file.password || file.port || ![schoolOrigin, 'https://asset-cdn.schoology.com', 'https://files-cdn.schoology.com'].includes(file.origin) || !/(?:\.pdf$|^\/(?:attachment|attachments|system\/files|file)\/)/i.test(file.pathname) || read.has(file.href)) continue;
            read.add(file.href); attempts++;
            const r = await fetch(file.href, { credentials: file.origin === schoolOrigin ? 'include' : 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!r.ok || !/application\/pdf/i.test(r.headers.get('content-type') || '') || !r.body) throw new Error('PDF access or format unavailable');
            const stream = r.body.getReader(), chunks = []; let size = 0;
            try { while (true) { const part = await stream.read(); if (part.done) break; size += part.value.length; if (size > 2000000) throw new Error('PDF larger than 2 MB'); chunks.push(part.value); } } finally { await stream.cancel(); }
            const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            attachments = attachments.filter(a => a !== (el.textContent || 'Linked source').trim().replace(/\s+/g, ' ').slice(0,160));
            pdfFiles.push({ title: /^https?:/i.test(label) ? 'Linked homework PDF' : label.slice(0,160), bytes: Array.from(bytes) });
          } catch { attachments.push(`${label.slice(0,100)}: PDF could not be fetched within access/size limits. No redirect or login bypass attempted.`); }
        }
      }
      const fileWrapper = /\/materials\/gp\//.test(target.pathname) || !!root.querySelector('iframe,object,embed');
      if (fileWrapper) { if (!pdfFiles.length) attachments.push('Embedded/file content was not read. Enable PDF text reading for supported homework PDFs; scans and other embeds remain unsupported.'); warnings.push(pdfFiles.length ? 'Wrapper text only here. Downloaded PDF text is handled as separate page excerpts; see coverage for parsing failures.' : 'File wrapper only. The linked/embedded document was NOT read.'); }
      root.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,br").forEach(el => el.appendChild(doc.createTextNode("\n")));
      text = (root.textContent || "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      title = (doc.title || root.querySelector("h1,h2")?.textContent || "Course page").replace(/\s*\|\s*Schoology$/, "").slice(0, 180);
    }
    if (text.length > 6000) warnings.push("Excerpt limited to the first 6,000 characters; later content was not analyzed.");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
    const id = "page-" + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
    let page = text.length >= 30 && target.pathname !== "/courses" ? { id, url, title, text: text.slice(0, 6000), capturedAt: new Date().toISOString(), warnings, links: [], services: [...new Set(services)], readDepth: /\/materials\/gp\//.test(target.pathname) ? "description" : "excerpt" } : null;
    const extraPages = []; let segmentedLimit = false;
    if (page && page.readDepth !== 'description' && text.length > 6000) {
      const parts = []; let rest = text;
      while (rest.length && parts.length < 8) { let end = rest.length <= 6000 ? rest.length : rest.lastIndexOf('\n', 5999); if (end < 3000 && rest.length > 6000) end = 6000; if (end <= 0) end = Math.min(rest.length, 6000); parts.push(rest.slice(0, end)); rest = rest.slice(end).trimStart(); }
      segmentedLimit = rest.length > 0;
      const usable = parts.filter(p => p.trim().length >= 30); if (usable.length !== parts.length) segmentedLimit = true;
      parts.splice(0, parts.length, ...usable);
      if (!parts.length) return { schoolIdentity, pdfFiles, extraPages: [], page: null, courses, links, attachments, linkLimit: true, empty: true };
      page.text = parts[0]; page.warnings = page.warnings.filter(w => !w.includes('first 6,000')); page.warnings.push(`Source split into ${parts.length} excerpts. Headings and table context may cross excerpts; do not infer missing dates.${rest.length ? ' Text after the eighth excerpt was not retained.' : ''}`);
      for (let i = 1; i < parts.length; i++) {
        const partUrl = url + '#excerpt-' + (i + 1), hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(partUrl));
        extraPages.push({ ...page, id: 'page-' + [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24), url: partUrl, text: parts[i], title: `${title} · excerpt ${i+1}`.slice(0,180) });
      }
    }
    return { schoolIdentity, pdfFiles, extraPages, page, courses: courses.slice(0, 40), links: links.slice(0, 500), attachments: attachments.slice(0, 40), linkLimit: segmentedLimit || links.length > 500 || courses.length > 40, empty: !page && target.pathname !== "/courses" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Source could not be read." };
  }
}
