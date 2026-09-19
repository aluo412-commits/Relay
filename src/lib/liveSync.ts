export type MutationClock = { revision: number; pending: number };

/** Tracks local writes so a snapshot started before a write cannot undo its UI. */
export function trackedFetch(base: typeof fetch, clock: MutationClock): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const write = method !== "GET" && method !== "HEAD";
    if (write) { clock.pending++; clock.revision++; }
    try { return await base(input, init); }
    finally { if (write) { clock.pending--; clock.revision++; } }
  };
}

export function startWorkspaceSync<T>({ request, clock, visible, apply, onStatus, intervalMs = 5000 }: {
  request: typeof fetch; clock: MutationClock; visible: () => boolean;
  apply: (data: T) => void; onStatus?: (status: "connected" | "retrying") => void; intervalMs?: number;
}) {
  let stopped = false, running = false, etag = "", failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  async function refresh() {
    clearTimeout(timer);
    if (stopped || running || !visible()) return;
    if (clock.pending) { timer = setTimeout(refresh, intervalMs); return; }
    running = true;
    const revision = clock.revision;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 12000);
    try {
      const response = await request("/api/live", { signal: controller.signal, cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} });
      if (response.status === 401) { stopped = true; onStatus?.("retrying"); return; }
      if (response.status !== 304 && !response.ok) throw new Error("Sync unavailable");
      const data = response.status === 304 ? null : await response.json() as T;
      if (stopped) return;
      if (clock.pending || revision !== clock.revision) { etag = ""; return; }
      if (data) { apply(data); etag = response.headers.get("etag") ?? ""; }
      failures = 0;
      onStatus?.("connected");
    } catch {
      if (!stopped) { failures++; onStatus?.("retrying"); }
    } finally {
      clearTimeout(timeout);
      running = false;
      if (!stopped && visible()) timer = setTimeout(refresh, Math.min(30000, intervalMs * 2 ** Math.min(failures, 3)));
    }
  }
  void refresh();
  return {
    refresh: () => { void refresh(); },
    stop: () => { stopped = true; clearTimeout(timer); controller?.abort(); },
  };
}

/** Keep references for unchanged slices (especially logs: don't trigger auto-scroll). */
export function keepIfEqual<T>(previous: T, incoming: T): T {
  return JSON.stringify(previous) === JSON.stringify(incoming) ? previous : incoming;
}
