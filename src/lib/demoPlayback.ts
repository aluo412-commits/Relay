// These delays are presentation pacing, never network or model latency.
export const DEMO_PACING = { inputCharacterMs: 42, acknowledgementMs: 1000, wordPairMs: 150, readPauseMs: 700, publishMs: 850, logMs: 1400, evaluateMs: 1600 };

export function demoPause(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Playback stopped", "AbortError"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Playback stopped", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function scriptedReplyStream(reply: string, done: object, { pace = 1, signal, reducedMotion = false }: { pace?: number; signal?: AbortSignal | null; reducedMotion?: boolean } = {}): ReadableStream<Uint8Array> {
  const playback = new AbortController();
  const abort = () => playback.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let cancelled = false;
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await demoPause(DEMO_PACING.acknowledgementMs * pace, playback.signal);
        const words = reply.match(/\S+\s*/g) ?? [reply];
        const chunks = reducedMotion ? [reply] : Array.from({ length: Math.ceil(words.length / 2) }, (_, i) => words.slice(i * 2, i * 2 + 2).join(""));
        for (const text of chunks) {
          emit({ type: "delta", text });
          await demoPause(DEMO_PACING.wordPairMs * pace, playback.signal);
        }
        await demoPause(DEMO_PACING.readPauseMs * pace, playback.signal);
        emit(done);
        controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      } finally { signal?.removeEventListener("abort", abort); }
    },
    cancel() { cancelled = true; playback.abort(); signal?.removeEventListener("abort", abort); },
  });
}
