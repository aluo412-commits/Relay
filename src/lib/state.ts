import { prisma } from "./db";
import type { ProjectState, TaskStatus, BoardAction, Priority, DraftPayload } from "./types";
import type { AgentProposal, AgentDocument } from "./minimax";

const STATUS_LABEL: Record<string, string> = {
  inprogress: "In progress",
  blocked: "Blocked",
  done: "Complete",
  new: "New",
};

/**
 * Turn an agent turn's proposals + status syncs into EDITABLE DRAFTS (chat mode).
 * Nothing is applied — the user reviews each draft and publishes it via /api/publish.
 */
export function proposalsToDrafts(proposals: AgentProposal[], syncActions: BoardAction[]): DraftPayload[] {
  const drafts: DraftPayload[] = [];
  for (const p of proposals) {
    if (p.update) {
      const completesTask =
        (p.actions.find((a) => a.type === "complete_task") as { task?: string } | undefined)?.task ?? null;
      drafts.push({ kind: "record", title: p.update.title || "Work record", update: p.update, completesTask, connector: p.connector });
    }
    if (p.tasks?.length) {
      drafts.push({
        kind: "tasks",
        title: p.tasks.length === 1 ? p.tasks[0].name : `${p.tasks.length} tasks`,
        board: p.board ?? null,
        tasks: p.tasks,
      });
    }
    if (p.share) {
      drafts.push({ kind: "share", title: `Share: ${p.share.tag}`, share: p.share, connector: p.connector });
    }
  }
  if (syncActions.length) {
    const label = syncActions
      .map((a) => ("task" in a ? `${a.task} → ${STATUS_LABEL[(a as { status?: string }).status ?? ""] ?? (a as { status?: string }).status ?? ""}` : ""))
      .filter(Boolean)
      .join(" · ");
    drafts.push({ kind: "status", title: label || "Status change", actions: syncActions });
  }
  return drafts;
}

/** Reconstruct a single draft (as edited by the user) back into apply-able work. */
export function draftToWork(d: DraftPayload): { proposals: AgentProposal[]; syncActions: BoardAction[] } {
  if (d.kind === "record") {
    return {
      proposals: [{
        update: d.update,
        share: null,
        tasks: null,
        actions: d.completesTask ? [{ type: "complete_task", task: d.completesTask }] : [],
        connector: d.connector ?? null,
        draftId: null,
      }],
      syncActions: [],
    };
  }
  if (d.kind === "tasks") {
    return {
      proposals: [{ update: null, share: null, tasks: d.tasks, actions: [], connector: null, draftId: null, board: d.board ?? null }],
      syncActions: [],
    };
  }
  if (d.kind === "share") {
    return {
      proposals: [{ update: null, share: d.share, tasks: null, actions: [], connector: d.connector ?? null, draftId: null }],
      syncActions: [],
    };
  }
  return { proposals: [], syncActions: d.actions };
}

export interface ExecArtifact {
  title: string;
  filename: string;
  markdown: string;
  kind: "document" | "record";
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document";
}

function recordToMarkdown(u: {
  title: string;
  status: string;
  summary?: string;
  details?: string;
  changes?: string;
  impact?: string;
  nextSteps?: string;
}) {
  let md = `# ${u.title}\n\n**Status:** ${u.status}\n\n`;
  if (u.summary) md += `${u.summary}\n\n`;
  if (u.details) md += `## Details\n${u.details}\n\n`;
  if (u.changes) md += `## Changes\n${u.changes}\n\n`;
  if (u.impact) md += `## Impact\n${u.impact}\n\n`;
  if (u.nextSteps) md += `## Next steps\n${u.nextSteps}\n`;
  return md.trim();
}

/**
 * Execute an agent turn's output directly (no draft staging): apply board changes,
 * post records, deliver notifications — and return the produced artifacts (documents
 * + work records) for the client's center canvas.
 */
