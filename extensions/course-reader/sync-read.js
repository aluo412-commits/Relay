// Serialized into an extension-owned Schoology/Docs tab. No page scripts are run
// from fetched HTML. Only bounded, same-origin GETs; no forms or external tools.
export async function readSyncPage(url, schoolOrigin = "https://fuhsd.schoology.com", readPdfs = false, sourceTitle = "", expectedIdentity = null) {
  try {
    if (!["https://fuhsd.schoology.com", "https://pausd.schoology.com"].includes(schoolOrigin)) throw new Error("Unsupported district.");
    const target = new URL(url);
    // Viewer metadata is data only. Never execute page scripts or return signed file URLs.
    const fileUrl = value => {
      try {
        if (typeof value !== 'string' || value.length > 8192) return null;
        const u = new URL(value, url);
        return u.protocol === 'https:' && !u.username && !u.password && !u.port && [schoolOrigin, 'https://asset-cdn.schoology.com', 'https://files-cdn.schoology.com'].includes(u.origin) && /(?:\.pdf$|^\/(?:attachment|attachments|system\/files|file)\/)/i.test(u.pathname) ? u.href : null;
      } catch { return null; }
    };
    const viewerFiles = document => {
      const found = [];
      for (const script of [...document.querySelectorAll('#main-content-wrapper script,script[type="application/json"]')].slice(0, 20)) {
        const text = script.textContent || ''; if (text.length > 256000) continue;
        for (const match of text.matchAll(/"custom"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
          if (match[1].length > 65536 || found.length >= 4) break;
          try { const metadata = JSON.parse(JSON.parse(match[1])); const file = fileUrl(metadata?.downloadLink); if (file) found.push(file); } catch { /* Not valid JSON metadata. */ }
        }
      }
      return found;
    };
    const readBounded = async (response, limit) => {
      if (!response.body || Number(response.headers.get('content-length') || 0) > limit) throw new Error('Source exceeds the read limit.');
      const reader = response.body.getReader(), parts = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) throw new Error('Source exceeds the read limit.'); parts.push(part.value); } } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
    };
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
      const inlineFiles = readPdfs ? viewerFiles(doc) : [];
      const missingFolders = [...root.querySelectorAll('.material-row-folder')].filter(row => !row.querySelector('.folder-title a[href],a[href*="?f="]')).length;
      if (missingFolders) attachments.push(`${missingFolders} folder rows have no navigable link. Dynamic/collapsed folder contents were not discovered.`);
      root.querySelectorAll("script,style,noscript,nav,header,footer,aside,input,textarea,button,select,[hidden],[aria-hidden='true'],.comments,.s-comments,.comment,.discussion-comments").forEach(el => el.remove());
      const seen = new Set();
      for (const a of root.querySelectorAll("a[href],iframe[src]")) {
        try {
          const u = new URL(a.getAttribute("href") || a.getAttribute("src"), url);
          if (u.protocol !== "https:" || u.username || u.password || seen.has(u.href)) continue;
          seen.add(u.href);
          const row = a.closest("li,tr,.item-row,.material-row,.materials-item,.material-row-folder");
          const rowTitle = row?.querySelector('.folder-title,.attachments-file-name,.item-title,.document-body-title')?.textContent;
          const label = (rowTitle || a.textContent?.trim() || a.getAttribute('title') || sourceTitle || "Linked source").trim().replace(/\s+/g, " ").slice(0, 160);
          const description = row && row.querySelectorAll("a[href]").length <= 3 ? (row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500) : (a.getAttribute("title") || "").slice(0, 500);
          if (/^(?:[a-z0-9-]+\.)*turnitin(?:uk)?\.com$/.test(u.hostname) || (/\/external_tool\//.test(u.pathname) && /\bturnitin\b/i.test(label))) services.push("turnitin");
          // Return only safe course/doc paths; attachment URLs may contain access
          // tokens, so the report records their labels, never signed URLs.
          if (u.origin === location.origin && /^\/course\/\d+(?:\/materials)?\/?$/.test(u.pathname) && target.pathname === "/courses") courses.push({ id: u.pathname.split("/")[2], title: label });
          if ((u.origin === schoolOrigin && /^\/(?:course\/\d+(?:\/(?:materials(?:\/gp\/\d+)?|updates))?|assignment\/\d+|page\/\d+)\/?$/.test(u.pathname)) || (u.origin === "https://docs.google.com" && /^\/(document|presentation)\/d\/[\w-]+(?:\/.*)?$/.test(u.pathname))) links.push({ url: u.href, title: label, description });
          else if ((u.origin !== schoolOrigin || /\.pdf(?:$|\?)|\/attachment\/|\/external_tool\/|\/(discussion|assessment|quiz|test|event|link)\/|docviewer/i.test(u.href)) && !(readPdfs && a.matches('iframe.docviewer-iframe') && u.origin === schoolOrigin && /^\/docviewer\/[\w/-]+\/?$/.test(u.pathname))) attachments.push(label || "Unread file / unsupported link");
        } catch { /* Non-web links aren't sources. */ }
      }
      if (readPdfs && !/answer.?key|solutions?|worked.?examples?/i.test(`${doc.title} ${sourceTitle}`)) {
        // Invoked only for a source page explicitly selected by the student.
        // Resolve its file structure; do not guess a homework list from keywords.
        const files = new Map(inlineFiles.map(file => [file, 'Selected source PDF']));
        const viewers = new Set(); let viewerIncomplete = false;
        for (const el of root.querySelectorAll('a[href],iframe[src],object[data],embed[src]')) {
          const raw = el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data');
          const label = (el.closest('.type-document')?.querySelector('.attachments-file-name')?.textContent || el.textContent || el.getAttribute('title') || 'Selected source PDF').trim().replace(/\s+/g,' ').slice(0,160);
          if (/answer.?key|solutions?|worked.?examples?/i.test(`${label} ${doc.title}`)) continue;
          const file = fileUrl(raw); if (file) files.set(file, /^https?:/i.test(label) ? 'Selected source PDF' : label);
          try { const u = new URL(raw, url); if (el.matches('iframe.docviewer-iframe') && u.origin === schoolOrigin && !u.username && !u.password && !u.port && /^\/docviewer\/[\w/-]+\/?$/.test(u.pathname)) viewers.add(u.href); } catch { /* Unsupported embed. */ }
        }
        if (viewers.size > 2) attachments.push('More than two document viewers on the selected page. Choose an individual Schoology file resource.');
        else for (const viewer of viewers) {
          try {
            const r = await fetch(viewer, { credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!r.ok || !/text\/html/i.test(r.headers.get('content-type') || '')) throw new Error('Viewer access unavailable');
            const metadataDoc = new DOMParser().parseFromString(new TextDecoder().decode(await readBounded(r, 512000)), 'text/html');
            const resolved = viewerFiles(metadataDoc);
            if (!resolved.length) { viewerIncomplete = true; attachments.push('Selected viewer exposed no supported PDF download metadata.'); }
            for (const file of resolved) files.set(file, 'Selected source PDF');
          } catch { viewerIncomplete = true; attachments.push('Selected document viewer could not be read within access/size limits. No redirects followed.'); }
        }
        if (files.size !== 1 || viewers.size > 2 || viewerIncomplete) attachments.push(files.size > 1 ? 'Multiple files on the selected page. Relay did not guess which is the homework list; select the individual Schoology resource.' : 'No single supported PDF resolved from the selected source. Dynamic viewers, external hosts and scans may need manual reading.');
        else {
          const [href, title] = [...files][0];
          try {
            const file = new URL(href), r = await fetch(href, { credentials: file.origin === schoolOrigin ? 'include' : 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!r.ok || !/application\/pdf/i.test(r.headers.get('content-type') || '')) throw new Error('PDF unavailable');
            const bytes = await readBounded(r, 2000000);
            if (new TextDecoder('ascii').decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('Not a PDF');
            pdfFiles.push({ title, bytes: Array.from(bytes) });
            attachments = attachments.filter(a => a !== title);
            warnings.push('Read from your selected source page. Selection does not verify the document is current or its dates are correct.');
          } catch { attachments.push('Selected PDF could not be fetched within access/2 MB limits. No redirect or login bypass attempted.'); }
        }
      }
      if (readPdfs && /answer.?key|solutions?|worked.?examples?/i.test(`${doc.title} ${sourceTitle}`)) attachments.push('Selected resource label matched the answer/example-material exclusion. PDF reading was skipped; no content was assumed.');
      const fileWrapper = /\/materials\/gp\//.test(target.pathname) || !!root.querySelector('iframe,object,embed');
      if (fileWrapper) { if (!pdfFiles.length) attachments.push('Embedded/file content was not read. Select the course source page and enable PDF reading; scans and other embeds may remain unsupported.'); warnings.push(pdfFiles.length ? 'Wrapper text only here. Downloaded PDF text is handled as separate page excerpts; see coverage for parsing failures.' : 'File wrapper only. The linked/embedded document was NOT read.'); }
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
