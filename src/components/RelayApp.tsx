"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
  QuestionDTO,
  SourceFileDTO,
  SourceFolderDTO,
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

// Small line icons for per-message actions.
const IconCopy = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M11.5 2.5 13.5 4.5 6 12l-3 1 1-3 7.5-7.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);
const IconThumbUp = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M5 7 8 2c.9 0 1.5.7 1.3 1.6L9 6h3.2c.9 0 1.5.8 1.3 1.6l-1 4c-.1.7-.8 1.1-1.5 1.1H5V7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <rect x="2.5" y="7" width="2.5" height="5.7" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);
const IconThumbDown = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M11 9 8 14c-.9 0-1.5-.7-1.3-1.6L7 10H3.8c-.9 0-1.5-.8-1.3-1.6l1-4C3.6 3.7 4.3 3.3 5 3.3h6V9Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <rect x="11" y="3.3" width="2.5" height="5.7" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);
const IconRegen = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M13 8a5 5 0 1 1-1.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M13 2.5V5H10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Upload cap — stay under the serverless request-body limit (~4.5 MB on Vercel).
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// Compact relative time for workstream cards ("now", "2h", "3d", "1w").
function relTime(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d`;
  return `${Math.floor(d / 7)}w`;
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
  id?: string; // persisted message id (present once saved server-side)
  role: "user" | "assistant";
  content: string;
  questions?: string[];
  suggestions?: string[];
  createdAt?: string;
  feedback?: number; // thumbs: -1 down, 1 up (assistant messages)
  truncated?: boolean; // the model hit the token cap — offer "Continue"
  streaming?: boolean; // currently being filled in token-by-token
}

// A named chat thread in the member's private workspace, scoped to a workstream.
type ConversationDTO = { id: string; title: string; boardId: string | null; updatedAt: string };

// The final event of a streamed chat turn.
type StreamDone = {
  turn: { reply: string; stage?: string; questions?: string[]; suggestions?: string[] };
  messageId: string;
  userMessageId?: string | null;
  conversationId?: string;
  append?: boolean;
  truncated?: boolean;
  drafts?: DraftPayload[];
  artifacts?: ArtifactDTO[];
  asked?: number;
  state?: ProjectState;
};
type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "error"; error: string }
  | ({ type: "done" } & StreamDone);

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

// The signed-in user + the workspaces they belong to. Identity comes from the server
// (session cookie); the "acting as" demo switcher is gone — you are your account.
type Workspace = { id: string; name: string; memberId: string; role: string | null; admin: boolean; inviteCode: string };
type Session = { user: { id: string; name: string; email: string }; workspaces: Workspace[]; activeWorkspaceId: string | null };

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
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [wsAction, setWsAction] = useState<null | "new" | "join">(null);
  const [sourceFiles, setSourceFiles] = useState<SourceFileDTO[]>([]);
  const [sourceFolders, setSourceFolders] = useState<SourceFolderDTO[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Files attached to the next chat message: already committed to Sources, waiting
  // to be sent so the agent analyzes them in that turn.
  const [pendingAttachments, setPendingAttachments] = useState<SourceFileDTO[]>([]);
  // Named chat threads (per workstream) + the active one.
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [convListOpen, setConvListOpen] = useState(false); // thread sidebar (mobile/toggle)
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  // Editing a previously-sent user message.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  // In-conversation search + scroll affordance.
  const [chatQuery, setChatQuery] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  // Streaming state + the controller that lets "Stop" abort the current turn.
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
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
  // On phones the three chat-view columns (rail / chat / memory) become separate
  // full-screen pages, switched by the bottom nav. Ignored on desktop (all show).
  const [mobileTab, setMobileTab] = useState<"streams" | "chat" | "memory">("chat");
  const [activeBoardId, setActiveBoardId] = useState<string>("");
  const [newBoardName, setNewBoardName] = useState("");
  const [syncItems, setSyncItems] = useState<SyncItem[]>([]);
  const [questions, setQuestions] = useState<QuestionDTO[]>([]);
  const [questionsOpen, setQuestionsOpen] = useState(false);
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
  const attachInputRef = useRef<HTMLInputElement>(null);

  const currentMember = state?.members.find((m) => m.id === memberId);
  const activeWs =
    session?.workspaces.find((w) => w.memberId === memberId) ??
    session?.workspaces.find((w) => w.id === session?.activeWorkspaceId) ??
    session?.workspaces[0];

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const flashByNames = (names: string[]) => {
    setFlash(names.map((n) => n.toLowerCase()));
    window.setTimeout(() => setFlash([]), 1700);
  };

  // Who am I? Loads the session + the workspaces I belong to. Drives the auth gate.
  const refreshMe = useCallback(async (): Promise<Session | null> => {
    try {
      const d = await fetch("/api/auth/me").then((r) => r.json());
      setGoogleEnabled(!!d.googleEnabled);
      if (!d.user) {
        setSession(null);
        setAuthLoading(false);
        return null;
      }
      const sess: Session = {
        user: d.user,
        workspaces: d.workspaces ?? [],
        activeWorkspaceId: d.activeWorkspaceId ?? null,
      };
      setSession(sess);
      setAuthLoading(false);
      return sess;
    } catch (e) {
      setError(String(e));
      setAuthLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // When the session (or active workspace) resolves, become the right member. Setting
  // memberId triggers loadMember below, which loads that workspace's whole context.
  useEffect(() => {
    if (!session?.user) return;
    const ws =
      session.workspaces.find((w) => w.id === session.activeWorkspaceId) ?? session.workspaces[0];
    if (ws) {
      setMemberId(ws.memberId);
    } else {
      // No workspaces yet → onboarding screen; nothing to load.
      setMemberId("");
      setState(null);
    }
  }, [session]);

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
      fetch(`/api/question?memberId=${id}`).then((r) => r.json()),
      fetch(`/api/files`).then((r) => r.json()),
    ]).then(([s, l, n, c, sy, qs, fl]) => {
      if (!s.error) {
        setState(s.state);
        // Chat thread is loaded by the activeBoardId effect (loadThreadsForBoard).
        // Land on a valid board for this workspace (the active one may not exist here).
        const bs = s.state?.boards ?? [];
        setActiveBoardId((prev) => (bs.some((b: { id: string }) => b.id === prev) ? prev : bs[0]?.id ?? ""));
      }
      if (l && !l.error) setLogEntries(l.entries ?? []);
      if (n && !n.error) {
        setNotifications(n.notifications ?? []);
        setUnread(n.unread ?? 0);
      }
      if (c && !c.error) setCompactions(c.entries ?? []);
      if (sy && !sy.error) setSyncItems(sy.items ?? []);
      if (qs && !qs.error) setQuestions(qs.questions ?? []);
      if (fl && !fl.error) { setSourceFiles(fl.files ?? []); setSourceFolders(fl.folders ?? []); }

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

      // Reconciliation (AI-judged): flag any active task that recent team notes may
      // have made stale, and fold the result into the feed.
      fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: id }),
      })
        .then((r) => r.json())
        .then((rc) => {
          if (rc && Array.isArray(rc.items)) setSyncItems(rc.items);
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

  const refreshQuestions = useCallback(() => {
    if (!memberId) return;
    fetch(`/api/question?memberId=${memberId}`)
      .then((r) => r.json())
      .then((qs) => {
        if (qs && !qs.error) setQuestions(qs.questions ?? []);
      })
      .catch(() => {});
  }, [memberId]);

  async function createQuestion(payload: {
    text: string;
    audience: "specific" | "everyone";
    visibility: "private" | "team";
    targetIds: string[];
    answerType: "open" | "yesno";
    branchYes?: BoardAction[];
    branchNo?: BoardAction[];
  }) {
    const res = await fetch("/api/question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ askerId: memberId, boardId: activeBoardId, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't post the question");
    refreshQuestions();
    showToast("Question posted");
  }

  async function answerQuestion(questionId: string, answerRaw: string, choice?: "yes" | "no") {
    const res = await fetch("/api/question/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, memberId, answerRaw, choice }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't send the answer");
    refreshQuestions();
    if (data.fired?.length) {
      loadMember(memberId); // a branch changed the board
      showToast(data.fired.join(" · "));
    } else {
      showToast("Answer sent");
    }
  }

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

  // --- Conversation threads ---

  const loadConvList = useCallback(async (boardId: string) => {
    if (!boardId) return;
    try {
      const r = await fetch(`/api/conversation?boardId=${boardId}`).then((res) => res.json());
      if (!r.error) setConversations(r.conversations ?? []);
    } catch {
      /* non-critical */
    }
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setConvListOpen(false);
    setEditingId(null);
    try {
      const r = await fetch(`/api/conversation/${id}`).then((res) => res.json());
      if (!r.error) setMessages(r.messages ?? []);
    } catch {
      /* non-critical */
    }
  }, []);

  // Load the threads for a workstream and open the most recent one (or fall back to
  // any legacy messages not yet grouped into a thread).
  const loadThreadsForBoard = useCallback(
    async (boardId: string) => {
      if (!boardId) return;
      try {
        const r = await fetch(`/api/conversation?boardId=${boardId}`).then((res) => res.json());
        const convs: ConversationDTO[] = r.conversations ?? [];
        setConversations(convs);
        if (convs.length) {
          await openConversation(convs[0].id);
        } else {
          setConversationId("");
          const s = await fetch(`/api/state?boardId=${boardId}`).then((res) => res.json());
          if (!s.error) {
            setMessages(s.messages ?? []);
            if (s.conversationId) setConversationId(s.conversationId);
          }
        }
      } catch {
        /* non-critical */
      }
    },
    [openConversation]
  );

  // Swap the chat thread whenever the active workstream (or identity) changes.
  useEffect(() => {
    if (memberId && activeBoardId) loadThreadsForBoard(activeBoardId);
  }, [memberId, activeBoardId, loadThreadsForBoard]);

  async function newConversation() {
    setMode("chat");
    try {
      const r = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: activeBoardId }),
      }).then((res) => res.json());
      if (r.conversation) {
        setConversations((c) => [r.conversation, ...c]);
        setConversationId(r.conversation.id);
        setMessages([]);
        setConvListOpen(false);
        setEditingId(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renameConversation(id: string, title: string) {
    const clean = title.trim();
    setRenamingId(null);
    if (!clean) return;
    setConversations((c) => c.map((x) => (x.id === id ? { ...x, title: clean } : x)));
    try {
      await fetch(`/api/conversation/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: clean }),
      });
    } catch {
      /* non-critical */
    }
  }

  async function deleteConversation(id: string) {
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    try {
      await fetch(`/api/conversation/${id}`, { method: "DELETE" });
    } catch {
      /* non-critical */
    }
    if (conversationId === id) {
      if (remaining.length) openConversation(remaining[0].id);
      else {
        setConversationId("");
        setMessages([]);
      }
    }
  }

  // --- One agent turn (fresh message, regenerate, edit-and-rerun, or continue) ---

  async function runTurn(opts: {
    text?: string;
    attachments?: SourceFileDTO[];
    regenerate?: boolean;
    editMessageId?: string;
    cont?: boolean;
  }) {
    if (sending || !memberId) return;
    const { regenerate, editMessageId, cont } = opts;
    const attachments = opts.attachments ?? [];
    const text = (opts.text ?? "").trim();
    if (!text && attachments.length === 0 && !regenerate && !cont) return;
    setError(null);

    const attachedFileIds = attachments.map((f) => f.id);
    const attachNote = attachments.length
      ? `\n\n[Attached files: ${attachments.map((f) => f.name).join(", ")}]`
      : "";
    const displayText = (text || (attachments.length ? "Please analyze the attached file(s)." : "")) + attachNote;

    if (regenerate) {
      // Drop the trailing assistant bubble(s); we'll answer the last user turn again.
      setMessages((m) => {
        const c = [...m];
        while (c.length && c[c.length - 1].role === "assistant") c.pop();
        return c;
      });
    } else if (!cont) {
      setMessages((m) => [
        ...m.map((x) => (x.role === "assistant" ? { ...x, suggestions: undefined } : x)),
        { role: "user", content: displayText, createdAt: new Date().toISOString() },
      ]);
    }

    setSending(true);
    setStreaming(false);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // Continue mode appends onto the existing last assistant bubble.
    const base = cont ? [...messages].reverse().find((x) => x.role === "assistant")?.content ?? "" : "";
    let acc = "";

    const applyDelta = (delta: string) => {
      acc += delta;
      setStreaming(true);
      setMessages((m) => {
        const c = [...m];
        if (cont) {
          for (let i = c.length - 1; i >= 0; i--) {
            if (c[i].role === "assistant") {
              c[i] = { ...c[i], content: `${base}\n\n${acc}`.trim(), streaming: true };
              break;
            }
          }
        } else {
          const last = c[c.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            c[c.length - 1] = { ...last, content: acc };
          } else {
            c.push({ role: "assistant", content: acc, streaming: true, createdAt: new Date().toISOString() });
          }
        }
        return c;
      });
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          memberId,
          message: text,
          boardId: activeBoardId,
          conversationId: conversationId || undefined,
          attachedFileIds,
          regenerate,
          editMessageId,
          continue: cont,
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done: StreamDone | null = null;
      for (;;) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }
          if (evt.type === "delta") applyDelta(evt.text);
          else if (evt.type === "error") throw new Error(evt.error);
          else if (evt.type === "done") done = evt;
        }
      }
      if (!done) throw new Error("The response ended unexpectedly.");
      const data = done;
      const turn = data.turn;
      if (data.conversationId) setConversationId(data.conversationId);

      setMessages((m) => {
        const c = [...m];
        // Stamp the id onto the newest un-id'd user bubble (needed for edit).
        if (data.userMessageId) {
          const uid = data.userMessageId;
          for (let i = c.length - 1; i >= 0; i--) {
            if (c[i].role === "user" && !c[i].id) {
              c[i] = { ...c[i], id: uid };
              break;
            }
          }
        }
        const finalContent = cont ? `${base}\n\n${turn.reply}`.trim() : turn.reply;
        let li = -1;
        for (let i = c.length - 1; i >= 0; i--) {
          if (c[i].role === "assistant") {
            li = i;
            break;
          }
        }
        const finalized: UIMessage = {
          id: data.messageId,
          role: "assistant",
          content: finalContent,
          questions: turn.questions?.length ? turn.questions : undefined,
          suggestions: turn.suggestions?.length ? turn.suggestions : undefined,
          truncated: !!data.truncated,
          streaming: false,
          createdAt: (li >= 0 ? c[li].createdAt : undefined) ?? new Date().toISOString(),
        };
        if (li >= 0 && c[li].streaming) c[li] = { ...c[li], ...finalized };
        else c.push(finalized);
        return c;
      });

      if (data.state) setState(data.state);
      addDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      addArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
      if (data.asked) {
        showToast(data.asked === 1 ? "Question sent" : `${data.asked} questions sent`);
        refreshQuestions();
      }
      refreshSync();
      loadConvList(activeBoardId);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // Keep whatever streamed in; just stop the spinner.
        setMessages((m) => m.map((x) => (x.streaming ? { ...x, streaming: false } : x)));
      } else {
        setError((e as Error).message);
      }
    } finally {
      setSending(false);
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    // Attachments (from the composer) only ride along with a fresh message, not a
    // quick-reply/template send that passes textArg.
    const attachments = textArg === undefined ? pendingAttachments : [];
    if ((!text && attachments.length === 0) || sending || !memberId) return;
    setInput("");
    setPendingAttachments([]);
    if (inputRef.current) inputRef.current.style.height = "auto";
    return runTurn({ text, attachments });
  }

  function regenerate() {
    runTurn({ regenerate: true });
  }

  function continueGenerating() {
    runTurn({ cont: true });
  }

  function saveEdit() {
    const id = editingId;
    const text = editingText.trim();
    if (!id || !text) {
      setEditingId(null);
      return;
    }
    setEditingId(null);
    setEditingText("");
    // Truncate to before the edited message, then re-run with the new text.
    setMessages((m) => {
      const idx = m.findIndex((x) => x.id === id);
      return idx >= 0 ? m.slice(0, idx) : m;
    });
    runTurn({ text, editMessageId: id });
  }

  function copyMessage(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => showToast("Copied"),
      () => setError("Couldn't copy to clipboard")
    );
  }

  async function setMessageFeedback(id: string, value: number) {
    const current = messages.find((x) => x.id === id)?.feedback;
    const next = current === value ? 0 : value; // toggle off if already set
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, feedback: next || undefined } : x)));
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id, value: next }),
      });
    } catch {
      /* non-critical */
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

  // --- Accounts & workspaces ---

  async function switchWorkspace(id: string) {
    if (id === session?.activeWorkspaceId) {
      setWsMenuOpen(false);
      return;
    }
    setWsMenuOpen(false);
    try {
      const res = await fetch("/api/workspace/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await refreshMe();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createWorkspace(name: string, role?: string) {
    const res = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't create workspace");
    setWsAction(null);
    await refreshMe();
    showToast("Workspace created");
  }

  async function joinWorkspace(inviteCode: string, role?: string) {
    const res = await fetch("/api/workspace/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't join workspace");
    setWsAction(null);
    await refreshMe();
    showToast("Joined workspace");
  }

  async function logout() {
    setUserMenuOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setSession(null);
    setState(null);
    setMemberId("");
    setMessages([]);
  }

  // --- Source-of-truth files ---

  // Attach files to the pending message: upload (commit to Sources) right away, then
  // stage them as chips so the next send tells the agent to analyze them.
  async function attachToMessage(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const all = Array.from(fileList);
    const tooBig = all.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const ok = all.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      setError(
        tooBig.length === 1
          ? `“${tooBig[0].name}” is ${fmtBytes(tooBig[0].size)} — over the 4 MB limit.`
          : `${tooBig.length} files are over the 4 MB limit.`
      );
    } else {
      setError(null);
    }
    if (!ok.length) return;
    setUploading(true);
    try {
      for (const file of ok) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/files", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({} as { error?: string; file?: SourceFileDTO }));
        if (!res.ok) throw new Error(data.error || `Couldn't attach ${file.name}${res.status === 413 ? " — file too large" : ""}`);
        if (data.file) {
          setSourceFiles((prev) => [data.file as SourceFileDTO, ...prev]);
          setPendingAttachments((prev) => [...prev, data.file as SourceFileDTO]);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function uploadFiles(fileList: FileList | null, folderId: string | null = null) {
    if (!fileList || fileList.length === 0) return;
    const all = Array.from(fileList);
    const tooBig = all.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const ok = all.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      setError(
        tooBig.length === 1
          ? `“${tooBig[0].name}” is ${fmtBytes(tooBig[0].size)} — over the 4 MB limit, so it wasn't uploaded.`
          : `${tooBig.length} files are over the 4 MB limit and weren't uploaded.`
      );
    } else {
      setError(null);
    }
    if (!ok.length) return;
    setUploading(true);
    try {
      let added = 0;
      for (const file of ok) {
        const fd = new FormData();
        fd.append("file", file);
        if (folderId) fd.append("folderId", folderId);
        const res = await fetch("/api/files", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({} as { error?: string; file?: SourceFileDTO }));
        if (!res.ok) throw new Error(data.error || `Couldn't upload ${file.name}${res.status === 413 ? " — file too large" : ""}`);
        if (data.file) setSourceFiles((prev) => [data.file as SourceFileDTO, ...prev]);
        added++;
      }
      if (added) showToast(added === 1 ? "File added to Sources" : `${added} files added`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function deleteSourceFile(id: string) {
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Couldn't remove that file");
      setSourceFiles((prev) => prev.filter((f) => f.id !== id));
      showToast("Removed from Sources");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // --- Source tree: folders + move/rename ---

  async function createFolder(name: string, parentId: string | null) {
    const clean = name.trim();
    if (!clean) return;
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clean, parentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create folder");
      setSourceFolders((prev) => [...prev, data.folder]);
      showToast("Folder created");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renameFolder(id: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    setSourceFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: clean } : f)));
    try {
      await fetch(`/api/folders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean }) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteFolder(id: string) {
    // Remove the folder and its whole subtree from local state (server cascades).
    const subtree = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of sourceFolders) {
        if (f.parentId && subtree.has(f.parentId) && !subtree.has(f.id)) { subtree.add(f.id); grew = true; }
      }
    }
    setSourceFolders((prev) => prev.filter((f) => !subtree.has(f.id)));
    setSourceFiles((prev) => prev.filter((f) => !(f.folderId && subtree.has(f.folderId))));
    try {
      const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Couldn't delete folder");
      showToast("Folder deleted");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function moveNode(kind: "file" | "folder", id: string, targetFolderId: string | null) {
    if (kind === "folder") {
      if (id === targetFolderId) return;
      setSourceFolders((prev) => prev.map((f) => (f.id === id ? { ...f, parentId: targetFolderId } : f)));
      try {
        const res = await fetch(`/api/folders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: targetFolderId }) });
        if (!res.ok) throw new Error((await res.json()).error || "Couldn't move folder");
      } catch (e) {
        setError((e as Error).message);
        refreshSources();
      }
    } else {
      setSourceFiles((prev) => prev.map((f) => (f.id === id ? { ...f, folderId: targetFolderId } : f)));
      try {
        const res = await fetch(`/api/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: targetFolderId }) });
        if (!res.ok) throw new Error((await res.json()).error || "Couldn't move file");
      } catch (e) {
        setError((e as Error).message);
        refreshSources();
      }
    }
  }

  async function renameSourceFile(id: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    setSourceFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name: clean } : f)));
    try {
      await fetch(`/api/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean }) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function refreshSources() {
    try {
      const r = await fetch("/api/files").then((res) => res.json());
      if (!r.error) { setSourceFiles(r.files ?? []); setSourceFolders(r.folders ?? []); }
    } catch {
      /* non-critical */
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

  if (authLoading) {
    return <div className="loading-full">// connecting to Relay…</div>;
  }
  if (!session?.user) {
    return <AuthScreen onAuthed={refreshMe} googleEnabled={googleEnabled} />;
  }
  if (session.workspaces.length === 0) {
    return (
      <WorkspaceOnboarding
        userName={session.user.name}
        onCreate={createWorkspace}
        onJoin={joinWorkspace}
        onLogout={logout}
      />
    );
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
        <div className="ws-switch">
          <button className="ws-pill" onClick={() => setWsMenuOpen((v) => !v)} title="Switch workspace">
            <span className="ws-dot" style={{ background: activeWs?.inviteCode ? "var(--accent)" : "var(--accent)" }} />
            <span className="ws-name">{activeWs?.name ?? state.project.name}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {wsMenuOpen ? (
            <>
              <div className="menu-scrim" onClick={() => setWsMenuOpen(false)} />
              <div className="ws-menu" role="menu">
                <div className="ws-menu-label">Workspaces</div>
                {session?.workspaces.map((w) => (
                  <button
                    key={w.id}
                    className={`ws-menu-item${w.memberId === memberId ? " active" : ""}`}
                    onClick={() => switchWorkspace(w.id)}
                    role="menuitem"
                  >
                    <span className="ws-menu-name">{w.name}</span>
                    {w.admin ? <span className="ws-tag">admin</span> : null}
                  </button>
                ))}
                <div className="ws-menu-sep" />
                <button className="ws-menu-item" onClick={() => { setWsMenuOpen(false); setWsAction("new"); }} role="menuitem">
                  ＋ New workspace
                </button>
                <button className="ws-menu-item" onClick={() => { setWsMenuOpen(false); setWsAction("join"); }} role="menuitem">
                  Join with a code
                </button>
                {activeWs ? (
                  <button
                    className="ws-menu-item invite"
                    onClick={() => {
                      navigator.clipboard?.writeText(activeWs.inviteCode).then(() => showToast("Invite code copied"));
                    }}
                    role="menuitem"
                    title="Copy invite code"
                  >
                    Invite code: <b>{activeWs.inviteCode}</b> <span className="copy-hint">copy</span>
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
        <div className="user-switch">
          <button className="user-pill" onClick={() => setUserMenuOpen((v) => !v)} title={session?.user.email}>
            <span className="av" style={{ background: currentMember.color }}>
              {initials(session?.user.name ?? currentMember.name)}
            </span>
          </button>
          {userMenuOpen ? (
            <>
              <div className="menu-scrim" onClick={() => setUserMenuOpen(false)} />
              <div className="user-menu" role="menu">
                <div className="user-menu-id">
                  <div className="user-menu-name">{session?.user.name}</div>
                  <div className="user-menu-email">{session?.user.email}</div>
                </div>
                <div className="ws-menu-sep" />
                <button className="ws-menu-item" onClick={logout} role="menuitem">Log out</button>
              </div>
            </>
          ) : null}
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
        <button
          className="icon-btn files-btn"
          onClick={() => setFilesOpen(true)}
          title="Sources — the workspace's source of truth"
          aria-label="Sources"
        >
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
            <path d="M1.75 4.5A1.25 1.25 0 0 1 3 3.25h3l1.5 1.5H13a1.25 1.25 0 0 1 1.25 1.25v5.25A1.25 1.25 0 0 1 13 12.5H3a1.25 1.25 0 0 1-1.25-1.25V4.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          {sourceFiles.length > 0 ? <span className="files-badge">{sourceFiles.length}</span> : null}
        </button>
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
                        {n.kind === "assignment" ? "◉ assigned" : n.kind === "connector" ? "⇄ shared" : n.kind === "question" ? "? question" : "◆ news"}
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
          className="icon-btn desktop-only-btn"
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
        <button className="icon-btn desktop-only-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
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
      <div className="shell" data-mtab={mobileTab}>
        {/* WORKSTREAM RAIL — context organized around work */}
        <aside className="rail">
          <div className="rail-head">
            <span className="rail-title">Workstreams</span>
            <button className="rail-add" onClick={() => setView("boards")} title="New workstream" aria-label="New workstream">+</button>
          </div>
          <div className="rail-list">
            {boards.map((b) => (
              <button
                key={b.id}
                className={"stream-card" + (b.id === activeBoardId ? " active" : "")}
                style={b.color ? ({ "--stream": b.color } as CSSProperties) : undefined}
                onClick={() => { setActiveBoardId(b.id); setView("chat"); setMobileTab("chat"); }}
              >
                <span className="stream-bar" />
                <span className="stream-ring" style={{ ["--p"]: `${b.progress}%` } as CSSProperties}>
                  <span className="stream-ring-num">{b.progress}%</span>
                </span>
                <span className="stream-main">
                  <span className="stream-name-row">
                    <span className="stream-name">{b.name}</span>
                  </span>
                  {b.summary ? <span className="stream-summary">{b.summary}</span> : null}
                  <span className="stream-stats">
                    {b.id === activeBoardId ? <span className="live-dot" /> : null}
                    <span className="stream-meta">
                      {b.openCount} open{b.lastActivityAt ? ` · ${relTime(b.lastActivityAt)}` : ""}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button className="rail-boards" onClick={() => setView("boards")}>All boards →</button>
        </aside>
      <div className="panes">
        {/* WORKSPACE */}
        <section className="workspace">
          <div className="conv-bar">
            {mode === "chat" ? (
              <>
                <button
                  className="conv-toggle"
                  onClick={() => setConvListOpen((o) => !o)}
                  title="Conversations"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="conv-current">
                    {conversations.find((c) => c.id === conversationId)?.title ?? "New chat"}
                  </span>
                  <svg className="conv-chevron" width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className="conv-search">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
                    <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  <input
                    value={chatQuery}
                    onChange={(e) => setChatQuery(e.target.value)}
                    placeholder="Search this chat…"
                    aria-label="Search this conversation"
                  />
                  {chatQuery ? (
                    <button className="conv-search-x" onClick={() => setChatQuery("")} aria-label="Clear search">
                      ×
                    </button>
                  ) : null}
                </div>
                <button className="conv-new" onClick={newConversation} title="Start a new chat">
                  ＋ New
                </button>
              </>
            ) : (
              <span className="conv-loglabel">Team log · Relay quietly syncs the board</span>
            )}
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

          {mode === "chat" && convListOpen && (
            <div className="conv-list">
              {conversations.length === 0 ? (
                <div className="conv-empty">No saved chats yet — this one saves when you send.</div>
              ) : (
                conversations.map((c) => (
                  <div key={c.id} className={"conv-item" + (c.id === conversationId ? " on" : "")}>
                    {renamingId === c.id ? (
                      <input
                        className="conv-rename"
                        value={renameText}
                        autoFocus
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameConversation(c.id, renameText);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={() => renameConversation(c.id, renameText)}
                      />
                    ) : (
                      <button className="conv-open" onClick={() => openConversation(c.id)}>
                        {c.title}
                      </button>
                    )}
                    <button
                      className="conv-mini"
                      title="Rename"
                      onClick={() => { setRenamingId(c.id); setRenameText(c.title); }}
                    >
                      <IconEdit />
                    </button>
                    <button className="conv-mini" title="Delete" onClick={() => deleteConversation(c.id)}>
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

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
          <div
            className="stream"
            ref={streamRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
            }}
          >
            <SyncPanel items={syncItems} onOpenTask={openTaskByName} onOpenQuestions={() => setQuestionsOpen(true)} onDismiss={dismissSync} />
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
            {(() => {
              const q = chatQuery.trim().toLowerCase();
              const list = q ? messages.filter((m) => m.content.toLowerCase().includes(q)) : messages;
              const lastMsg = messages[messages.length - 1];
              if (q && list.length === 0) {
                return <div className="search-empty">No messages match “{chatQuery.trim()}”.</div>;
              }
              return list.map((m, i) =>
                m.role === "user" ? (
                  <div key={m.id ?? i} className="msg user">
                    <span className="av" style={{ background: currentMember.color }}>
                      {initials(currentMember.name)}
                    </span>
                    <div className="msg-col">
                      {editingId && editingId === m.id ? (
                        <div className="msg-edit">
                          <textarea
                            className="d-input"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            rows={3}
                            autoFocus
                          />
                          <div className="msg-edit-actions">
                            <button className="btn btn-primary" onClick={saveEdit} disabled={!editingText.trim()}>
                              Save &amp; resend
                            </button>
                            <button className="btn btn-ghost" onClick={() => { setEditingId(null); setEditingText(""); }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="bubble">
                            <RichText text={m.content} />
                          </div>
                          <div className="msg-meta">
                            {m.createdAt ? <span className="msg-time">{fmtStamp(m.createdAt)}</span> : null}
                            {m.id ? (
                              <div className="msg-actions">
                                <button className="msg-act" title="Copy" onClick={() => copyMessage(m.content)}>
                                  <IconCopy />
                                </button>
                                <button
                                  className="msg-act"
                                  title="Edit & resend"
                                  disabled={sending}
                                  onClick={() => { setEditingId(m.id!); setEditingText(m.content); }}
                                >
                                  <IconEdit />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={m.id ?? i} className="msg ai">
                    <span className="av">
                      <RelayGlyph small />
                    </span>
                    <div className="msg-col">
                      <div className="bubble">
                        <RichText text={m.content} />
                      </div>
                      <div className="msg-meta">
                        {m.createdAt ? <span className="msg-time">{fmtStamp(m.createdAt)}</span> : null}
                        {m.id ? (
                          <div className="msg-actions">
                            <button className="msg-act" title="Copy" onClick={() => copyMessage(m.content)}>
                              <IconCopy />
                            </button>
                            <button
                              className={"msg-act" + (m.feedback === 1 ? " on" : "")}
                              title="Good response"
                              onClick={() => setMessageFeedback(m.id!, 1)}
                            >
                              <IconThumbUp />
                            </button>
                            <button
                              className={"msg-act" + (m.feedback === -1 ? " on" : "")}
                              title="Bad response"
                              onClick={() => setMessageFeedback(m.id!, -1)}
                            >
                              <IconThumbDown />
                            </button>
                            {m === lastMsg && !sending ? (
                              <button className="msg-act" title="Regenerate" onClick={regenerate}>
                                <IconRegen />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {m === lastMsg && m.truncated && !sending ? (
                        <button className="continue-btn" onClick={continueGenerating}>
                          Continue generating
                        </button>
                      ) : null}
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
              );
            })()}

            {sending && !streaming && (
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

          {!atBottom && messages.length > 0 ? (
            <button
              className="scroll-bottom"
              aria-label="Scroll to latest"
              onClick={() => {
                const el = streamRef.current;
                if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              }}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v9M4 8.5 8 12l4-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}

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
          {pendingAttachments.length > 0 || uploading ? (
            <div className="attach-row">
              {pendingAttachments.map((f) => (
                <span key={f.id} className="attach-chip" title={f.name}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M9.5 4.5 5 9a1.5 1.5 0 0 0 2 2l4.5-4.5a3 3 0 0 0-4-4L3.2 6.8A4.5 4.5 0 0 0 9.6 13l2.9-2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="attach-name">{f.name}</span>
                  <button
                    className="attach-x"
                    onClick={() => setPendingAttachments((p) => p.filter((x) => x.id !== f.id))}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {uploading ? <span className="attach-chip loading">Uploading…</span> : null}
            </div>
          ) : null}
          <div className="composer">
            <input
              ref={attachInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                attachToMessage(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              className="attach-btn"
              onClick={() => attachInputRef.current?.click()}
              disabled={uploading || sending}
              aria-label="Attach files"
              title="Attach files — Relay analyzes them and saves them to Sources"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M9.5 4.5 5 9a1.5 1.5 0 0 0 2 2l4.5-4.5a3 3 0 0 0-4-4L3.2 6.8A4.5 4.5 0 0 0 9.6 13l2.9-2.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
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
            {sending ? (
              <button className="send stop" onClick={stopGenerating} aria-label="Stop generating" title="Stop">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                className="send"
                onClick={() => send()}
                disabled={uploading || (!input.trim() && pendingAttachments.length === 0)}
                aria-label="Send"
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8h10M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
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

      {questionsOpen && (
        <QuestionsModal
          questions={questions}
          members={state.members}
          tasks={allTasks}
          currentMemberId={memberId}
          onClose={() => setQuestionsOpen(false)}
          onCreate={createQuestion}
          onAnswer={answerQuestion}
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

      {filesOpen && (
        <SourcesModal
          files={sourceFiles}
          folders={sourceFolders}
          uploading={uploading}
          onUpload={uploadFiles}
          onDelete={deleteSourceFile}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onRenameFile={renameSourceFile}
          onMove={moveNode}
          onClose={() => setFilesOpen(false)}
        />
      )}
      {wsAction && (
        <div className="modal-overlay" onClick={() => setWsAction(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-head">
              <span className="modal-kind">{wsAction === "join" ? "Join a workspace" : "New workspace"}</span>
              <button className="modal-x" onClick={() => setWsAction(null)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              <WorkspacePanel
                initialMode={wsAction === "join" ? "join" : "create"}
                onCreate={createWorkspace}
                onJoin={joinWorkspace}
              />
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

      {/* Phone navigation — turns the chat view's three columns into separate pages
          plus a shortcut to Boards. Hidden on desktop (CSS). */}
      <nav className="mobnav" aria-label="Sections">
        <button
          className={"mobnav-btn" + (view === "chat" && mobileTab === "streams" ? " on" : "")}
          onClick={() => { setView("chat"); setMobileTab("streams"); }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="3.5" width="14" height="4" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
            <rect x="3" y="12.5" width="14" height="4" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>Streams</span>
        </button>
        <button
          className={"mobnav-btn" + (view === "chat" && mobileTab === "chat" ? " on" : "")}
          onClick={() => { setView("chat"); setMobileTab("chat"); }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-3.5 3v-3a2 2 0 0 1-1-1.7V5.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span>Ask Relay</span>
        </button>
        <button
          className={"mobnav-btn" + (view === "boards" || view === "board" ? " on" : "")}
          onClick={() => setView("boards")}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="3.5" width="5.5" height="13" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
            <rect x="11.5" y="3.5" width="5.5" height="8" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>Boards</span>
        </button>
        <button
          className={"mobnav-btn" + (view === "chat" && mobileTab === "memory" ? " on" : "")}
          onClick={() => { setView("chat"); setMobileTab("memory"); }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 3.5c-2 0-3 1.2-3 3v.3c-1.3.4-2 1.5-2 2.9 0 1 .5 1.9 1.3 2.4.1 1.6 1.3 2.9 3 2.9M10 3.5c2 0 3 1.2 3 3v.3c1.3.4 2 1.5 2 2.9 0 1-.5 1.9-1.3 2.4-.1 1.6-1.3 2.9-3 2.9M10 3.5v11.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Memory</span>
        </button>
      </nav>

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
  question: "?",
  answer: "✓",
};

function SyncPanel({
  items,
  onOpenTask,
  onOpenQuestions,
  onDismiss,
}: {
  items: SyncItem[];
  onOpenTask: (name: string) => void;
  onOpenQuestions: () => void;
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
        {items.map((it) => {
          const isQ = it.verdict === "question";
          const isA = it.verdict === "answer";
          return (
            <div key={it.key} className={`sync-item v-${it.verdict}`}>
              <span className="sync-icon">{SYNC_ICON[it.verdict]}</span>
              <span className="sync-text">{it.text}</span>
              <span className="sync-actions">
                {isQ ? (
                  <button className="sync-act" onClick={onOpenQuestions}>Answer</button>
                ) : isA ? (
                  <button className="sync-act" onClick={onOpenQuestions}>View</button>
                ) : it.taskName ? (
                  <button className="sync-act" onClick={() => onOpenTask(it.taskName as string)}>Open</button>
                ) : null}
                <button className="sync-x" title="Dismiss" onClick={() => onDismiss(it.key)}>×</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Questions on the board: hang a question (audience × visibility, optional if/then),
// see what you can answer, and read answered ones. Answers are AI-mediated server-side.
function QuestionsModal({
  questions,
  members,
  tasks,
  currentMemberId,
  onClose,
  onCreate,
  onAnswer,
}: {
  questions: QuestionDTO[];
  members: MemberDTO[];
  tasks: TaskDTO[];
  currentMemberId: string;
  onClose: () => void;
  onCreate: (p: {
    text: string;
    audience: "specific" | "everyone";
    visibility: "private" | "team";
    targetIds: string[];
    answerType: "open" | "yesno";
    branchYes?: BoardAction[];
    branchNo?: BoardAction[];
  }) => Promise<void>;
  onAnswer: (id: string, raw: string, choice?: "yes" | "no") => Promise<void>;
}) {
  const [asking, setAsking] = useState(questions.length === 0);
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<"specific" | "everyone">("specific");
  const [visibility, setVisibility] = useState<"private" | "team">("team");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [answerType, setAnswerType] = useState<"open" | "yesno">("open");
  const [yesTask, setYesTask] = useState("");
  const [yesStatus, setYesStatus] = useState<TaskStatus>("done");
  const [noTask, setNoTask] = useState("");
  const [noStatus, setNoStatus] = useState<TaskStatus>("blocked");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const others = members.filter((m) => m.id !== currentMemberId);
  const branchOk = audience === "specific" && targetIds.length === 1 && answerType === "yesno";

  const toggleTarget = (id: string) =>
    setTargetIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const branchYes: BoardAction[] | undefined = branchOk && yesTask ? [{ type: "update_task", task: yesTask, status: yesStatus }] : undefined;
      const branchNo: BoardAction[] | undefined = branchOk && noTask ? [{ type: "update_task", task: noTask, status: noStatus }] : undefined;
      await onCreate({ text: text.trim(), audience, visibility, targetIds, answerType, branchYes, branchNo });
      setText("");
      setTargetIds([]);
      setAnswerType("open");
      setYesTask("");
      setNoTask("");
      setAsking(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal q-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <span className="modal-kind">Questions</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {asking ? (
            <div className="q-compose">
              <textarea
                className="d-input"
                rows={2}
                placeholder="What do you need to know?"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
              <div className="q-row">
                <div className="q-seg">
                  <button className={audience === "specific" ? "on" : ""} onClick={() => setAudience("specific")}>Ask specific people</button>
                  <button className={audience === "everyone" ? "on" : ""} onClick={() => setAudience("everyone")}>Ask everyone</button>
                </div>
              </div>
              {audience === "specific" ? (
                <div className="q-targets">
                  {others.map((m) => (
                    <button
                      key={m.id}
                      className={`q-chip${targetIds.includes(m.id) ? " on" : ""}`}
                      onClick={() => toggleTarget(m.id)}
                    >
                      <span className="av" style={{ background: m.color }}>{initials(m.name)}</span>
                      {m.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="q-row">
                <div className="q-seg">
                  <button className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>Private</button>
                  <button className={visibility === "team" ? "on" : ""} onClick={() => setVisibility("team")}>Visible to team</button>
                </div>
                <div className="q-seg">
                  <button className={answerType === "open" ? "on" : ""} onClick={() => setAnswerType("open")}>Open answer</button>
                  <button className={answerType === "yesno" ? "on" : ""} onClick={() => setAnswerType("yesno")}>Yes / No</button>
                </div>
              </div>
              {branchOk ? (
                <div className="q-branch">
                  <div className="q-branch-h">On answer, do this (optional):</div>
                  <div className="q-branch-row">
                    <span className="q-branch-lbl">If yes →</span>
                    <select className="d-input" value={yesTask} onChange={(e) => setYesTask(e.target.value)}>
                      <option value="">(nothing)</option>
                      {tasks.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                    <select className="d-input" value={yesStatus} onChange={(e) => setYesStatus(e.target.value as TaskStatus)}>
                      {(["new", "inprogress", "blocked", "done"] as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </div>
                  <div className="q-branch-row">
                    <span className="q-branch-lbl">If no →</span>
                    <select className="d-input" value={noTask} onChange={(e) => setNoTask(e.target.value)}>
                      <option value="">(nothing)</option>
                      {tasks.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                    <select className="d-input" value={noStatus} onChange={(e) => setNoStatus(e.target.value as TaskStatus)}>
                      {(["new", "inprogress", "blocked", "done"] as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </div>
                </div>
              ) : answerType === "yesno" && audience === "specific" && targetIds.length !== 1 ? (
                <div className="q-hint">Pick exactly one person to attach if-yes / if-no actions.</div>
              ) : null}
              {err ? <div className="banner">{err}</div> : null}
              <div className="q-actions">
                <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim() || (audience === "specific" && !targetIds.length)}>
                  {busy ? "Posting…" : "Post question"}
                </button>
                {questions.length ? (
                  <button className="btn btn-ghost" onClick={() => setAsking(false)}>See questions</button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <button className="btn btn-primary q-new" onClick={() => setAsking(true)}>+ Ask a question</button>
              {questions.length === 0 ? (
                <p className="q-empty">No questions yet. Hang one on the board and Relay routes it.</p>
              ) : (
                questions.map((q) => (
                  <QuestionCard key={q.id} q={q} onAnswer={onAnswer} />
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({ q, onAnswer }: { q: QuestionDTO; onAnswer: (id: string, raw: string, choice?: "yes" | "no") => Promise<void> }) {
  const [raw, setRaw] = useState("");
  const [choice, setChoice] = useState<"yes" | "no" | "">("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!raw.trim() || busy) return;
    if (q.answerType === "yesno" && !choice) return;
    setBusy(true);
    try {
      await onAnswer(q.id, raw.trim(), choice || undefined);
    } finally {
      setBusy(false);
    }
  }

  const audienceLabel =
    q.audience === "everyone" ? "everyone" : q.targets.join(", ");
  return (
    <div className={`q-card ${q.status}`}>
      <div className="q-card-head">
        <span className="q-card-text">{q.text}</span>
        <span className={`q-badge ${q.status}`}>{q.status}</span>
      </div>
      <div className="q-card-meta">
        {q.asker ?? "?"} → {audienceLabel} · {q.visibility}
        {q.answerType === "yesno" ? " · yes/no" : ""}
        {q.hasBranch ? " · has actions" : ""}
      </div>
      {q.status === "answered" ? (
        <div className="q-answer">
          <div className="q-answer-by">{q.answerer ?? "Someone"} answered</div>
          <div className="q-answer-text"><RichText text={q.answer ?? ""} /></div>
          {q.firedActions.length ? <div className="q-fired">✓ {q.firedActions.join(" · ")}</div> : null}
        </div>
      ) : q.canAnswer ? (
        <div className="q-answer-form">
          {q.answerType === "yesno" ? (
            <div className="q-seg q-yesno">
              <button className={choice === "yes" ? "on" : ""} onClick={() => setChoice("yes")}>Yes</button>
              <button className={choice === "no" ? "on" : ""} onClick={() => setChoice("no")}>No</button>
            </div>
          ) : null}
          <textarea
            className="d-input"
            rows={2}
            placeholder="Your answer — Relay will tidy it up"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={send} disabled={busy || !raw.trim() || (q.answerType === "yesno" && !choice)}>
            {busy ? "Sending…" : "Answer"}
          </button>
        </div>
      ) : (
        <div className="q-waiting">Waiting on {audienceLabel}…</div>
      )}
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

// ---- Auth & workspace onboarding ----

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

const AUTH_ERRORS: Record<string, string> = {
  google_unconfigured: "Google sign-in isn't configured yet.",
  google_denied: "Google sign-in was cancelled.",
  google_state: "Google sign-in expired — please try again.",
  google_email: "Your Google account has no verified email.",
  google_failed: "Google sign-in failed — please try again.",
};

function AuthScreen({ onAuthed, googleEnabled }: { onAuthed: () => void; googleEnabled: boolean }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Surface an error handed back by the Google callback via ?authError=, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("authError");
    if (code) {
      setErr(AUTH_ERRORS[code] ?? "Sign-in failed — please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const url = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body = mode === "login" ? { email, password } : { name, email, password };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      onAuthed();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <span>Relay</span>
        </div>
        <p className="auth-tag">Chat is for people. Work runs on Relay.</p>
        <h1 className="auth-title">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        {googleEnabled ? (
          <>
            <a className="btn google-btn" href="/api/auth/google">
              <GoogleG />
              Continue with Google
            </a>
            <div className="auth-divider"><span>or</span></div>
          </>
        ) : null}
        <form onSubmit={submit} className="auth-form">
          {mode === "signup" ? (
            <label className="auth-field">
              <span>Name</span>
              <input className="d-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required />
            </label>
          ) : null}
          <label className="auth-field">
            <span>Email</span>
            <input className="d-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@team.com" autoComplete="email" required />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              className="d-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>
          {err ? <div className="auth-err">{err}</div> : null}
          <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>
        <div className="auth-alt">
          {mode === "login" ? (
            <>New to Relay? <button onClick={() => { setMode("signup"); setErr(null); }}>Create an account</button></>
          ) : (
            <>Already have an account? <button onClick={() => { setMode("login"); setErr(null); }}>Log in</button></>
          )}
        </div>
      </div>
    </div>
  );
}

// Shared create/join form, used on the onboarding screen and in the in-app modal.
function WorkspacePanel({
  initialMode,
  onCreate,
  onJoin,
}: {
  initialMode: "create" | "join";
  onCreate: (name: string, role?: string) => Promise<void>;
  onJoin: (code: string, role?: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"create" | "join">(initialMode);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "create") await onCreate(name.trim(), role.trim() || undefined);
      else await onJoin(code.trim(), role.trim() || undefined);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="ws-panel">
      <div className="ws-tabs">
        <button className={`ws-tab${mode === "create" ? " active" : ""}`} onClick={() => setMode("create")} type="button">
          Create
        </button>
        <button className={`ws-tab${mode === "join" ? " active" : ""}`} onClick={() => setMode("join")} type="button">
          Join with code
        </button>
      </div>
      <form onSubmit={submit} className="auth-form">
        {mode === "create" ? (
          <label className="auth-field">
            <span>Workspace name</span>
            <input className="d-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Product" required />
          </label>
        ) : (
          <label className="auth-field">
            <span>Invite code</span>
            <input className="d-input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="8-character code" required />
          </label>
        )}
        <label className="auth-field">
          <span>Your role <span className="opt">(optional)</span></span>
          <input className="d-input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Engineer, Design lead" />
        </label>
        {err ? <div className="auth-err">{err}</div> : null}
        <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
          {busy ? "…" : mode === "create" ? "Create workspace" : "Join workspace"}
        </button>
      </form>
    </div>
  );
}

function WorkspaceOnboarding({
  userName,
  onCreate,
  onJoin,
  onLogout,
}: {
  userName: string;
  onCreate: (name: string, role?: string) => Promise<void>;
  onJoin: (code: string, role?: string) => Promise<void>;
  onLogout: () => void;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <span>Relay</span>
        </div>
        <h1 className="auth-title">Welcome, {userName.split(" ")[0]}</h1>
        <p className="auth-tag">Create a workspace for your team, or join one with an invite code.</p>
        <WorkspacePanel initialMode="create" onCreate={onCreate} onJoin={onJoin} />
        <div className="auth-alt">
          <button onClick={onLogout}>Log out</button>
        </div>
      </div>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function SourcesModal({
  files,
  folders,
  uploading,
  onUpload,
  onDelete,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameFile,
  onMove,
  onClose,
}: {
  files: SourceFileDTO[];
  folders: SourceFolderDTO[];
  uploading: boolean;
  onUpload: (fl: FileList | null, folderId: string | null) => void;
  onDelete: (id: string) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFile: (id: string, name: string) => void;
  onMove: (kind: "file" | "folder", id: string, targetFolderId: string | null) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map((f) => f.id)));
  const [selected, setSelected] = useState<string | null>(null); // upload/create target folder
  const [renaming, setRenaming] = useState<{ kind: "file" | "folder"; id: string } | null>(null);
  const [renameText, setRenameText] = useState("");
  const [creatingIn, setCreatingIn] = useState<string | null | undefined>(undefined); // undefined = not creating
  const [newName, setNewName] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null); // folder id or "root"
  const dragRef = useRef<{ kind: "file" | "folder"; id: string } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const foldersOf = (parentId: string | null) =>
    folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const filesOf = (folderId: string | null) =>
    files.filter((f) => f.folderId === folderId).sort((a, b) => a.name.localeCompare(b.name));

  const pathOf = (id: string | null): string => {
    if (!id) return "Sources";
    const parts: string[] = [];
    let cur = folders.find((f) => f.id === id);
    let guard = 0;
    while (cur && guard++ < 20) {
      parts.unshift(cur.name);
      const pid = cur.parentId;
      cur = pid ? folders.find((f) => f.id === pid) : undefined;
    }
    return "Sources / " + parts.join(" / ");
  };

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const startRename = (kind: "file" | "folder", id: string, name: string) => {
    setRenaming({ kind, id });
    setRenameText(name);
  };
  const commitRename = () => {
    if (renaming && renameText.trim()) {
      if (renaming.kind === "folder") onRenameFolder(renaming.id, renameText);
      else onRenameFile(renaming.id, renameText);
    }
    setRenaming(null);
    setRenameText("");
  };
  const commitCreate = () => {
    if (newName.trim()) onCreateFolder(newName, creatingIn ?? null);
    setCreatingIn(undefined);
    setNewName("");
  };

  const onDropInto = (target: string | null) => {
    setDragOver(null);
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "folder" && d.id === target) return;
    onMove(d.kind, d.id, target);
  };

  function renderFolder(folder: SourceFolderDTO, depth: number) {
    const open = expanded.has(folder.id);
    const isRenaming = renaming?.kind === "folder" && renaming.id === folder.id;
    return (
      <div key={folder.id}>
        <div
          className={"tree-row folder" + (selected === folder.id ? " sel" : "") + (dragOver === folder.id ? " drop" : "")}
          style={{ paddingLeft: 8 + depth * 16 }}
          draggable={!isRenaming}
          onDragStart={() => (dragRef.current = { kind: "folder", id: folder.id })}
          onDragOver={(e) => { e.preventDefault(); setDragOver(folder.id); }}
          onDragLeave={() => setDragOver((d) => (d === folder.id ? null : d))}
          onDrop={(e) => { e.preventDefault(); onDropInto(folder.id); }}
          onClick={() => { setSelected(folder.id); toggle(folder.id); }}
        >
          <span className={"tree-caret" + (open ? " open" : "")}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="tree-icon folder">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.2 1.4h5.6A1.5 1.5 0 0 1 14 5.9v5.1A1.5 1.5 0 0 1 12.5 12.5h-9A1.5 1.5 0 0 1 2 11Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
          </span>
          {isRenaming ? (
            <input
              className="tree-rename"
              value={renameText}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }}
              onBlur={commitRename}
            />
          ) : (
            <span className="tree-name">{folder.name}</span>
          )}
          <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
            <button className="tree-act" title="New subfolder" onClick={() => { setExpanded((s) => new Set(s).add(folder.id)); setCreatingIn(folder.id); setNewName(""); }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 4v8M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
            <button className="tree-act" title="Rename" onClick={() => startRename("folder", folder.id, folder.name)}><IconEdit /></button>
            <button className="tree-act danger" title="Delete folder and contents" onClick={() => { if (window.confirm(`Delete "${folder.name}" and everything inside it?`)) onDeleteFolder(folder.id); }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.5 4V3h3v1M5 4.5 5.5 13h5L11 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </span>
        </div>
        {open && (
          <>
            {creatingIn === folder.id && (
              <div className="tree-row creating" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
                <span className="tree-icon folder"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.2 1.4h5.6A1.5 1.5 0 0 1 14 5.9v5.1A1.5 1.5 0 0 1 12.5 12.5h-9A1.5 1.5 0 0 1 2 11Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg></span>
                <input className="tree-rename" placeholder="Folder name…" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitCreate(); if (e.key === "Escape") setCreatingIn(undefined); }} onBlur={commitCreate} />
              </div>
            )}
            {foldersOf(folder.id).map((c) => renderFolder(c, depth + 1))}
            {filesOf(folder.id).map((f) => renderFile(f, depth + 1))}
          </>
        )}
      </div>
    );
  }

  function renderFile(f: SourceFileDTO, depth: number) {
    const isRenaming = renaming?.kind === "file" && renaming.id === f.id;
    return (
      <div
        key={f.id}
        className="tree-row file"
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={!isRenaming}
        onDragStart={() => (dragRef.current = { kind: "file", id: f.id })}
      >
        <span className="tree-caret" />
        <span className={"tree-icon file" + (f.hasText ? " readable" : "")}>{(f.name.split(".").pop() || "?").slice(0, 4).toUpperCase()}</span>
        {isRenaming ? (
          <input className="tree-rename" value={renameText} autoFocus onChange={(e) => setRenameText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }} onBlur={commitRename} />
        ) : (
          <a className="tree-name link" href={`/api/files/${f.id}`} download title={`${fmtBytes(f.size)}${f.uploaderName ? " · " + f.uploaderName : ""}${f.hasText ? " · readable by Relay" : " · file only"}`}>{f.name}</a>
        )}
        <span className="tree-meta">{fmtBytes(f.size)}</span>
        <span className="tree-actions">
          <button className="tree-act" title="Rename" onClick={() => startRename("file", f.id, f.name)}><IconEdit /></button>
          <a className="tree-act" title="Download" href={`/api/files/${f.id}`} download><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v7m0 0 3-3m-3 3L5 6M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
          <button className="tree-act danger" title="Remove" onClick={() => onDelete(f.id)}><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></button>
        </span>
      </div>
    );
  }

  const empty = folders.length === 0 && files.length === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sources-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <span className="modal-kind">Sources · file tree</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <p className="sources-intro">
            Your team&apos;s canonical files, organized in folders. Relay reads text files (<code>.md</code>, <code>.txt</code>, <code>.csv</code>, code…) as authoritative context, and knows the folder path of each. Drag to move · max 4&nbsp;MB per file.
          </p>

          <div className="tree-toolbar">
            <span className="tree-loc">Adding to <b>{pathOf(selected)}</b></span>
            <div className="tree-tools">
              <button className="tree-tool" onClick={() => { setCreatingIn(selected); setNewName(""); if (selected) setExpanded((s) => new Set(s).add(selected)); }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.2 1.4h5.6A1.5 1.5 0 0 1 14 5.9v5.1A1.5 1.5 0 0 1 12.5 12.5h-9A1.5 1.5 0 0 1 2 11Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                New folder
              </button>
              <button className="tree-tool primary" onClick={() => !uploading && uploadRef.current?.click()} disabled={uploading}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 11V3m0 0L5 6m3-3 3 3M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {uploading ? "Uploading…" : "Upload"}
              </button>
              <input ref={uploadRef} type="file" multiple hidden onChange={(e) => { onUpload(e.target.files, selected); e.target.value = ""; }} />
            </div>
          </div>

          <div
            className={"tree" + (dragOver === "root" ? " drop-root" : "")}
            onClick={() => setSelected(null)}
            onDragOver={(e) => { e.preventDefault(); setDragOver("root"); }}
            onDragLeave={() => setDragOver((d) => (d === "root" ? null : d))}
            onDrop={(e) => { e.preventDefault(); onDropInto(null); }}
          >
            {creatingIn === null && (
              <div className="tree-row creating" style={{ paddingLeft: 8 }}>
                <span className="tree-icon folder"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.2 1.4h5.6A1.5 1.5 0 0 1 14 5.9v5.1A1.5 1.5 0 0 1 12.5 12.5h-9A1.5 1.5 0 0 1 2 11Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg></span>
                <input className="tree-rename" placeholder="Folder name…" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitCreate(); if (e.key === "Escape") setCreatingIn(undefined); }} onBlur={commitCreate} />
              </div>
            )}
            {foldersOf(null).map((f) => renderFolder(f, 0))}
            {filesOf(null).map((f) => renderFile(f, 0))}
            {empty && <p className="sources-empty">No sources yet — make a folder or upload the docs your team keeps coming back to.</p>}
          </div>
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