export async function executeAgentOutput(
  state: ProjectState,
  activeBoardId: string,
  actorName: string,
  proposals: AgentProposal[],
  documents: AgentDocument[]
): Promise<ExecArtifact[]> {
  const artifacts: ExecArtifact[] = [];
  const resolveBoard = (name?: string | null) =>
    (name ? state.boards.find((b) => b.name.toLowerCase() === name.toLowerCase())?.id : undefined) ?? activeBoardId;

  for (const p of proposals) {
    const boardId = resolveBoard(p.board);
    const actions: BoardAction[] = [...(p.actions ?? [])];
    if (p.share) {
      actions.push({ type: "add_knowledge", tag: p.share.tag, text: p.share.text, importance: p.share.importance ?? "normal" });
    }
    if (p.tasks?.length) {
      for (const t of p.tasks) {
        actions.push({
          type: "create_task",
          name: t.name,
          owner: t.owner,
          status: t.status,
          note: t.note,
          objective: t.objective,
          acceptanceCriteria: t.acceptanceCriteria,
          dependencies: t.dependencies,
          priority: t.priority,
          due: t.due,
        });
      }
    }
    if (actions.length) await applyActions(state.project.id, boardId, actions, actorName);

    if (p.update) {
      const u = p.update;
      const author = state.members.find((m) => m.name === actorName);
      await prisma.update.create({
        data: {
          projectId: state.project.id,
          authorId: author?.id ?? null,
          title: u.title,
          status: u.status,
          summary: u.summary || null,
          details: u.details || null,
          changes: u.changes || null,
          impact: u.impact || null,
          artifacts: u.artifacts?.length ? JSON.stringify(u.artifacts) : null,
          nextSteps: u.nextSteps || null,
        },
      });
      artifacts.push({ kind: "record", title: u.title, filename: slug(u.title) + ".md", markdown: recordToMarkdown(u) });
    }

    if (p.connector) {
      if (p.connector.onAcceptActions?.length) {
        await applyActions(state.project.id, boardId, p.connector.onAcceptActions, actorName);
      }
      const recip = state.members.find((m) => m.name.toLowerCase() === p.connector!.target.toLowerCase());
      if (recip) {
        await prisma.notification.create({
          data: { projectId: state.project.id, recipientId: recip.id, kind: "connector", text: p.connector.text, fromName: actorName },
        });
      }
    }
  }

  for (const d of documents) {
    artifacts.push({ kind: "document", title: d.title, filename: d.filename, markdown: d.markdown });
  }

  return artifacts;
}

/** Coerce any status string the model produces into a valid Kanban status. */
export function normalizeStatus(s: string | undefined | null): TaskStatus {
  const v = (s ?? "").toLowerCase().trim();
  if (["new", "inprogress", "blocked", "done"].includes(v)) return v as TaskStatus;
  if (["todo", "to do", "to-do", "backlog", "open", "not started", "pending"].includes(v)) return "new";
  if (["in progress", "in-progress", "doing", "wip", "started", "active", "working"].includes(v)) return "inprogress";
  if (["blocked", "stuck", "waiting", "on hold"].includes(v)) return "blocked";
  if (["done", "complete", "completed", "finished", "closed", "resolved"].includes(v)) return "done";
  return "new";
}

