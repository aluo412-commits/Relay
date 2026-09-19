"use client";

import { useEffect, useState } from "react";
import RelayApp from "@/components/RelayApp";
import "./demo.css";

export default function DemoPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json());
        // Never replace a signed-in user's real workspace with demo data.
        if (me?.user) {
          if (alive) setReady(true);
          return;
        }
        const started = await fetch("/api/demo/start", { method: "POST" }).then((r) => r.json());
        if (!started?.ok) throw new Error(started?.error || "Unable to start the demo");
        if (alive) setReady(true);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Unable to start the demo");
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <main className="demo-error">Relay demo could not start: {error}</main>;
  if (!ready) return <main className="loading-full">// preparing a real Relay workspace…</main>;
  return <RelayApp demoMode />;
}
