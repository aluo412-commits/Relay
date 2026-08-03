"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dueState, formatDue, compareDue } from "@/lib/dates";
import type {
  ProjectState,
  UpdateDraft,
  ShareDraft,
  TaskDraft,
  BoardAction,
  ConnectorSuggestion,
  TaskDTO,
  UpdateDTO,
  Briefing,
  Importance,
  Priority,
  TaskStatus,
  ProgressReview,
  LogEntryDTO,
  NotificationDTO,
  DraftPayload,
  MemberDTO,
  SyncItem,
} from "@/lib/types";

type Detail = { kind: "task"; data: TaskDTO } | { kind: "update"; data: UpdateDTO };

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function fmtStamp(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

// Templates that the entry chips scaffold into the composer for the AI to help finish.
const ENTRY_TEMPLATES: { label: string; template: string }[] = [
  {
    label: "I finished something",
    template: "**Finished:** \n**What changed:** \n**Files / links:** \n**Anyone affected:** ",
  },
  {
    label: "Share with the team",
    template: "**Sharing:** \n**Why it matters:** ",
  },
  {
    label: "Turn a goal into tasks",
    template: "**Goal:** \n**By when:** \n**Rough pieces (optional):** ",
  },
  {
    label: "I hit a blocker",
    template: "**Blocked on:** \n**What I need to move forward:** \n**Who might help:** ",
  },
];

interface UIMessage {
  role: "user" | "assistant";
  content: string;
  questions?: string[];
  suggestions?: string[];
  createdAt?: string;
}

// A free-floating window. Two flavors:
//  • a finished ARTIFACT the agent produced (a markdown document / posted record) —
//    read-only, download/copy/dismiss.
//  • a PENDING DRAFT (draft != null) — an editable card the user tweaks and Publishes;
//    nothing it describes touches the board/timeline/team until then.
interface Artifact {
  id: string;
  title: string;
  filename: string;
  markdown: string;
  kind: "document" | "record" | "tasks" | "share" | "status" | "slides";
  x: number; // floating window position
  y: number;
  docked: boolean;
  dockY: number; // vertical position when docked in the sidebar
  draft?: DraftPayload; // present → this is an editable, unpublished draft
  pptxBase64?: string; // present → a real .pptx to download (kind "slides")
  boardId?: string; // the workstream this artifact belongs to (swaps with context)
}
const DOCK_ZONE = 210; // px from the right edge that counts as "the sidebar"
type ArtifactDTO = { title: string; filename: string; markdown: string; kind: "document" | "record" | "slides"; pptxBase64?: string };

// A compacted slice of conversation: the agent's short heading + brief summary,
// with the full transcript stored behind it. On later turns the agent scans these
// summaries and pulls back only the ones relevant to what's being discussed now.
type CompactionDTO = { id: string; heading: string; summary: string; content: string; createdAt: string };

const KANBAN_COLS: { status: TaskStatus; label: string }[] = [
  { status: "new", label: "New" },
  { status: "inprogress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

let artifactSeq = 0;
function newArtifactId() {
  artifactSeq += 1;
  return "artifact-" + artifactSeq;
}

function draftTitle(d: DraftPayload): string {
  if (d.kind === "record") return d.update.title || "Work record";
  if (d.kind === "tasks") return d.tasks.length === 1 ? d.tasks[0].name || "Task" : `${d.tasks.length} tasks`;
  if (d.kind === "share") return `Share: ${d.share.tag || "note"}`;
  return d.title;
}

const PUBLISH_TOAST: Record<Artifact["kind"], string> = {
  record: "Record posted to the timeline",
  tasks: "Published to the board",
  share: "Shared with the team",
  status: "Board updated",
  document: "Saved",
  slides: "Saved",
};

function windowIcon(kind: Artifact["kind"]): string {
  if (kind === "record") return "◆";
  if (kind === "tasks") return "▤";
  if (kind === "share") return "⇄";
  if (kind === "status") return "✓";
  if (kind === "slides") return "▦";
  return "📄";
}

const DRAFT_KIND_LABEL: Record<string, string> = {
  record: "Work record",
  tasks: "Tasks",
  share: "Team share",
  status: "Status change",
};

export default function RelayApp() {
  const [state, setState] = useState<ProjectState | null>(null);
  const [memberId, setMemberId] = useState<string>("");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const artDrag = useRef<{ id: string; offX: number; offY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const [connector, setConnector] = useState<ConnectorSuggestion | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dragging, setDragging] = useState<TaskDTO | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "boards" | "board">("chat");
  const [activeBoardId, setActiveBoardId] = useState<string>("");
  const [newBoardName, setNewBoardName] = useState("");
  const [syncItems, setSyncItems] = useState<SyncItem[]>([]);
  const [compactions, setCompactions] = useState<CompactionDTO[]>([]);
  const [compacting, setCompacting] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [openCompactionId, setOpenCompactionId] = useState<string | null>(null);
  // Relay (coaching chat) is the default surface; the quiet Log is the second mode.
  const [mode, setMode] = useState<"log" | "chat">("chat");
  const [logEntries, setLogEntries] = useState<LogEntryDTO[]>([]);
  const [logInput, setLogInput] = useState("");
  const [logging, setLogging] = useState(false);
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [aiDown, setAiDown] = useState<string | null>(null);
  const [checkingAi, setCheckingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState<string[]>([]);
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const currentMember = state?.members.find((m) => m.id === memberId);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const flashByNames = (names: string[]) => {
    setFlash(names.map((n) => n.toLowerCase()));
    window.setTimeout(() => setFlash([]), 1700);
  };

  // Initial load.
  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        setState(d.state);
        const first = d.state.members[0];
        if (first) setMemberId(first.id);
        const firstBoard = d.state.boards?.[0];
        if (firstBoard) setActiveBoardId(firstBoard.id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Load a member's workspace when identity changes: state, chat thread, briefing,
  // log, notifications, and compacted-context entries.
  const loadMember = useCallback((id: string) => {
    setArtifacts([]); // switching WHO you are is a fresh desk
    setConnector(null);
    setBriefing(null);
    setNotifOpen(false);
    // Read the sync feed (which uses lastSeenAt as the "since your last visit"
    // boundary) BEFORE the briefing bumps lastSeenAt, then speak up proactively.
    Promise.all([
      fetch(`/api/state?memberId=${id}`).then((r) => r.json()),
      fetch(`/api/log`).then((r) => r.json()),
      fetch(`/api/notifications?memberId=${id}`).then((r) => r.json()),
      fetch(`/api/compact?memberId=${id}`).then((r) => r.json()),
      fetch(`/api/sync?memberId=${id}`).then((r) => r.json()),
    ]).then(([s, l, n, c, sy]) => {
      if (!s.error) {
        setState(s.state);
        setMessages(s.messages ?? []);
      }
      if (l && !l.error) setLogEntries(l.entries ?? []);
      if (n && !n.error) {
        setNotifications(n.notifications ?? []);
        setUnread(n.unread ?? 0);
      }
      if (c && !c.error) setCompactions(c.entries ?? []);
      if (sy && !sy.error) setSyncItems(sy.items ?? []);

      // Proactive speak-up: after the feed is read, let Relay initiate in chat for
      // the top urgent+actionable item (deduped server-side so it never repeats).
      fetch("/api/proactive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: id }),
      })
        .then((r) => r.json())
        .then((p) => {
          if (p && p.message) setMessages((msgs) => [...msgs, p.message]);
        })
        .catch(() => {});

      // Briefing bumps lastSeenAt — run it last so the feed above saw the old value.
      fetch(`/api/briefing?memberId=${id}`)
        .then((r) => r.json())
        .then((b) => {
          if (b && !b.error) setBriefing(b.briefing);
        })
        .catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (memberId) loadMember(memberId);
  }, [memberId, loadMember]);

  // Keep the "in sync" feed current after any state-changing action, and on a light
  // interval so ambient awareness stays live without a manual refresh.
  const refreshSync = useCallback(() => {
    if (!memberId) return;
    fetch(`/api/sync?memberId=${memberId}`)
      .then((r) => r.json())
      .then((sy) => {
        if (sy && !sy.error) setSyncItems(sy.items ?? []);
      })
      .catch(() => {});
  }, [memberId]);

  useEffect(() => {
    if (!memberId) return;
    const t = window.setInterval(refreshSync, 45000);
    return () => window.clearInterval(t);
  }, [memberId, refreshSync]);

  // Any change to shared state can change what's relevant to you — recompute the feed.
  useEffect(() => {
    if (state && memberId) refreshSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function dismissSync(key: string) {
    setSyncItems((items) => items.filter((i) => i.key !== key));
    if (!memberId) return;
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, key }),
      });
    } catch {
      /* non-critical */
    }
  }

  // Autoscroll to the newest content (also when you swap modes / streams).
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = streamRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [messages, sending, connector, mode, logEntries]);

  // Check whether the AI provider is reachable (surfaces billing/auth outages).
  useEffect(() => {
    let cancelled = false;
    setCheckingAi(true);
    fetch("/api/ai-health")
      .then((x) => x.json())
      .then((r) => {
        if (!cancelled) setAiDown(r.ok ? null : r.error || "AI is unavailable.");
      })
      .catch((e) => {
        if (!cancelled) setAiDown(String(e));
      })
      .finally(() => {
        if (!cancelled) setCheckingAi(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || sending || !memberId) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setError(null);
    // drop stale suggestions from the previous assistant turn
    setMessages((m) => [
      ...m.map((x) => (x.role === "assistant" ? { ...x, suggestions: undefined } : x)),
      { role: "user", content: text, createdAt: new Date().toISOString() },
    ]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, message: text, boardId: activeBoardId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      const turn = data.turn;
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: turn.reply,
          questions: turn.questions?.length ? turn.questions : undefined,
          suggestions: turn.suggestions?.length ? turn.suggestions : undefined,
          createdAt: new Date().toISOString(),
        },
      ]);
      // The agent PROPOSES: drafts pop up as editable windows to review & publish;
      // finished documents arrive as artifacts. Nothing hit the board yet.
      if (data.state) setState(data.state);
      addDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      addArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function createBoard() {
    const name = newBoardName.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setState(data.state);
      setActiveBoardId(data.boardId);
      setNewBoardName("");
      setView("board");
      showToast("Board created");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Compact the current conversation into a summarized entry, then clear the live
  // thread. The agent re-surfaces relevant entries automatically on later turns.
  async function compactNow() {
    if (compacting || !memberId || messages.length === 0) return;
    setCompacting(true);
    setError(null);
    try {
      const res = await fetch("/api/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Compact failed");
      if (data.entry) setCompactions((c) => [data.entry, ...c]);
      setMessages([]);
      showToast("Conversation compacted");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCompacting(false);
    }
  }

  async function deleteCompaction(id: string) {
    setCompactions((c) => c.filter((x) => x.id !== id));
    if (openCompactionId === id) setOpenCompactionId(null);
    try {
      await fetch(`/api/compact?id=${id}`, { method: "DELETE" });
    } catch {
      /* non-critical */
    }
  }

  function addArtifacts(incoming: ArtifactDTO[]) {
    if (!incoming.length) return;
    setArtifacts((prev) => {
      let n = prev.length;
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const placed = incoming.map((a) => {
        const off = (n++ % 6) * 26;
        return { ...a, id: newArtifactId(), x: Math.max(20, (w - 560) / 2 + off), y: 84 + off, docked: false, dockY: 120, boardId: activeBoardId };
      });
      return [...prev, ...placed];
    });
  }

  // Pending drafts the agent proposed in chat — editable windows, published on confirm.
  function addDrafts(incoming: DraftPayload[]) {
    if (!incoming.length) return;
    setArtifacts((prev) => {
      let n = prev.length;
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const placed = incoming.map((d) => {
        const off = (n++ % 6) * 26;
        return {
          id: newArtifactId(),
          title: draftTitle(d),
          filename: "",
          markdown: "",
          kind: d.kind,
          x: Math.max(20, (w - 560) / 2 + off),
          y: 84 + off,
          docked: false,
          dockY: 120,
          draft: d,
          boardId: activeBoardId,
        };
      });
      return [...prev, ...placed];
    });
  }

  function updateDraft(id: string, draft: DraftPayload) {
    setArtifacts((list) => list.map((a) => (a.id === id ? { ...a, draft, title: draftTitle(draft) } : a)));
  }

  async function publishDraft(a: Artifact) {
    if (!a.draft || publishing.has(a.id)) return;
    setPublishing((s) => new Set(s).add(a.id));
    setError(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, boardId: activeBoardId, draft: a.draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publish failed");
      setArtifacts((list) => list.filter((x) => x.id !== a.id));
      if (data.state) setState(data.state);
      addArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
      if (a.draft.kind === "tasks") {
        flashByNames(a.draft.tasks.map((t) => t.name));
      }
      showToast(PUBLISH_TOAST[a.draft.kind]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing((s) => {
        const n = new Set(s);
        n.delete(a.id);
        return n;
      });
    }
  }

  // Free drag for artifact windows / docked tabs (via pointer capture).
  function startArtDrag(e: React.PointerEvent, a: Artifact) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const curX = a.docked ? window.innerWidth - DOCK_ZONE : a.x;
    const curY = a.docked ? a.dockY : a.y;
    artDrag.current = { id: a.id, offX: e.clientX - curX, offY: e.clientY - curY, startX: e.clientX, startY: e.clientY, moved: false };
    // bring to front
    setArtifacts((list) => {
      const found = list.find((x) => x.id === a.id);
      return found ? [...list.filter((x) => x.id !== a.id), found] : list;
    });
  }
  function onArtDragMove(e: React.PointerEvent) {
    const d = artDrag.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
    d.moved = true;
    const x = e.clientX - d.offX;
    const y = Math.max(52, e.clientY - d.offY);
    setArtifacts((list) => list.map((a) => (a.id === d.id ? { ...a, x, y, docked: false } : a)));
  }
  function onArtDragUp(e: React.PointerEvent, onClick?: () => void) {
    const d = artDrag.current;
    if (!d) return;
    artDrag.current = null;
    if (!d.moved) {
      onClick?.();
      return;
    }
    const inSidebar = e.clientX > window.innerWidth - DOCK_ZONE;
    setArtifacts((list) =>
      list.map((a) =>
        a.id === d.id ? (inSidebar ? { ...a, docked: true, dockY: Math.max(52, e.clientY - 16) } : { ...a, docked: false }) : a
      )
    );
  }
  function openArtifact(id: string) {
    setArtifacts((list) => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const found = list.find((a) => a.id === id);
      if (!found) return list;
      const rest = list.filter((a) => a.id !== id);
      return [...rest, { ...found, docked: false, x: Math.max(20, (w - 560) / 2), y: 90 }];
    });
  }

  function downloadArtifact(a: Artifact) {
    let blob: Blob;
    if (a.pptxBase64) {
      const bin = atob(a.pptxBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    } else {
      blob = new Blob([a.markdown], { type: "text/markdown" });
    }
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = a.filename || (a.pptxBase64 ? "deck.pptx" : "document.md");
    el.click();
    URL.revokeObjectURL(url);
  }

  async function copyArtifact(a: Artifact) {
    try {
      await navigator.clipboard.writeText(a.markdown);
      showToast("Copied to clipboard");
    } catch {
      showToast("Couldn't copy");
    }
  }

  // Log-first capture: record the entry, let the agent silently sync / draft.
  async function postLog() {
    const text = logInput.trim();
    if (!text || logging || !memberId) return;
    setLogInput("");
    setLogging(true);
    try {
      const res = await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, boardId: activeBoardId, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Log failed");
      if (data.entry) setLogEntries((e) => [...e, data.entry]);
      if (data.state) setState(data.state);
      addArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLogging(false);
    }
  }

  async function markNotifsRead() {
    if (!memberId || unread === 0) return;
    setUnread(0);
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, all: true }),
      });
    } catch {
      /* non-critical */
    }
  }

  async function acceptConnector() {
    if (!connector) return;
    const actions = connector.onAcceptActions ?? [];
    const names = actions.map((a) => ("task" in a ? a.task : "name" in a ? a.name : "")).filter(Boolean);
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorId: memberId,
          boardId: activeBoardId,
          actions,
          notify: { recipientName: connector.target, text: connector.text },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setState(data.state);
      flashByNames(names);
      showToast(`${connector.target} looped in`);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Done — I've looped ${connector.target} in and updated the board.` },
      ]);
      setConnector(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Put text (a quick reply or a multi-field template) into the composer, editable.
  function insertText(t: string) {
    setInput(t);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      autoGrow(el);
      // For a template (multi-line), drop the caret at the end of the first field line.
      const nl = t.indexOf("\n");
      const pos = nl === -1 ? t.length : nl;
      el.setSelectionRange(pos, pos);
    });
  }

  function openTaskByName(name: string) {
    const all = state?.boards.flatMap((b) => b.tasks) ?? [];
    const t = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (t) setDetail({ kind: "task", data: t });
  }

  // Progress check-in from a task's detail page.
  // Your own task → applies directly. Someone else's → files a pending request.
  async function submitProgress(task: TaskDTO, status: TaskStatus, note: string, due?: string | null) {
    const isMine = !task.owner || task.owner.name === currentMember?.name;
    const dueChanged = due !== undefined && (due || null) !== (task.due || null);
    try {
      if (isMine) {
        const res = await fetch("/api/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [{ type: "update_task", task: task.name, status, note: note || undefined, ...(dueChanged ? { due: due || "" } : {}) }],
            boardId: task.boardId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setState(data.state);
        flashByNames([task.name]);
        showToast("Progress submitted");
      } else {
        const res = await fetch("/api/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "create",
            taskId: task.id,
            requestedById: memberId,
            proposedStatus: status,
            note,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast(`Change request sent to ${task.owner?.name} for approval`);
      }
      setDetail(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Drag a card to another Kanban column → change its status (own task applies
  // directly; someone else's becomes a pending request, via submitProgress).
  function moveTask(task: TaskDTO, status: TaskStatus) {
    if (task.status === status) return;
    submitProgress(task, status, "");
  }

  // Task owner approves / declines a pending change request from their briefing.
  async function resolveRequest(id: string, decision: "approve" | "decline") {
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "resolve", requestId: id, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.state) setState(data.state);
      setBriefing((prev) => (prev ? { ...prev, requests: prev.requests.filter((r) => r.id !== id) } : prev));
      showToast(decision === "approve" ? "Change approved & applied" : "Request declined");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Ask the AI to review & polish a progress note before submitting.
  async function reviewProgress(payload: {
    taskName: string;
    objective?: string | null;
    acceptanceCriteria: string[];
    doneCriteria: string[];
    currentStatus: string;
    draftNote: string;
  }): Promise<ProgressReview | null> {
    const res = await fetch("/api/review-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Review failed");
    return data.review as ProgressReview;
  }

  async function loadModels() {
    try {
      const r = await fetch("/api/models").then((x) => x.json());
      setAvailableModels(Array.isArray(r.models) ? r.models : []);
    } catch {
      setAvailableModels([]);
    }
  }

  async function checkAi() {
    setCheckingAi(true);
    try {
      const r = await fetch("/api/ai-health").then((x) => x.json());
      setAiDown(r.ok ? null : r.error || "AI is unavailable.");
    } catch (e) {
      setAiDown((e as Error).message);
    } finally {
      setCheckingAi(false);
    }
  }

  async function saveModel() {
    const model = modelDraft.trim();
    if (!model) return;
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setState(data.state);
      showToast(`Model set to ${model}`);
      setSettingsOpen(false);
      checkAi();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const isDark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("relay-theme", next);
    } catch {}
  }

  if (error && !state) {
    return <div className="loading-full">⚠ {error}</div>;
  }
  if (!state || !currentMember) {
    return <div className="loading-full">// connecting to Relay…</div>;
  }


  const isFlash = (t: TaskDTO) => flash.includes(t.name.toLowerCase());
  const memberColor = (name: string) => state.members.find((m) => m.name === name)?.color ?? "#8791a6";
  const boards = state.boards;
  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? boards[0];
  const allTasks = boards.flatMap((b) => b.tasks);
  // The current member's unfinished tasks across ALL boards (labeled by board).
  const myTasks = allTasks
    .filter((t) => t.owner?.name === currentMember.name && t.status !== "done")
    .sort((a, b) => compareDue(a.due, b.due));
  // "On your plate" summary for the briefing.
  const myOpenTasks = myTasks.map((t) => ({ name: t.name, status: t.status, note: t.note }));

  // The Kanban board for the ACTIVE board (shared between the board page).
  const kanban = (
    <div className="kanban">
      {KANBAN_COLS.map((col) => {
        const items = (activeBoard?.tasks ?? []).filter((t) => t.status === col.status);
        return (
          <div
            key={col.status}
            className={`kcol${dragOverCol === col.status ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragging && dragging.status !== col.status && dragOverCol !== col.status) setDragOverCol(col.status);
            }}
            onDragLeave={() => setDragOverCol((c) => (c === col.status ? null : c))}
            onDrop={() => {
              setDragOverCol(null);
              if (dragging) moveTask(dragging, col.status);
            }}
          >
            <div className="kcol-head">
              <span className="kcol-name">
                <span className={`kdot ${col.status}`} />
                {col.label}
              </span>
              <span className="kcol-count">{items.length}</span>
            </div>
            <div className="kcol-body">
              {items.length ? (
                items.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    flash={isFlash(t)}
                    onOpen={() => setDetail({ kind: "task", data: t })}
                    draggable
                    onDragStart={() => setDragging(t)}
                    onDragEnd={() => {
                      setDragging(null);
                      setDragOverCol(null);
                    }}
                  />
                ))
              ) : (
                <div className="kcol-empty">Drop here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          Relay
        </div>
        <div className="proj-tag">
          <b>{state.project.name}</b>
          {state.project.deadline ? ` · ${state.project.deadline}` : ""}
        </div>
        <div className="spacer" />
        <div className="switcher">
          <span className="lbl">acting as</span>
          {state.members.map((m) => (
            <button
              key={m.id}
              className={`who-btn${m.id === memberId ? " active" : ""}`}
              onClick={() => setMemberId(m.id)}
              title={m.role ?? m.name}
            >
              <span className="av" style={{ background: m.color }}>
                {initials(m.name)}
              </span>
              {m.name}
            </button>
          ))}
        </div>
        {artifacts.length > 0 ? (
          <button
            className="drafts-toggle on"
            onClick={() => openArtifact(artifacts[artifacts.length - 1].id)}
            title="Open latest artifact"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 2h6l3 3v9H4V2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M9.5 2v3.5H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            Artifacts <b>{artifacts.length}</b>
          </button>
        ) : null}
        {compactions.length > 0 ? (
          <button
            className="drafts-toggle on"
            onClick={() => setCompactOpen((v) => !v)}
            title="Compacted context — the agent pulls these back when relevant"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Compacted <b>{compactions.length}</b>
          </button>
        ) : null}
        <div className="bell-wrap">
          <button
            className="icon-btn bell"
            onClick={() => {
              const opening = !notifOpen;
              setNotifOpen(opening);
              if (opening) markNotifsRead();
            }}
            title="Notifications"
            aria-label="Notifications"
          >
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
              <path d="M8 2a3.5 3.5 0 0 0-3.5 3.5c0 3-1.2 4-1.2 4h9.4s-1.2-1-1.2-4A3.5 3.5 0 0 0 8 2ZM6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {unread > 0 ? <span className="bell-badge">{unread}</span> : null}
          </button>
          {notifOpen ? (
            <div className="notif-panel">
              <div className="notif-head">
                <span>For you</span>
                <button className="notif-x" onClick={() => setNotifOpen(false)} aria-label="Close">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="notif-body">
                {notifications.length ? (
                  notifications.map((n) => (
                    <div key={n.id} className={`notif imp-${n.importance ?? "normal"}`}>
                      <span className={`notif-kind ${n.kind}`}>
                        {n.kind === "assignment" ? "◉ assigned" : n.kind === "connector" ? "⇄ shared" : "◆ news"}
                        {n.importance && n.importance !== "normal" ? <ImportanceBadge level={n.importance} /> : null}
                      </span>
                      <div className="notif-text">{n.text}</div>
                      <div className="notif-meta">
                        {n.fromName ? `${n.fromName}` : ""}
                        {n.boardName ? ` · ${n.boardName}` : ""}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="notif-empty">Nothing for you right now.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <button
          className="icon-btn"
          onClick={() => {
            setModelDraft(state.project.model);
            setSettingsOpen(true);
            loadModels();
          }}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5 13 13M13 3l-1.5 1.5M4.5 11.5 3 13"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </header>

      {aiDown && (
        <div className="ai-banner">
          <span className="ai-banner-dot" />
          <span className="ai-banner-text">
            <strong>AI unavailable</strong> — {aiDown}
            {/balance|credit|billing|quota|limit/i.test(aiDown) ? " (the provider account is out of credits)" : ""}
          </span>
          <button className="ai-banner-btn" onClick={checkAi} disabled={checkingAi}>
            {checkingAi ? "Checking…" : "Recheck"}
          </button>
        </div>
      )}

      {view === "chat" && (
      <div className="panes">
        {/* WORKSPACE */}
        <section className="workspace">
          <div className="ws-head">
            <span className="badge">
              <RelayGlyph />
            </span>
            <div className="t">
              Relay
              <span>
                {mode === "log" ? "team log · Relay quietly syncs it" : "coaching chat · private to " + currentMember.name}
              </span>
            </div>
            <div className="mode-toggle">
              <button className={mode === "chat" ? "on" : ""} onClick={() => setMode("chat")}>
                Ask Relay
              </button>
              <button className={mode === "log" ? "on" : ""} onClick={() => setMode("log")}>
                Log
              </button>
            </div>
          </div>

          {error && <div className="banner">{error}</div>}

          {mode === "log" ? (
            <>
              <div className="stream log-stream" ref={streamRef}>
                {logEntries.length === 0 ? (
                  <p className="log-hint">
                    Jot what you&apos;re doing — Relay quietly syncs the board and drafts records. No need to wait for a reply.
                  </p>
                ) : (
                  logEntries.map((e) => (
                    <div key={e.id} className="log-entry">
                      <div className="log-author">
                        <span className="av" style={{ background: memberColor(e.memberName) }}>
                          {initials(e.memberName)}
                        </span>
                        <span className="log-author-name">{e.memberName}</span>
                        <span className="log-time">
                          {new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className="log-text">
                        <RichText text={e.text} />
                      </div>
                      {e.synced ? <div className="log-synced">✓ synced: {e.synced}</div> : null}
                    </div>
                  ))
                )}
                {logging && (
                  <div className="log-entry pending">
                    <div className="log-text">
                      <span className="typing">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="composer">
                <textarea
                  value={logInput}
                  onChange={(e) => {
                    setLogInput(e.target.value);
                    autoGrow(e.target);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      postLog();
                    }
                  }}
                  placeholder={`What are you working on, ${currentMember.name}? (logs to ${activeBoard?.name ?? "the board"})`}
                  rows={1}
                />
                <button className="send" onClick={() => postLog()} disabled={logging || !logInput.trim()} aria-label="Log">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8h10M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </>
          ) : (
          <>
          <div className="stream" ref={streamRef}>
            <SyncPanel items={syncItems} onOpenTask={openTaskByName} onDismiss={dismissSync} />
            {briefing && (
              <BriefingCard
                b={briefing}
                name={currentMember.name}
                openTasks={myOpenTasks}
                onInsert={insertText}
                onOpenTask={openTaskByName}
                onResolve={resolveRequest}
                disabled={sending}
              />
            )}
            {messages.length === 0 && !sending ? (
              <div className="start-here">
                <div className="start-eyebrow">Ask Relay</div>
                <h2 className="start-title">Start where the work is, {currentMember.name}.</h2>
                <p className="start-sub">
                  Relay turns what you say into shared, structured work. Do one of these — Relay takes it from there.
                </p>
                <div className="start-steps">
                  <button className="start-step" onClick={() => setMode("log")}>
                    <span className="start-step-n">Log</span>
                    <span className="start-step-t">Say what you did</span>
                    <span className="start-step-d">Jot a line — Relay quietly syncs the board.</span>
                  </button>
                  <button
                    className="start-step"
                    onClick={() => insertText("Break this goal into tasks for the team: ")}
                  >
                    <span className="start-step-n">Ask</span>
                    <span className="start-step-t">Hand Relay a goal</span>
                    <span className="start-step-d">It drafts tasks, records, even a deck — you publish.</span>
                  </button>
                  <button className="start-step" onClick={() => setView("boards")}>
                    <span className="start-step-n">Boards</span>
                    <span className="start-step-t">See the work</span>
                    <span className="start-step-d">Open the Kanban boards and everyone&apos;s tasks.</span>
                  </button>
                </div>
              </div>
            ) : null}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="msg user">
                  <span className="av" style={{ background: currentMember.color }}>
                    {initials(currentMember.name)}
                  </span>
                  <div className="msg-col">
                    <div className="bubble">
                      <RichText text={m.content} />
                    </div>
                    {m.createdAt ? <span className="msg-time">{fmtStamp(m.createdAt)}</span> : null}
                  </div>
                </div>
              ) : (
                <div key={i} className="msg ai">
                  <span className="av">
                    <RelayGlyph small />
                  </span>
                  <div className="msg-col">
                    <div className="bubble">
                      <RichText text={m.content} />
                    </div>
                    {m.createdAt ? <span className="msg-time">{fmtStamp(m.createdAt)}</span> : null}
                    {m.questions?.length ? (
                      <QuestionChecklist questions={m.questions} onSubmit={(t) => send(t)} disabled={sending} />
                    ) : null}
                    {m.suggestions?.length ? (
                      <div className="suggestions">
                        {m.suggestions.map((s, si) => (
                          <button key={si} className="sug-chip" onClick={() => insertText(s)} disabled={sending}>
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            )}

            {sending && (
              <div className="msg ai">
                <span className="av">
                  <RelayGlyph small />
                </span>
                <div className="bubble">
                  <span className="typing">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            )}


            {connector && (
              <div className="connector-card">
                <div className="lbl">⇄ Connector · needs your ok</div>
                <p>{connector.text}</p>
                <div className="row">
                  <button className="btn btn-primary" onClick={acceptConnector}>
                    Loop in {connector.target}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setConnector(null)}>
                    Not now
                  </button>
                </div>
              </div>
            )}
          </div>

          {input.includes("\n") && input.includes("**") ? (
            <div className="composer-hint">✨ Fill in what you know — Relay completes the rest when you send.</div>
          ) : null}
          {messages.length > 0 || compactions.length > 0 ? (
            <div className="compact-bar">
              <button
                className="compact-btn"
                onClick={compactNow}
                disabled={compacting || messages.length === 0}
                title="Fold this conversation into a summarized entry and start fresh. Relay pulls it back when it's relevant."
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {compacting ? "Compacting…" : "Compact"}
              </button>
              {compactions.length > 0 ? (
                <button className="compact-count" onClick={() => setCompactOpen(true)} title="View compacted context">
                  {compactions.length} compacted · Relay draws on these
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="composer">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoGrow(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Tell Relay what you did, ${currentMember.name}…`}
              rows={1}
            />
            <button className="send" onClick={() => send()} disabled={sending || !input.trim()} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M2 8h10M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          </>
          )}
        </section>

        {/* BOARD */}
        <section className="board">
          <div className="board-head">
            <div className="eyebrow">Project Memory · shared</div>
            <div className="proj">{state.project.name}</div>
            <div className="meta">
              {state.project.deadline ? `${state.project.deadline} · ` : ""}
              {state.members.length} people · {boards.length} board{boards.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="board-scroll">
            <div className="mywork-head">
              <span className="col-label">Your open work · {currentMember.name}</span>
              <button className="open-board" onClick={() => setView("boards")}>
                Boards
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M4 3.5 11 8l-7 4.5V3.5Z" fill="currentColor" />
                </svg>
              </button>
            </div>
            {myTasks.length ? (
              myTasks.map((t) => (
                <div key={t.id} className="mywork-item">
                  <TaskCard task={t} flash={isFlash(t)} onOpen={() => setDetail({ kind: "task", data: t })} />
                  <span className="mywork-board">{t.boardName}</span>
                </div>
              ))
            ) : (
              <p className="brief-empty">You&apos;re all clear — nothing outstanding. ✨</p>
            )}

            {state.knowledge.length > 0 && <div className="col-label">Shared knowledge</div>}
            {[...state.knowledge]
              .sort((a, b) => IMP_RANK[b.importance] - IMP_RANK[a.importance])
              .map((k) => (
                <div key={k.id} className={`knowledge imp-${k.importance}`}>
                  <div className="k-lbl">
                    <span>◆ {k.tag}</span>
                    {k.importance !== "normal" ? <ImportanceBadge level={k.importance} /> : null}
                  </div>
                  <div className="k-text">{k.text}</div>
                </div>
              ))}

            {state.updates.length > 0 && <div className="col-label">Work records</div>}
            {state.updates.slice(0, 6).map((u) => (
              <button key={u.id} className="timeline-item" onClick={() => setDetail({ kind: "update", data: u })}>
                <div className="ti-head">
                  {u.title} <span className={`pill ${statusToPill(u.status)}`}>{u.status}</span>
                </div>
                <div className="ti-meta">
                  {u.author ? `${u.author} · ` : ""}
                  {u.summary || "tap to open"}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
      )}

      {view === "boards" && (
        <div className="board-page">
          <div className="board-page-head">
            <button className="back-btn" onClick={() => setView("chat")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M10 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to chat
            </button>
            <div className="board-page-title">
              <span className="eyebrow">Team boards</span>
              <h2>{state.project.name}</h2>
            </div>
          </div>
          <div className="board-page-body">
            <div className="boards-grid">
              {boards.map((b) => {
                const done = b.tasks.filter((t) => t.status === "done").length;
                return (
                  <button
                    key={b.id}
                    className="board-card"
                    onClick={() => {
                      setActiveBoardId(b.id);
                      setView("board");
                    }}
                  >
                    <div className="board-card-name">{b.name}</div>
                    {b.deadline ? <div className="board-card-meta">{b.deadline}</div> : null}
                    <div className="progress">
                      <div className="track">
                        <div className="fill" style={{ width: `${b.progress}%` }} />
                      </div>
                      <div className="pct">
                        <span>{done}/{b.tasks.length} done</span>
                        <span>{b.progress}%</span>
                      </div>
                    </div>
                  </button>
                );
              })}
              <div className="board-card new">
                <div className="board-card-name">Start a new board</div>
                <input
                  className="d-input"
                  placeholder="Board name…"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createBoard();
                  }}
                />
                <button className="btn btn-primary btn-sm" onClick={() => createBoard()} disabled={!newBoardName.trim()}>
                  + Create board
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "board" && activeBoard && (
        <div className="board-page">
          <div className="board-page-head">
            <button className="back-btn" onClick={() => setView("boards")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M10 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              All boards
            </button>
            <div className="board-page-title">
              <span className="eyebrow">Board</span>
              <h2>{activeBoard.name}</h2>
            </div>
            <div className="board-page-progress">
              <div className="track">
                <div className="fill" style={{ width: `${activeBoard.progress}%` }} />
              </div>
              <span className="pct-inline">{activeBoard.progress}%</span>
            </div>
          </div>
          <div className="board-page-body">{kanban}</div>
        </div>
      )}

      {/* Free-floating windows — finished artifacts + editable drafts. Drag into the
          right sidebar to dock anywhere; tabs compress once several pile up. */}
      {(() => {
        const dockedCount = artifacts.filter((a) => a.docked).length;
        const compact = dockedCount > 5;
        return artifacts.map((a) =>
          a.docked ? (
            <div
              key={a.id}
              className={`artifact-dock${compact ? " compact" : ""}${a.draft ? " pending" : ""}`}
              style={{ top: a.dockY }}
              title={a.draft ? `Draft · ${a.title}` : a.title}
              onPointerDown={(e) => startArtDrag(e, a)}
              onPointerMove={onArtDragMove}
              onPointerUp={(e) => onArtDragUp(e, () => openArtifact(a.id))}
            >
              <span className="artifact-dock-icon">{windowIcon(a.kind)}</span>
              {!compact && <span className="artifact-dock-label">{a.title}</span>}
              {a.draft ? <span className="artifact-dock-dot" title="Unpublished draft" /> : null}
            </div>
          ) : a.draft ? (
            <DraftWindow
              key={a.id}
              a={a}
              draft={a.draft}
              members={state.members}
              publishing={publishing.has(a.id)}
              onPointerDownHead={(e) => startArtDrag(e, a)}
              onPointerMoveHead={onArtDragMove}
              onPointerUpHead={(e) => onArtDragUp(e)}
              onDock={() => setArtifacts((list) => list.map((x) => (x.id === a.id ? { ...x, docked: true, dockY: 120 } : x)))}
              onChange={(d) => updateDraft(a.id, d)}
              onPublish={() => publishDraft(a)}
              onDiscard={() => setArtifacts((list) => list.filter((x) => x.id !== a.id))}
            />
          ) : (
            <div key={a.id} className="artifact-window" style={{ left: a.x, top: a.y }}>
              <div
                className="artifact-head"
                onPointerDown={(e) => startArtDrag(e, a)}
                onPointerMove={onArtDragMove}
                onPointerUp={(e) => onArtDragUp(e)}
              >
                <span className="artifact-grip" aria-hidden>⋮⋮</span>
                <div className="artifact-title">
                  {a.title}
                  <span className="artifact-filename">{a.filename}</span>
                </div>
                <button
                  className="artifact-aside-btn"
                  title="Dock to sidebar"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setArtifacts((list) => list.map((x) => (x.id === a.id ? { ...x, docked: true, dockY: 120 } : x)))}
                >
                  ⇥
                </button>
              </div>
              <div className="artifact-body">
                <RichText text={a.markdown} />
              </div>
              <div className="artifact-foot">
                <button className="btn btn-primary btn-sm" onClick={() => downloadArtifact(a)}>
                  {a.pptxBase64 ? "Download .pptx" : "Download .md"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => copyArtifact(a)}>
                  {a.pptxBase64 ? "Copy outline" : "Copy"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setArtifacts((list) => list.filter((x) => x.id !== a.id))}>
                  Dismiss
                </button>
                <span className="artifact-hint">drag the header → dock in the sidebar</span>
              </div>
            </div>
          )
        );
      })()}

      {detail && (
        <DetailModal
          detail={detail}
          currentMemberName={currentMember.name}
          onClose={() => setDetail(null)}
          onSubmitProgress={submitProgress}
          onReview={reviewProgress}
        />
      )}

      {compactOpen && (
        <div className="modal-overlay" onClick={() => setCompactOpen(false)}>
          <div className="modal compact-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-head">
              <span className="modal-kind">Compacted context</span>
              <button className="modal-x" onClick={() => setCompactOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="compact-intro">
                Folded-away conversations. Relay reads these headings on each turn and pulls back only the ones
                relevant to what you&apos;re discussing now — so context stays light without losing anything.
              </p>
              {compactions.length === 0 ? (
                <p className="compact-empty">Nothing compacted yet. Hit <b>Compact</b> to fold a conversation away.</p>
              ) : (
                compactions.map((c) => {
                  const open = openCompactionId === c.id;
                  return (
                    <div key={c.id} className={`compact-item${open ? " open" : ""}`}>
                      <button className="compact-item-head" onClick={() => setOpenCompactionId(open ? null : c.id)}>
                        <span className="compact-caret">{open ? "▾" : "▸"}</span>
                        <span className="compact-item-main">
                          <span className="compact-item-heading">{c.heading}</span>
                          <span className="compact-item-summary">{c.summary}</span>
                        </span>
                        <span className="compact-item-time">{fmtStamp(c.createdAt)}</span>
                      </button>
                      {open ? (
                        <div className="compact-item-body">
                          <RichText text={c.content} />
                          <div className="compact-item-actions">
                            <button className="btn btn-ghost btn-sm" onClick={() => deleteCompaction(c.id)}>
                              Delete
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-head">
              <span className="modal-kind">Settings</span>
              <button className="modal-x" onClick={() => setSettingsOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="doc-title-row">
                <h3 className="doc-title">AI model</h3>
              </div>
              <p className="settings-note">
                Which model powers Relay. Current: <code>{state.project.model}</code>
              </p>
              <label className="d-lbl">Model</label>
              <input
                className="d-input"
                list="model-options"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveModel();
                }}
                placeholder="MiniMax-M2"
              />
              <datalist id="model-options">
                {availableModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {availableModels.length ? (
                <div className="settings-models">
                  {availableModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`model-chip${modelDraft === m ? " on" : ""}`}
                      onClick={() => setModelDraft(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="settings-note">Couldn&apos;t reach the provider to list models — you can still type an id above.</p>
              )}
              <p className="settings-note">
                {availableModels.length
                  ? `${availableModels.length} models detected from the provider. Pick one or type any id.`
                  : "Type a model id and Save."}
              </p>
              <button className="btn btn-primary" type="button" onClick={saveModel} disabled={!modelDraft.trim() || modelDraft === state.project.model}>
                Save model
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast${toast ? " show" : ""}`}>{toast}</div>
    </div>
  );
}

// The "In sync" panel — an always-current, ranked digest of what changed that
// touches you. The AI keeps it true; you glance instead of checking a bell.
const SYNC_ICON: Record<SyncItem["verdict"], string> = {
  deadline: "◷",
  unblocked: "✦",
  blocked: "⛔",
  assigned: "◉",
  reconcile: "⟳",
  fyi: "◆",
};

function SyncPanel({
  items,
  onOpenTask,
  onDismiss,
}: {
  items: SyncItem[];
  onOpenTask: (name: string) => void;
  onDismiss: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="sync-panel">
      <div className="sync-head">
        <span className="sync-title">In sync</span>
        <span className="sync-sub">what changed that touches you</span>
      </div>
      <div className="sync-list">
        {items.map((it) => (
          <div key={it.key} className={`sync-item v-${it.verdict}`}>
            <span className="sync-icon">{SYNC_ICON[it.verdict]}</span>
            <span className="sync-text">{it.text}</span>
            <span className="sync-actions">
              {it.taskName ? (
                <button className="sync-act" onClick={() => onOpenTask(it.taskName as string)}>
                  Open
                </button>
              ) : null}
              <button className="sync-x" title="Dismiss" onClick={() => onDismiss(it.key)}>
                ×
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  flash,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  task: TaskDTO;
  flash: boolean;
  onOpen: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <button
      className={`task${flash ? " flash" : ""}${draggable ? " draggable" : ""}`}
      onClick={onOpen}
      title="Open task spec"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="top">
        <span className="name">{task.name}</span>
        <span className={`pill ${task.status}`}>{STATUS_LABEL[task.status] ?? task.status}</span>
      </div>
      <div className="foot">
        {task.owner ? (
          <span className="owner">
            <i style={{ background: task.owner.color }}>{initials(task.owner.name)}</i>
            {task.owner.name}
          </span>
        ) : (
          <span className="owner">unassigned</span>
        )}
        {task.priority ? <PriorityChip level={task.priority} /> : null}
        {task.due ? <DueChip due={task.due} /> : null}
        {task.acceptanceCriteria.length ? (
          <span className="ac-count">✓ {task.acceptanceCriteria.length}</span>
        ) : null}
      </div>
    </button>
  );
}

// An editable, unpublished DRAFT window. The user tweaks the fields and hits
// Publish (→ /api/publish); nothing it describes is live until then.
function DraftWindow({
  a,
  draft,
  members,
  publishing,
  onPointerDownHead,
  onPointerMoveHead,
  onPointerUpHead,
  onDock,
  onChange,
  onPublish,
  onDiscard,
}: {
  a: Artifact;
  draft: DraftPayload;
  members: MemberDTO[];
  publishing: boolean;
  onPointerDownHead: (e: React.PointerEvent) => void;
  onPointerMoveHead: (e: React.PointerEvent) => void;
  onPointerUpHead: (e: React.PointerEvent) => void;
  onDock: () => void;
  onChange: (d: DraftPayload) => void;
  onPublish: () => void;
  onDiscard: () => void;
}) {
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="artifact-window draft" style={{ left: a.x, top: a.y }}>
      <div
        className="artifact-head"
        onPointerDown={onPointerDownHead}
        onPointerMove={onPointerMoveHead}
        onPointerUp={onPointerUpHead}
      >
        <span className="artifact-grip" aria-hidden>⋮⋮</span>
        <div className="artifact-title">
          {draftTitle(draft)}
          <span className="draft-tag">DRAFT · {DRAFT_KIND_LABEL[draft.kind]}</span>
        </div>
        <button className="artifact-aside-btn" title="Dock to sidebar" onPointerDown={stop} onClick={onDock}>
          ⇥
        </button>
      </div>

      <div className="artifact-body draft-body" onPointerDown={stop}>
        {draft.kind === "record" ? (
          <RecordEditor draft={draft} onChange={onChange} />
        ) : draft.kind === "tasks" ? (
          <TasksEditor draft={draft} members={members} onChange={onChange} />
        ) : draft.kind === "share" ? (
          <ShareEditor draft={draft} onChange={onChange} />
        ) : (
          <StatusEditor draft={draft} />
        )}
      </div>

      <div className="artifact-foot">
        <button className="btn btn-primary btn-sm" onClick={onPublish} disabled={publishing}>
          {publishing ? "Publishing…" : "Publish"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDiscard} disabled={publishing}>
          Discard
        </button>
        <span className="artifact-hint">nothing is live until you publish · drag header to dock</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="draft-field">
      <span className="draft-flbl">{label}</span>
      {children}
    </label>
  );
}

const RECORD_STATUSES = ["In progress", "Complete", "Blocked"];

function RecordEditor({ draft, onChange }: { draft: Extract<DraftPayload, { kind: "record" }>; onChange: (d: DraftPayload) => void }) {
  const u = draft.update;
  const set = (patch: Partial<typeof u>) => onChange({ ...draft, update: { ...u, ...patch }, title: patch.title ?? u.title });
  const statusOpts = RECORD_STATUSES.includes(u.status) ? RECORD_STATUSES : [u.status, ...RECORD_STATUSES];
  return (
    <div className="draft-form">
      <Field label="Title">
        <input className="d-input" value={u.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Status">
        <select className="d-input" value={u.status} onChange={(e) => set({ status: e.target.value })}>
          {statusOpts.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Summary">
        <textarea className="d-input" rows={2} value={u.summary ?? ""} onChange={(e) => set({ summary: e.target.value })} />
      </Field>
      <Field label="Details">
        <textarea className="d-input mono" rows={6} value={u.details ?? ""} onChange={(e) => set({ details: e.target.value })} />
      </Field>
      {draft.completesTask ? (
        <div className="draft-side-effect">On publish, also marks <b>{draft.completesTask}</b> done.</div>
      ) : null}
      {draft.connector ? (
        <div className="draft-side-effect">On publish, also notifies <b>{draft.connector.target}</b>.</div>
      ) : null}
    </div>
  );
}

function TasksEditor({
  draft,
  members,
  onChange,
}: {
  draft: Extract<DraftPayload, { kind: "tasks" }>;
  members: MemberDTO[];
  onChange: (d: DraftPayload) => void;
}) {
  const setTask = (i: number, patch: Partial<TaskDraft>) => {
    const tasks = draft.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t));
    onChange({ ...draft, tasks });
  };
  const removeTask = (i: number) => onChange({ ...draft, tasks: draft.tasks.filter((_, j) => j !== i) });
  const addTask = () => onChange({ ...draft, tasks: [...draft.tasks, { name: "New task", status: "new" }] });
  return (
    <div className="draft-form">
      {draft.board ? <div className="draft-side-effect">Board: <b>{draft.board}</b></div> : null}
      {draft.tasks.map((t, i) => (
        <div key={i} className="draft-task">
          <div className="draft-task-head">
            <input
              className="d-input"
              value={t.name}
              placeholder="Task name"
              onChange={(e) => setTask(i, { name: e.target.value })}
            />
            {draft.tasks.length > 1 ? (
              <button className="draft-x" title="Remove task" onClick={() => removeTask(i)}>×</button>
            ) : null}
          </div>
          <div className="draft-row">
            <Field label="Owner">
              <select
                className="d-input"
                value={t.owner ?? ""}
                onChange={(e) => setTask(i, { owner: e.target.value || undefined })}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                className="d-input"
                value={t.priority ?? ""}
                onChange={(e) => setTask(i, { priority: (e.target.value || undefined) as TaskDraft["priority"] })}
              >
                <option value="">—</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </Field>
            <Field label="Status">
              <select
                className="d-input"
                value={t.status ?? "new"}
                onChange={(e) => setTask(i, { status: e.target.value as TaskStatus })}
              >
                <option value="new">New</option>
                <option value="inprogress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
            </Field>
            <Field label="Due (optional)">
              <input
                type="date"
                className="d-input"
                value={t.due ?? ""}
                onChange={(e) => setTask(i, { due: e.target.value || undefined })}
              />
            </Field>
          </div>
          <Field label="Objective">
            <textarea
              className="d-input"
              rows={2}
              value={t.objective ?? ""}
              onChange={(e) => setTask(i, { objective: e.target.value })}
            />
          </Field>
          <Field label="Acceptance criteria (one per line)">
            <textarea
              className="d-input"
              rows={3}
              value={(t.acceptanceCriteria ?? []).join("\n")}
              onChange={(e) => setTask(i, { acceptanceCriteria: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm draft-add" onClick={addTask}>+ Add task</button>
    </div>
  );
}

function ShareEditor({ draft, onChange }: { draft: Extract<DraftPayload, { kind: "share" }>; onChange: (d: DraftPayload) => void }) {
  const s = draft.share;
  const set = (patch: Partial<typeof s>) => onChange({ ...draft, share: { ...s, ...patch }, title: `Share: ${patch.tag ?? s.tag}` });
  return (
    <div className="draft-form">
      <Field label="Tag">
        <input className="d-input" value={s.tag} onChange={(e) => set({ tag: e.target.value })} />
      </Field>
      <Field label="What the team should know">
        <textarea className="d-input" rows={4} value={s.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <Field label="Importance">
        <select
          className="d-input"
          value={s.importance ?? "normal"}
          onChange={(e) => set({ importance: e.target.value as Importance })}
        >
          <option value="normal">normal — useful, low-stakes</option>
          <option value="important">important — most people should notice</option>
          <option value="critical">critical — changes the plan / blocks people</option>
        </select>
      </Field>
      {draft.connector ? (
        <div className="draft-side-effect">On publish, also notifies <b>{draft.connector.target}</b>.</div>
      ) : null}
    </div>
  );
}

function StatusEditor({ draft }: { draft: Extract<DraftPayload, { kind: "status" }> }) {
  return (
    <div className="draft-form">
      <p className="draft-side-effect">Publishing applies these status changes to the board:</p>
      <ul className="draft-status-list">
        {draft.actions.map((act, i) => (
          <li key={i}>{"task" in act ? act.task : ""} → <b>{"status" in act ? act.status : ""}</b></li>
        ))}
      </ul>
    </div>
  );
}

const IMP_RANK: Record<Importance, number> = { normal: 0, important: 1, critical: 2 };

function statusToPill(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complet") || s.includes("done")) return "done";
  if (s.includes("block")) return "blocked";
  if (s.includes("progress")) return "inprogress";
  return "new";
}

function ImportanceBadge({ level }: { level: Importance }) {
  if (level === "normal") return null;
  return (
    <span className={`imp-badge imp-${level}`}>
      {level === "critical" ? "🔴 Critical" : "❗ Important"}
    </span>
  );
}

function PriorityChip({ level }: { level: Priority }) {
  return <span className={`prio prio-${level}`}>{level}</span>;
}

// Due-date chip: flags overdue/today/soon; a far-off date reads neutral.
function DueChip({ due }: { due: string }) {
  const s = dueState(due);
  const label = s === "overdue" ? "overdue" : s === "today" ? "today" : formatDue(due);
  return <span className={`due-chip due-${s}`}>◷ {label}</span>;
}

function DocSection({ label, body }: { label: string; body: string }) {
  return (
    <div className="doc-sec">
      <div className="doc-sec-h">{label}</div>
      <div className="doc-sec-b">
        <RichText text={body} />
      </div>
    </div>
  );
}

function DetailModal({
  detail,
  currentMemberName,
  onClose,
  onSubmitProgress,
  onReview,
}: {
  detail: Detail;
  currentMemberName: string;
  onClose: () => void;
  onSubmitProgress: (task: TaskDTO, status: TaskStatus, note: string, due?: string | null) => void;
  onReview: (payload: {
    taskName: string;
    objective?: string | null;
    acceptanceCriteria: string[];
    doneCriteria: string[];
    currentStatus: string;
    draftNote: string;
  }) => Promise<ProgressReview | null>;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <span className="modal-kind">{detail.kind === "task" ? "Task spec" : "Work record"}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {detail.kind === "task" ? (
          <TaskDetail
            t={detail.data}
            currentMemberName={currentMemberName}
            onSubmitProgress={onSubmitProgress}
            onReview={onReview}
          />
        ) : (
          <UpdateDetail u={detail.data} />
        )}
      </div>
    </div>
  );
}

function TaskDetail({
  t,
  currentMemberName,
  onSubmitProgress,
  onReview,
}: {
  t: TaskDTO;
  currentMemberName: string;
  onSubmitProgress: (task: TaskDTO, status: TaskStatus, note: string, due?: string | null) => void;
  onReview: (payload: {
    taskName: string;
    objective?: string | null;
    acceptanceCriteria: string[];
    doneCriteria: string[];
    currentStatus: string;
    draftNote: string;
  }) => Promise<ProgressReview | null>;
}) {
  const [status, setStatus] = useState<TaskStatus>(t.status);
  const [note, setNote] = useState("");
  const [due, setDue] = useState<string>(t.due ?? "");
  const [checks, setChecks] = useState<Set<number>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [comment, setComment] = useState<string | null>(null);
  const statuses: TaskStatus[] = ["inprogress", "blocked", "done"];
  const doneCount = checks.size;
  const total = t.acceptanceCriteria.length;
  const isMine = !t.owner || t.owner.name === currentMemberName;

  async function askAI() {
    setReviewing(true);
    setComment(null);
    try {
      const review = await onReview({
        taskName: t.name,
        objective: t.objective,
        acceptanceCriteria: t.acceptanceCriteria,
        doneCriteria: t.acceptanceCriteria.filter((_, i) => checks.has(i)),
        currentStatus: status,
        draftNote: note,
      });
      if (review) {
        setNote(review.reviewedNote);
        setStatus(review.suggestedStatus);
        setComment(review.comment);
      }
    } catch {
      setComment("Couldn't reach the AI just now — you can still submit.");
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="modal-body">
      <div className="doc-title-row">
        <h3 className="doc-title">{t.name}</h3>
        <span className={`pill ${t.status}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
      </div>
      <div className="doc-meta-row">
        {t.owner ? (
          <span className="owner">
            <i style={{ background: t.owner.color }}>{initials(t.owner.name)}</i>
            {t.owner.name}
          </span>
        ) : (
          <span className="owner">unassigned</span>
        )}
        {t.priority ? <PriorityChip level={t.priority} /> : null}
        {t.due ? <DueChip due={t.due} /> : null}
      </div>
      {t.objective ? <DocSection label="Objective" body={t.objective} /> : null}
      {t.acceptanceCriteria.length ? (
        <div className="doc-sec">
          <div className="doc-sec-h">
            Acceptance criteria {total ? <span className="ac-progress">{doneCount}/{total} done</span> : null}
          </div>
          <ul className="ac-list checkable">
            {t.acceptanceCriteria.map((c, i) => (
              <li key={i} className={checks.has(i) ? "checked" : ""}>
                <button
                  className="qcheck"
                  type="button"
                  aria-label="Toggle done"
                  onClick={() =>
                    setChecks((prev) => {
                      const n = new Set(prev);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                >
                  {checks.has(i) ? (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5 6.5 12 13 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </button>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {t.dependencies ? <DocSection label="Dependencies" body={t.dependencies} /> : null}

      {/* progress check-in */}
      <div className="checkin">
        <div className="doc-sec-h">
          Progress check-in
          {!isMine ? (
            <span className="checkin-hint"> — {t.owner?.name ?? "someone"}&apos;s task · needs their approval</span>
          ) : null}
        </div>
        <div className="checkin-status">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              className={`status-opt ${s}${status === s ? " active" : ""}`}
              onClick={() => setStatus(s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <textarea
          className="checkin-note"
          placeholder="What's the progress?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
        {isMine ? (
          <label className="checkin-due">
            <span>Due date (optional)</span>
            <div className="checkin-due-row">
              <input type="date" className="d-input" value={due} onChange={(e) => setDue(e.target.value)} />
              {due ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDue("")}>
                  Clear
                </button>
              ) : null}
            </div>
          </label>
        ) : null}
        {comment ? <div className="ai-review">✨ {comment}</div> : null}
        <div className="checkin-actions">
          <button className="btn btn-ghost" type="button" onClick={askAI} disabled={reviewing}>
            {reviewing ? "Reviewing…" : "✨ AI review & polish"}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => onSubmitProgress(t, status, note, isMine ? due : undefined)}
            disabled={status === t.status && !note.trim() && (due || "") === (t.due || "")}
          >
            {isMine ? "Submit progress" : "Request change"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdateDetail({ u }: { u: UpdateDTO }) {
  return (
    <div className="modal-body">
      <div className="doc-title-row">
        <h3 className="doc-title">{u.title}</h3>
        <span className={`pill ${statusToPill(u.status)}`}>{u.status}</span>
      </div>
      <div className="doc-meta-row">
        {u.author ? <span className="doc-author">{u.author}</span> : null}
        <span className="doc-date">{new Date(u.createdAt).toLocaleString()}</span>
      </div>
      {u.summary ? <p className="doc-summary">{u.summary}</p> : null}
      {u.details ? <DocSection label="Details" body={u.details} /> : null}
      {u.changes ? <DocSection label="Changes" body={u.changes} /> : null}
      {u.impact ? <DocSection label="Impact" body={u.impact} /> : null}
      {u.artifacts.length ? (
        <div className="doc-sec">
          <div className="doc-sec-h">Artifacts</div>
          <div className="doc-chips">
            {u.artifacts.map((a, i) => (
              <span key={i} className="doc-chip">
                {a}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {u.nextSteps ? <DocSection label="Next steps" body={u.nextSteps} /> : null}
    </div>
  );
}

// Inline markdown: **bold**, *italic*, `code`.
function inline(s: string): React.ReactNode[] {
  return s.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

// Lightweight, safe markdown renderer: headings, paragraphs, bullet/ordered lists, inline styles.
function RichText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;
  const flush = (key: string) => {
    if (list.length) {
      const items = list.map((li, i) => <li key={i}>{inline(li)}</li>);
      blocks.push(
        ordered ? (
          <ol key={"l" + key}>{items}</ol>
        ) : (
          <ul key={"l" + key}>{items}</ul>
        )
      );
      list = [];
    }
  };
  lines.forEach((ln, i) => {
    const t = ln.trim();
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (/^[-*]\s+/.test(t)) {
      if (list.length && ordered) flush("o" + i);
      ordered = false;
      list.push(t.replace(/^[-*]\s+/, ""));
    } else if (/^\d+\.\s+/.test(t)) {
      if (list.length && !ordered) flush("u" + i);
      ordered = true;
      list.push(t.replace(/^\d+\.\s+/, ""));
    } else if (h) {
      flush(String(i));
      blocks.push(
        <div key={i} className={`md-h md-h${h[1].length}`}>
          {inline(h[2])}
        </div>
      );
    } else {
      flush(String(i));
      if (t) blocks.push(<p key={i}>{inline(t)}</p>);
    }
  });
  flush("end");
  return <>{blocks}</>;
}

// Coaching questions rendered as an answer form — one field per question,
// then one button sends all your answers back to the AI at once.
function QuestionChecklist({
  questions,
  onSubmit,
  disabled,
}: {
  questions: string[];
  onSubmit: (text: string) => void;
  disabled: boolean;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);
  const answered = Object.values(answers).filter((a) => a.trim()).length;

  function submit() {
    const lines = questions
      .map((q, i) => {
        const a = (answers[i] || "").trim();
        return a ? `${q.replace(/\*\*/g, "").trim()} — ${a}` : null;
      })
      .filter(Boolean);
    if (!lines.length) return;
    onSubmit(lines.join("\n"));
    setSent(true);
  }

  if (sent) return null;

  return (
    <div className="qform">
      <div className="qform-lbl">Answer what you can:</div>
      {questions.map((q, i) => {
        const filled = !!(answers[i] || "").trim();
        return (
          <div className={`qrow${filled ? " filled" : ""}`} key={i}>
            <div className="qrow-q">
              <span className="qbox">
                {filled ? (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8.5 6.5 12 13 4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              <div className="qtext">
                <RichText text={q} />
              </div>
            </div>
            <input
              className="qans"
              placeholder="Your answer…"
              value={answers[i] || ""}
              disabled={disabled}
              onChange={(e) => setAnswers((p) => ({ ...p, [i]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        );
      })}
      <button className="btn btn-primary btn-sm qform-send" type="button" disabled={disabled || answered === 0} onClick={submit}>
        Send {answered > 0 ? `${answered} answer${answered > 1 ? "s" : ""}` : "answers"}
      </button>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  inprogress: "In progress",
  blocked: "Blocked",
  done: "Complete",
};

function BriefingCard({
  b,
  name,
  openTasks,
  onInsert,
  onOpenTask,
  onResolve,
  disabled,
}: {
  b: Briefing;
  name: string;
  openTasks: { name: string; status: TaskStatus; note: string | null }[];
  onInsert: (s: string) => void;
  onOpenTask: (name: string) => void;
  onResolve: (id: string, decision: "approve" | "decline") => void;
  disabled: boolean;
}) {
  const caughtUp = b.newUpdates.length === 0 && b.newKnowledge.length === 0;
  return (
    <div className="msg ai">
      <span className="av">
        <RelayGlyph small />
      </span>
      <div className="msg-col">
        <div className="bubble briefing">
          <p className="brief-intro">
            Hey <strong>{name}</strong> 👋 here&apos;s where things stand.
          </p>

          <div className="brief-sec">
            <div className="brief-h">
              <span className="brief-dot warn" /> On your plate
            </div>
            {openTasks.length ? (
              <ul className="brief-list">
                {openTasks.map((t, i) => (
                  <li key={i}>
                    <button className="brief-task" onClick={() => onOpenTask(t.name)} type="button" title="Open & check in">
                      <span className={`pill ${t.status}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                      <span className="bl-name">{t.name}</span>
                      <span className="brief-open">check in →</span>
                    </button>
                    {t.note ? <span className="bl-note">{t.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="brief-empty">Nothing outstanding — you&apos;re all clear. ✨</p>
            )}
          </div>

          {b.requests.length ? (
            <div className="brief-sec">
              <div className="brief-h">
                <span className="brief-dot bad" /> Change requests for you
              </div>
              <ul className="brief-list">
                {b.requests.map((r) => (
                  <li key={r.id} className="req-item">
                    <span className="bl-name">
                      {r.requestedBy ?? "Someone"} wants <strong>{r.taskName}</strong> →{" "}
                      <span className={`pill ${r.proposedStatus}`}>{STATUS_LABEL[r.proposedStatus] ?? r.proposedStatus}</span>
                    </span>
                    {r.note ? <span className="bl-note">“{r.note}”</span> : null}
                    <span className="req-actions">
                      <button className="btn btn-primary btn-sm" type="button" disabled={disabled} onClick={() => onResolve(r.id, "approve")}>
                        Approve
                      </button>
                      <button className="btn btn-ghost btn-sm" type="button" disabled={disabled} onClick={() => onResolve(r.id, "decline")}>
                        Decline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="brief-sec">
            <div className="brief-h">
              <span className="brief-dot ai" /> While you were away
            </div>
            {caughtUp ? (
              <p className="brief-empty">All caught up — nothing new since your last visit.</p>
            ) : (
              <ul className="brief-list">
                {b.newKnowledge.map((k, i) => (
                  <li key={"k" + i} className={`brief-news imp-${k.importance}`}>
                    <span className="bn-top">
                      <span className="k-tag">{k.tag}</span>
                      {k.importance !== "normal" ? <ImportanceBadge level={k.importance} /> : null}
                    </span>
                    <span className="bl-name news-text">{k.text}</span>
                  </li>
                ))}
                {b.newUpdates.map((u, i) => (
                  <li key={"u" + i}>
                    <span className="bl-name">
                      {u.author ? `${u.author}: ` : ""}
                      {u.title} — {u.status}
                    </span>
                    {u.summary ? <span className="bl-note">{u.summary}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="suggestions">
          {ENTRY_TEMPLATES.map((e, i) => (
            <button key={i} className="sug-chip" onClick={() => onInsert(e.template)} disabled={disabled}>
              {e.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1.2" y="1.2" width="29.6" height="29.6" rx="8" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="9" cy="16" r="3" fill="var(--accent)" />
      <circle cx="23" cy="9" r="3" fill="var(--ai)" />
      <circle cx="23" cy="23" r="3" fill="var(--ai)" />
      <path d="M11.6 14.6 20.4 10.2M11.6 17.4 20.4 21.8" stroke="var(--ai)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RelayGlyph({ small }: { small?: boolean }) {
  const s = small ? 13 : 15;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5 14 8l-6 6.5L2 8l6-6.5Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function DiamondIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5 14 8l-6 6.5L2 8l6-6.5Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
