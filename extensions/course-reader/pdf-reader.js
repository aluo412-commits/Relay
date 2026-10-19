let opening;
export async function parseLocalPdf(bytes) {
  if (!chrome.offscreen) throw new Error('Update Chrome to use local PDF text reading.');
  if (!await chrome.offscreen.hasDocument()) {
    opening ||= chrome.offscreen.createDocument({ url: 'pdf.html', reasons: ['WORKERS'], justification: 'Extract bounded text from an authorized school PDF locally. No OCR, document scripts, forms or cloud upload.' }).finally(() => { opening = null; });
    await opening;
  }
  try {
    const r = await chrome.runtime.sendMessage({ type: 'relay.pdf.parse', bytes });
    if (!r?.ok) throw new Error(r?.error || 'The local PDF reader did not respond.');
    return r;
  } finally { await chrome.offscreen.closeDocument().catch(() => {}); }
}
