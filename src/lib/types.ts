// Shared types between the server AI layer and the client.

export type TaskStatus = "new" | "inprogress" | "blocked" | "done";
export type Priority = "low" | "medium" | "high";
export type Importance = "normal" | "important" | "critical";

export interface MemberDTO {
  id: string;
  name: string;
  color: string;
  role: string | null;
}

export interface TaskDTO {
  id: string;
  name: string;
  status: TaskStatus;
  note: string | null;
  owner: { name: string; color: string } | null;
  objective: string | null;
  acceptanceCriteria: string[];
  dependencies: string | null;
  priority: Priority | null;
  due: string | null;
  boardId: string;
  boardName: string;
}

export interface UpdateDTO {
  id: string;
  title: string;
  status: string;
  summary: string | null;
  details: string | null;
  changes: string | null;
  impact: string | null;
  artifacts: string[];
  nextSteps: string | null;
  author: string | null;
  createdAt: string;
}

export interface KnowledgeDTO {
  id: string;
  tag: string;
  text: string;
  importance: Importance;
  createdAt: string;
}

export interface BoardDTO {
  id: string;
  name: string;
  deadline: string | null;
  color: string | null; // workstream accent
  summary: string | null; // one-line "what this stream is about"
  progress: number; // 0-100, derived
  openCount: number; // tasks not done — "N open" on the stream card
  lastActivityAt: string | null; // most recent task activity in this stream
  tasks: TaskDTO[];
}

export interface ProjectState {
  project: { id: string; name: string; deadline: string | null; model: string };
  members: MemberDTO[];
  boards: BoardDTO[];
  updates: UpdateDTO[];
  knowledge: KnowledgeDTO[];
}

// ---- The structured object the LLM must return each turn ----

export type BoardAction =
  | { type: "complete_task"; task: string; note?: string }
  | { type: "update_task"; task: string; status: TaskStatus; note?: string; due?: string }
  | {
      type: "create_task";
      name: string;
      owner?: string;
      status?: TaskStatus;
      note?: string;
      objective?: string;
      acceptanceCriteria?: string[];
      dependencies?: string;
      priority?: Priority;
      due?: string;
    }
  | { type: "add_knowledge"; tag: string; text: string; importance?: Importance };

// A WORK RECORD document — the official, structured write-up of a piece of work.
export interface UpdateDraft {
  title: string;
  status: string;
  summary?: string;
  details?: string;
  changes?: string;
  impact?: string;
  artifacts?: string[];
  nextSteps?: string;
}

// SHARE INFORMATION intent — a piece of knowledge to publish to Project Memory.
export interface ShareDraft {
  tag: string;
  text: string;
  importance?: Importance;
}

// PUBLISH TASKS intent — a documented task spec to add to the board.
export interface TaskDraft {
  name: string;
  objective?: string;
  owner?: string;
  status?: TaskStatus;
  priority?: Priority;
  acceptanceCriteria?: string[];
  dependencies?: string;
  due?: string;
  note?: string;
}

export interface ConnectorSuggestion {
  text: string; // what Relay proposes to do (routing a piece of knowledge)
  target: string; // member name to loop in
  onAcceptActions?: BoardAction[]; // board changes to apply if the user accepts
}

// A slide the agent authored for a presentation deck.
export interface SlideSpec {
  title: string;
  bullets: string[];
  subtitle?: string; // optional one-liner under the title (e.g. the title slide's tagline)
  notes?: string; // optional speaker notes
}

// A full presentation the agent produced (rendered server-side to a real .pptx).
export interface PresentationSpec {
  title: string;
  filename: string; // kebab-case, ends in .pptx
  slides: SlideSpec[];
}

// An EDITABLE DRAFT the agent produced in chat. Nothing it describes touches the
// board / timeline / team until the user publishes it (POST /api/publish). The
// user can tweak the fields first, or discard it.
export type DraftPayload =
  | { kind: "record"; title: string; update: UpdateDraft; completesTask?: string | null; connector?: ConnectorSuggestion | null }
  | { kind: "tasks"; title: string; board?: string | null; tasks: TaskDraft[] }
  | { kind: "share"; title: string; share: ShareDraft; connector?: ConnectorSuggestion | null }
  | { kind: "status"; title: string; actions: BoardAction[] };

// Relay's per-turn response contract.
export interface RelayTurn {
  reply: string; // a SHORT lead-in line shown to the user in the workspace
  stage: "coaching" | "proposing" | "done";
  draftId?: string | null; // when revising an existing open draft, its id; else null → new draft
  questions?: string[]; // discrete coaching questions, rendered as an organized checklist
  suggestions?: string[]; // quick tappable reply options (natural first-person answers)
  update?: UpdateDraft | null; // WORK UPDATE intent
  share?: ShareDraft | null; // SHARE INFORMATION intent
  tasks?: TaskDraft[] | null; // PUBLISH TASKS intent
  actions?: BoardAction[]; // status changes to existing tasks accompanying a work update
  connector?: ConnectorSuggestion | null; // optional knowledge-routing suggestion
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// A pending proposal to change a task owned by someone else.
export interface ChangeRequestDTO {
  id: string;
  taskName: string;
  requestedBy: string | null;
  proposedStatus: TaskStatus;
  note: string | null;
}

// A proactive per-member briefing: your outstanding work + what changed while away.
export interface Briefing {
  yourTasks: { name: string; status: TaskStatus; note: string | null }[];
  newUpdates: { title: string; status: string; author: string | null; summary: string | null }[];
  newKnowledge: { tag: string; text: string; importance: Importance }[];
  requests: ChangeRequestDTO[]; // pending change requests awaiting THIS member's approval
}

// A recorded log entry (the raw capture) + what the agent auto-synced.
export interface LogEntryDTO {
  id: string;
  memberName: string;
  text: string;
  synced: string | null;
  createdAt: string;
}

// A "for you" delivery item.
export interface NotificationDTO {
  id: string;
  kind: "assignment" | "connector" | "share" | "question";
  text: string;
  importance: Importance | null;
  fromName: string | null;
  boardName: string | null;
  taskName: string | null;
  read: boolean;
  createdAt: string;
}

// ---- Questions on the board ----

export type QuestionAudience = "specific" | "everyone";
export type QuestionVisibility = "private" | "team";
export type QuestionAnswerType = "open" | "yesno";

export interface QuestionDTO {
  id: string;
  boardId: string | null;
  boardName: string | null;
  asker: string | null;
  text: string;
  audience: QuestionAudience;
  visibility: QuestionVisibility;
  targets: string[]; // member names asked
  answerType: QuestionAnswerType;
  hasBranch: boolean;
  status: "open" | "answered" | "resolved";
  answer: string | null;
  answerer: string | null;
  firedActions: string[];
  createdAt: string;
  canAnswer: boolean; // is the current member allowed to answer?
  mine: boolean; // did the current member ask it?
}

// ---- Active-Sync engine ----

// What a change means to a given person.
export type SyncVerdict = "unblocked" | "blocked" | "deadline" | "assigned" | "fyi" | "reconcile";
// How loudly it should be delivered.
export type SyncIntensity = "ambient" | "catchup" | "proactive";

// One ranked item in a person's sync feed.
export interface SyncItem {
  key: string; // stable dedup key (verdict + subject)
  verdict: SyncVerdict;
  intensity: SyncIntensity;
  text: string;
  actionable: boolean;
  taskName: string | null;
  boardId: string | null;
  fromName: string | null;
  createdAt: string;
}

// AI review of a progress check-in.
export interface ProgressReview {
  reviewedNote: string;
  suggestedStatus: TaskStatus;
  comment: string;
}
