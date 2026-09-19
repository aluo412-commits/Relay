// Browser-only, deterministic sandbox. No fetch fallback, cookies, database or AI.
import type { DraftPayload, LogEntryDTO, ProjectState, SyncItem, TaskDTO } from "./types";

export const DEMO_REQUEST = "Create a task for Alex to verify controller wiring by tomorrow. Check that all motors respond and encoder directions are correct.";
export const DEMO_LOG = "All motors respond in the controller wiring test. Encoder direction is not verified yet.";
export const DEMO_TASK = "Verify controller wiring";

export function createDemoTransport() {
  const now = new Date();
  const stamp = now.toISOString();
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  let sequence = 0;
  const id = () => `demo-${++sequence}`;
  const member = { id: "demo-alex", name: "Alex", color: "#5b5fe9", role: "Build lead" };
  const state: ProjectState = {
    project: { id: "demo-project", name: "Robotics · scripted sandbox", deadline: null, model: "Scripted demo · no AI" },
    members: [member, { id: "demo-jordan", name: "Jordan", color: "#0e9e92", role: "Controls" }],
    boards: [{ id: "demo-board", name: "Robot v2", deadline: tomorrow, color: "#5b5fe9", summary: "Controller verification before autonomous testing", progress: 0, openCount: 1, lastActivityAt: stamp, tasks: [] }],
    updates: [], knowledge: [{ id: "demo-knowledge", tag: "Acceptance", text: "Autonomous testing needs verified motor responses AND encoder directions.", importance: "important", createdAt: stamp }],
  };
  function task(name: string): TaskDTO {
    return { id: id(), name, status: "new", type: "task", key: `ROB-${sequence}`, points: null, labels: [], parentId: null, parentKey: null, parentName: null, note: null, owner: { name: "Alex", color: member.color }, objective: null, acceptanceCriteria: [], dependencies: null, priority: "high", due: tomorrow, boardId: "demo-board", boardName: "Robot v2" };
  }
  state.boards[0].tasks.push({ ...task("Run autonomous test"), status: "blocked", dependencies: DEMO_TASK, objective: "Run the routine after the controller passes verification." });
  const messages: { id: string; role: string; content: string; createdAt: string }[] = [];
  const logs: LogEntryDTO[] = [];
  let items: SyncItem[] = [];
  let evaluated = false;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const refresh = () => {
    const b = state.boards[0];
    b.openCount = b.tasks.filter(t => t.status !== "done").length;
    b.progress = Math.round(100 * (b.tasks.length - b.openCount) / b.tasks.length);
  };
  return async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://demo.invalid");
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (path === "/api/auth/me") return json({ user: { id: member.id, name: "Alex", email: "scripted-demo@example.invalid" }, workspaces: [{ id: state.project.id, name: state.project.name, memberId: member.id, role: member.role, admin: false, inviteCode: "SANDBOX" }], activeWorkspaceId: state.project.id, googleEnabled: false });
    if (path === "/api/state") { refresh(); return json({ state, messages, currentMemberId: member.id }); }
    if (path === "/api/conversation") return json({ conversations: [] });
    if (path === "/api/ai-health") return json({ ok: true });
    if (path === "/api/models") return json({ models: [state.project.model] });
    if (path === "/api/compact" && method === "GET") return json({ entries: [] });
    if (path === "/api/briefing") return json({ briefing: null });
    if (path === "/api/proactive") return json({ message: null });
    if (path === "/api/files" && method === "GET") return json({ files: [], folders: [] });
    if (path === "/api/question" && method === "GET") return json({ questions: [] });
    if (path === "/api/notifications") return json({ notifications: [], unread: 0 });
    if (path === "/api/chat") {
      // Deliberately a fixed scenario, not an imitation of general AI understanding.
      const reply = "Scripted preview: I've drafted controller verification for Alex, due tomorrow. Review the two acceptance criteria and publish it yourself.";
      const draft: DraftPayload = { kind: "tasks", title: DEMO_TASK, tasks: [{ name: DEMO_TASK, owner: "Alex", due: tomorrow, status: "new", objective: "Verify the controller before autonomous testing.", acceptanceCriteria: ["All motors respond", "Encoder directions are verified"], priority: "high" }] };
      const userId = id(), messageId = id();
      messages.push({ id: userId, role: "user", content: body.message, createdAt: stamp }, { id: messageId, role: "assistant", content: reply, createdAt: stamp });
      const events = [{ type: "delta", text: reply }, { type: "done", turn: { reply }, messageId, userMessageId: userId, drafts: [draft], state }];
      return new Response(events.map(e => JSON.stringify(e)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
    }
    if (path === "/api/publish") {
      const draft = body.draft as DraftPayload;
      if (draft.kind !== "tasks") return json({ error: "This scripted chapter publishes task drafts only." }, 400);
      for (const d of draft.tasks) {
        const existing = state.boards[0].tasks.find(t => t.name === d.name);
        if (existing) continue;
        const owner = state.members.find(m => m.name === d.owner);
        state.boards[0].tasks.push({ ...task(d.name), status: d.status ?? "new", owner: owner ? { name: owner.name, color: owner.color } : null, due: d.due || null, objective: d.objective ?? null, acceptanceCriteria: d.acceptanceCriteria ?? [], note: d.note ?? null });
      }
      refresh();
      return json({ state, artifacts: [] });
    }
    if (path === "/api/log") {
      if (method === "GET") return json({ entries: logs });
      const target = state.boards[0].tasks.find(t => t.name === DEMO_TASK) ?? state.boards[0].tasks[1];
      if (!target) return json({ error: "Publish the controller task first." }, 400);
      target.status = "inprogress";
      target.note = "Scripted evidence: motors respond; encoder directions still unverified.";
      const entry: LogEntryDTO = { id: id(), memberName: member.name, text: body.text, synced: `${target.name} → In progress (not Done: encoder check is missing)`, createdAt: stamp };
      logs.push(entry);
      state.updates.push({ id: id(), title: "Controller verification progress", status: "In progress", summary: target.note, details: body.text, changes: null, impact: "Autonomous test remains blocked.", artifacts: [], nextSteps: "Verify encoder directions.", author: "Alex", createdAt: stamp });
      refresh();
      return json({ entry, state });
    }
    if (path === "/api/reconcile") {
      // Startup calls stay quiet; evaluation is revealed only after the user logs evidence.
      if (logs.length && !evaluated) {
        evaluated = true;
        items = [{ key: "demo-evaluation", verdict: "reconcile", intensity: "proactive", actionable: true, taskName: DEMO_TASK, boardId: "demo-board", fromName: "Relay", createdAt: stamp, text: "Scripted evaluation: motor responses are confirmed, but encoder direction has no completion evidence. Keep In progress. Next question: can you verify the encoder directions before autonomous testing?" }];
      }
      return json({ items });
    }
    if (path === "/api/sync") {
      if (method !== "GET") items = items.filter(i => i.key !== body.key);
      return json({ items });
    }
    if (path === "/api/review-progress") return json({ reviewedNote: "Motors respond. Encoder directions still need verification.", suggestedStatus: "inprogress", comment: "Scripted assessment: partial evidence is not completion." });
    // Fail closed, including uploads, account settings and any future API routes.
    return json({ error: "Not available in this scripted tour. No request was sent to Relay." }, 400);
  };
}
