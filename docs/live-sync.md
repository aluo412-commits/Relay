# Workspace updates and response latency

## Shared updates

`RelayApp` polls authenticated `GET /api/live` every 5 seconds **after the previous request finishes**, while the tab is visible and online. Focus/visibility/network recovery triggers an immediate check. This is automatic near-live polling, not WebSocket push; normal delivery latency is the interval plus request time.

The endpoint returns workspace state (boards, tasks, records, knowledge and members), the latest 100 team logs, and the current member's notifications. It never loads private chat, changes lastSeenAt, or invokes AI. Cookie-derived context scopes every query. Conditional ETags return 304 for unchanged data; the DB still runs the snapshot queries, so large workspaces will eventually need revision-based invalidation or hosted realtime infrastructure.

Unchanged slices keep their React references. Incoming snapshots do not replace unsent text, draft windows, chat messages or modal edits. A mutation clock rejects snapshots begun before/during a local write. Workspace switches abort the old polling loop. Failures back off up to 30 seconds; hidden tabs stop polling.

The personal In sync feed retains its existing refresh schedule and also recomputes when shared state changes. Sources and private conversations are not part of `/api/live`.

`/demo` explicitly disables the live loop. Its transport stays in-memory with no server/AI requests.

## Latency fixes

- Chat previously ran an extra LLM completion to choose compacted memories before generating the response. Recall now uses bounded local relevance ranking (up to 3 entries / 12,000 characters), with recent context as a fallback. This trades semantic retrieval for lower latency.
- Shared state, attached context, source context and recall metadata load concurrently.
- Log mode loads state and sources concurrently.
- Automatic AI health checks test configuration only; the explicit Settings health check still calls the provider.
- Chat no longer returns the old pre-generation shared snapshot, which could overwrite teammate changes received during generation.

`relay.chat.timing` server logs contain `contextMs`, `firstDeltaMs`, `totalMs` and model ID. They contain no prompt or response text. Compare these before blaming the provider or claiming a measured speedup. Model reasoning/tool-generation time still affects time to first visible text; these changes do not make it instantaneous.

## Validation

Unit tests cover reference preservation, ETags, stale snapshot rejection, stopped/hidden loops, mutation tracking and local memory selection. A browser test with mocked shared endpoints verified two tabs: publication in one appeared in the other without navigation, new logs appeared, and unsent composer text survived. This is UI integration coverage, not a production multi-user benchmark.
