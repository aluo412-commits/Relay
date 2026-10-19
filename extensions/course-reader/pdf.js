import { getDocument, GlobalWorkerOptions } from './vendor/pdf.mjs';
GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.mjs');
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || m?.type !== 'relay.pdf.parse') return;
  (async () => {
    if (!Array.isArray(m.bytes) || m.bytes.length > 2000000 || m.bytes.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error('PDF exceeds the local parser limit.');
    const task = getDocument({ data: new Uint8Array(m.bytes), isEvalSupported: false, useWasm: false, disableFontFace: true, useSystemFonts: false });
    let timer;
    try {
      return await Promise.race([(async () => {
        const doc = await task.promise, pages = [];
        for (let n = 1; n <= Math.min(doc.numPages, 20); n++) {
          const page = await doc.getPage(n), reader = page.streamTextContent().getReader();
          const items = []; let chars = 0, clipped = false;
          try { while (true) { const chunk = await reader.read(); if (chunk.done) break; for (const item of chunk.value.items) { if (!('str' in item)) continue; chars += item.str.length; items.push({ str: item.str.slice(0,6000), transform: item.transform }); if (items.length >= 2000 || chars > 12000) { clipped = true; break; } } if (clipped) break; } } finally { await reader.cancel().catch(() => {}); }
          // Keep table cells in their visual row. Do not concatenate a column
          // of dates with a separate column of homework and invent pairings.
          const rows = [];
          for (const item of items) {
            if (!('str' in item) || !item.str.trim()) continue;
            let row = rows.find(r => Math.abs(r.y - item.transform[5]) < 2);
            if (!row) { row = { y: item.transform[5], cells: [] }; rows.push(row); }
            row.cells.push({ x: item.transform[4], text: item.str });
          }
          const text = rows.sort((a,b) => b.y-a.y).map(r => r.cells.sort((a,b) => a.x-b.x).map(c => c.text).join(' | ')).join('\n');
          if (text.trim().length >= 30) pages.push({ page: n, text: text.slice(0,6000), truncated: clipped || text.length > 6000 });
          page.cleanup();
        }
        return { pages, totalPages: doc.numPages, limited: doc.numPages > 20 };
      })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Local PDF parsing timed out.')), 20000); })]);
    } finally { clearTimeout(timer); await task.destroy(); }
  })().then(result => respond({ ok: true, ...result })).catch(() => respond({ ok: false, error: 'PDF text could not be read. It may be scanned, encrypted, malformed or too large. No OCR or password bypass was attempted.' }));
  return true;
});