/** Parse a JSON-array string column back into a string[] (tolerant of null/garbage). */
export function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Load the single (first) project's full shared state. */
export async function loadState(): Promise<ProjectState> {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) throw new Error("No project seeded. Run `npm run db:seed`.");

  const [members, boards, tasks, updates, knowledge] = await Promise.all([
    prisma.member.findMany({ where: { projectId: project.id }, orderBy: { name: "asc" } }),
    prisma.board.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
    prisma.task.findMany({
      where: { projectId: project.id },
      include: { owner: true, board: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.update.findMany({
      where: { projectId: project.id },
      include: { author: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.knowledge.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } }),
  ]);

  const taskDTOs = tasks.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status as TaskStatus,
    note: t.note,
    owner: t.owner ? { name: t.owner.name, color: t.owner.color } : null,
    objective: t.objective,
    acceptanceCriteria: parseList(t.acceptanceCriteria),
    dependencies: t.dependencies,
    priority: (t.priority as Priority) ?? null,
    due: t.due,
    boardId: t.boardId,
    boardName: t.board?.name ?? "",
  }));

  const boardDTOs = boards.map((b) => {
    const bt = taskDTOs.filter((t) => t.boardId === b.id);
    const done = bt.filter((t) => t.status === "done").length;
    // Most recent activity in this stream (task created/updated).
    const rows = tasks.filter((t) => t.boardId === b.id);
    const lastActivity = rows.reduce<Date | null>((acc, t) => {
      const ts = t.updatedAt > t.createdAt ? t.updatedAt : t.createdAt;
      return !acc || ts > acc ? ts : acc;
    }, null);
    return {
      id: b.id,
      name: b.name,
      deadline: b.deadline,
      color: b.color ?? null,
      summary: b.summary ?? null,
      progress: bt.length ? Math.round((done / bt.length) * 100) : 0,
      openCount: bt.filter((t) => t.status !== "done").length,
      lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
      tasks: bt,
    };
  });

  return {
    project: { id: project.id, name: project.name, deadline: project.deadline, model: project.model },
    members: members.map((m) => ({ id: m.id, name: m.name, color: m.color, role: m.role })),
    boards: boardDTOs,
    updates: updates.map((u) => ({
      id: u.id,
      title: u.title,
      status: u.status,
      summary: u.summary,
      details: u.details,
      changes: u.changes,
      impact: u.impact,
      artifacts: parseList(u.artifacts),
      nextSteps: u.nextSteps,
      author: u.author?.name ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
    knowledge: knowledge.map((k) => ({
      id: k.id,
      tag: k.tag,
      text: k.text,
      importance: (k.importance as ProjectState["knowledge"][number]["importance"]) ?? "normal",
      createdAt: k.createdAt.toISOString(),
    })),
  };
}

/** Apply a list of board actions produced by the AI, scoped to one board. Task matching is by (case-insensitive) name within the board. Generates "for you" notifications (assignments, important shares). */
export async function applyActions(
  projectId: string,
  boardId: string,
  actions: BoardAction[],
  actorName?: string
): Promise<void> {
  const tasks = await prisma.task.findMany({ where: { projectId, boardId } });
  const members = await prisma.member.findMany({ where: { projectId } });
  const board = await prisma.board.findUnique({ where: { id: boardId } });
  const boardName = board?.name ?? null;
  const findTask = (name: string) =>
    tasks.find((t) => t.name.toLowerCase() === name.toLowerCase()) ??
    tasks.find((t) => t.name.toLowerCase().includes(name.toLowerCase()));
  const findMember = (name?: string) =>
    name ? members.find((m) => m.name.toLowerCase() === name.toLowerCase()) : undefined;

  for (const action of actions) {
    switch (action.type) {
      case "complete_task": {
        const t = findTask(action.task);
        if (t) await prisma.task.update({ where: { id: t.id }, data: { status: "done", note: action.note ?? t.note } });
        break;
      }
      case "update_task": {
        const t = findTask(action.task);
        if (t)
          await prisma.task.update({
            where: { id: t.id },
            data: { status: normalizeStatus(action.status), note: action.note ?? t.note },
          });
        break;
      }
      case "create_task": {
        const owner = findMember(action.owner);
        await prisma.task.create({
          data: {
            projectId,
            boardId,
            name: action.name,
            status: normalizeStatus(action.status),
            ownerId: owner?.id,
            note: action.note,
            objective: action.objective,
            acceptanceCriteria: action.acceptanceCriteria?.length
              ? JSON.stringify(action.acceptanceCriteria)
              : null,
            dependencies: action.dependencies,
            priority: action.priority,
            due: action.due,
          },
        });
        // Assignment notification (to the owner, unless they assigned it to themselves).
        if (owner && owner.name.toLowerCase() !== (actorName ?? "").toLowerCase()) {
          await prisma.notification.create({
            data: {
              projectId,
              recipientId: owner.id,
              kind: "assignment",
              text: `${actorName ?? "Someone"} assigned you: ${action.name}`,
              fromName: actorName ?? null,
              boardName,
              taskName: action.name,
            },
          });
        }
        break;
      }
      case "add_knowledge": {
        const importance = action.importance ?? "normal";
        await prisma.knowledge.create({
          data: { projectId, tag: action.tag, text: action.text, importance },
        });
        // Important/critical news is pushed to everyone else's inbox.
        if (importance === "important" || importance === "critical") {
          const recipients = members.filter((m) => m.name.toLowerCase() !== (actorName ?? "").toLowerCase());
          await prisma.notification.createMany({
            data: recipients.map((m) => ({
              projectId,
              recipientId: m.id,
              kind: "share",
              text: action.text,
              importance,
              fromName: actorName ?? null,
            })),
          });
        }
        break;
      }
    }
  }
}
