// User-invoked activeTab capture only. No network requests, traversal, or AI.
// Self-contained because Chrome serializes this function into its ISOLATED world.
export async function readSchoolPage() {
  try {
    function safe(value) {
      try {
        const u = new URL(value, location.href);
        if (u.origin !== 'https://lhs.fuhsd.org' || u.username || u.password || u.port || u.href.length > 1200 || u.search) return null;
        const path = decodeURIComponent(u.pathname);
        if (/(?:^|\/)(?:login|logout|signin|signout|admin|portal|private|account|authenticate|cfp|fs)(?:\/|$)|\.(?:pdf|ics|xml|json|js|css|jpg|png|zip)$/i.test(path)) return null;
        u.hash = ''; return u.href;
      } catch { return null; }
    }
    let url = safe(location.href);
    if (!url) throw new Error('Open an ordinary public page on https://lhs.fuhsd.org (no login page, query string, or file download).');
    if (/just a moment|access denied|attention required|verify (?:you are|your)|checking your browser/i.test(document.title) || document.querySelector('#challenge-form,#cf-challenge-running,iframe[src*="challenges.cloudflare.com"]')) throw new Error('The school page is showing a browser verification or access error. Complete normal verification yourself; Relay will not bypass it.');
    if (document.querySelector('a[href*="/logout"],a[href*="/signout"]')) throw new Error('This appears to be a signed-in website session. Use a public school page instead.');
    const article = document.querySelector('dialog[open].fsPostElement');
    const root = article || document.querySelector('main,[role="main"],#fsPageContent,#fsMain');
    if (!root || !root.getClientRects().length || getComputedStyle(root).visibility === 'hidden') throw new Error('No rendered school content found. Wait for the public page to finish loading.');
    let title = document.title;
    if (article) {
      const normalize = s => s.trim().replace(/\s+/g, ' ');
      title = normalize(article.querySelector('.fsTitle,h1,h2')?.innerText || '');
      if (!title || (article.innerText || '').length < 100) throw new Error('The news dialog is still loading. Wait for the article text, then read again.');
      const targets = new Set([...document.querySelectorAll('a.fsPostLink[href]')].slice(0, 200).filter(a => [title, 'Read More about ' + title].includes(normalize(a.innerText || ''))).map(a => safe(a.href)).filter(Boolean));
      if (targets.size !== 1) throw new Error('The open article could not be matched to one public source link. Close it and capture the listing instead; no article URL was guessed.');
      url = [...targets][0];
    }
    const blocked = 'script,style,noscript,template,nav,#fsHeader,#fsFooter,aside,form,input,textarea,button,select,iframe,object,embed,[hidden],[aria-hidden="true"],[contenteditable],.fsLogin,.fsAccountBar,[class*="cookie"],[id*="cookie"]';
    let visited = 0, clipped = false, text = '';
    const links = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (++visited > 15000) { clipped = true; return NodeFilter.FILTER_REJECT; }
        if (node.nodeType === Node.ELEMENT_NODE) {
          const style = getComputedStyle(node);
          if (node.matches(blocked) || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      if (visited > 15000 || text.length > 6500) { clipped = true; break; }
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.textContent || ''; if (raw.length > 12000) clipped = true;
        text += raw.slice(0, 12000).replace(/\s+/g, ' ');
      }
      else {
        if (/^(P|DIV|LI|TR|H[1-6]|BR|SECTION|ARTICLE)$/.test(node.tagName)) text += '\n';
        if (node.tagName === 'A' && links.size < 30) {
          const target = safe(node.href), title = (node.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160);
          if (target && target !== url && title) links.set(target, { url: target, title });
        }
      }
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 30) throw new Error('Too little rendered public text. Open a news or calendar page rather than a loading screen.');
    const warnings = ['Manual snapshot of rendered public text, not a live feed. Linked pages, PDFs, images, embedded calendars and collapsed content were not read. Dates are source text, not verified events or personal deadlines.'];
    if (article) warnings.push('Captured the news dialog you opened. The source link may reopen the listing; choose Read More there to see the full article.');
    else if (root.querySelector('.fsPostElement')) warnings.push('News listing only: headlines/summaries are not full articles. Open Read More in your browser, wait for the article, then capture again.');
    if (clipped || text.length > 6000) warnings.push('Capture limit reached: first 6,000 characters / bounded DOM scan only. Open a specific announcement for a narrower capture.');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    return { id: 'school-' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24), url, title: title.slice(0, 180) || 'Lynbrook public page', text: text.slice(0, 6000), capturedAt: new Date().toISOString(), warnings, links: [...links.values()] };
  } catch (e) { return { error: e instanceof Error ? e.message : 'School page could not be read.' }; }
}
