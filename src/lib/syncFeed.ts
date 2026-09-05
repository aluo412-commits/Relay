// Server-side loader that assembles the Active-Sync input from the DB and runs the
// (pure, test-covered) relevance engine in ./sync. Kept separate so ./sync imports
// nothing but types + dates and stays unit-testable without Prisma.

import { prisma } from "./db";
import { computeSyncFeed, type SyncTask } from "./sync";
import { completeJson } from "./minimax";
import { parseList } from "./state";
import type { SyncItem } from "./types";

export async function loadSyncFeed(memberId: string): Promise<{ memberName: string; items: SyncItem[] }> {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return { memberName: "", items: [] };
  const project = await prisma.project.findUnique({ where: { id: member.projectId } });
  if (!project) return { memberName: "", items: [] };

  const [taskRows, updates, knowledge, dismissals, reconcileFlags, questionRows, allMembers] = await Promise.all([
    prisma.task.findMany({ where: { projectId: project.id }, include: { owner: true } }),
    prisma.update.findMany({ where: { projectId: project.id }, include: { author: true } }),
    prisma.knowledge.findMany({ where: { projectId: project.id } }),
    prisma.syncDismissal.findMany({ where: { memberId } }),
    prisma.reconcileFlag.findMany({ where: { memberId, resolved: false } }),
    prisma.question.findMany({ where: { projectId: project.id } }),
    prisma.member.findMany({ where: { projectId: project.id } }),
  ]);
  const dismissedKeys = new Set(dismissals.map((d) => d.key));
  const nameById = new Map(allMembers.map((m) => [m.id, m.name]));

  const tasks: SyncTask[] = taskRows.map((t) => ({
    name: t.name,
    status: t.status,
    boardId: t.boardId,
    due: t.due,
    ownerName: t.owner?.name ?? null,
    dependencies: t.dependencies,
    createdAt: t.createdAt.toISOString(),
  }));

  const items = computeSyncFeed(
    {
      memberName: member.name,
      tasks,
      updates: updates.map((u) => ({ title: u.title, author: u.author?.name ?? null, summary: u.summary, createdAt: u.createdAt.toISOString() })),
      knowledge: knowledge.map((k) => ({ tag: k.tag, text: k.text, importance: k.importance ?? "normal", createdAt: k.createdAt.toISOString() })),
      lastSeenAt: member.lastSeenAt ? member.lastSeenAt.toISOString() : null,
    },
    dismissedKeys
  );

  // Persisted reconciliation flags ride at the front — a stale spec beats routine news.
  const reconcileItems: SyncItem[] = reconcileFlags
    .filter((f) => !dismissedKeys.has(`reconcile:${f.id}`))
    .map((f) => ({
    key: `reconcile:${f.id}`,
    verdict: "reconcile",
    intensity: "proactive",
    text: f.text,
    actionable: true,
    taskName: f.taskName,
    boardId: null,
    fromName: null,
    createdAt: f.createdAt.toISOString(),
    }));

  // Questions reach people through the feed (no separate UI): open questions you can
  // answer, and answers coming back to the asker.
  const questionItems: SyncItem[] = [];
  for (const q of questionRows) {
    const targets: string[] = parseList(q.targetIds);
    const asker = nameById.get(q.askerId) ?? "Someone";
    if (q.status === "open") {
      const canAnswer = q.askerId !== memberId && (q.audience === "everyone" || targets.includes(memberId));
      if (canAnswer) {
        questionItems.push({
          key: `question:${q.id}`,
          verdict: "question",
          intensity: "proactive",
          text: `${asker} asks: ${q.text}`,
          actionable: true,
          taskName: null,
          boardId: q.boardId,
          fromName: asker,
          createdAt: q.createdAt.toISOString(),
        });
      }
    } else if (q.status === "answered" && q.askerId === memberId) {
      questionItems.push({
        key: `answer:${q.id}`,
        verdict: "answer",
        intensity: "ambient",
        text: `${q.answererId ? nameById.get(q.answererId) ?? "Someone" : "Someone"} answered “${q.text}”: ${q.answer ?? ""}`,
        actionable: true,
        taskName: null,
        boardId: q.boardId,
        fromName: q.answererId ? nameById.get(q.answererId) ?? null : null,
        createdAt: q.createdAt.toISOString(),
      });
    }
  }
  const freshQuestions = questionItems.filter((q) => !dismissedKeys.has(q.key));
  const openQ = freshQuestions.filter((q) => q.verdict === "question");
  const answeredQ = freshQuestions.filter((q) => q.verdict === "answer");

  // Order: questions to answer + stale-spec flags up top, then the feed, answers last.
  return { memberName: member.name, items: [...openQ, ...reconcileItems, ...items, ...answeredQ] };
}

/**
 * Reconciliation tier (AI-judged): review the member's in-progress tasks against
 * recent shared knowledge/updates and flag any that may now be stale or contradicted.
 * Upserts persistent ReconcileFlag rows. Safe no-op if the AI is unavailable.
 */
export async function runReconcile(memberId: string): Promise<void> {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return;
  const project = await prisma.project.findUnique({ where: { id: member.projectId } });
  if (!project) return;

  const tasks = await prisma.task.findMany({
    where: { projectId: project.id, ownerId: memberId, status: { in: ["new", "inprogress", "blocked"] } },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  if (!tasks.length) return;

  const [knowledge, updates, logs] = await Promise.all([
    prisma.knowledge.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.update.findMany({ where: { projectId: project.id }, include: { author: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.logEntry.findMany({ where: { projectId: project.id, memberId }, orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  if (!knowledge.length && !updates.length && !logs.length) return;

  const taskText = tasks
    .map((t) => `- ${t.name} [${t.status}, last task change ${t.updatedAt.toISOString()}]: ${t.objective ?? "(no objective)"}${t.acceptanceCriteria ? ` | criteria: ${t.acceptanceCriteria}` : ""}`)
    .join("\n");
  const noteText = [
    ...knowledge.map((k) => `[${k.createdAt.toISOString()}] [${k.tag}] ${k.text}`),
    ...updates.map((u) => `[${u.createdAt.toISOString()}] ${u.author?.name ?? "?"}: ${u.title} — ${u.summary ?? ""}`),
    ...logs.map((l) => `[${l.createdAt.toISOString()}] ${member.name}'s log: ${l.text}`),
  ].join("\n");

  const sys =
    "You are Relay's task follow-up judge. Compare active tasks with recent evidence. " +
    'Return ONLY JSON {"flags":[{"taskName":"<exact task name>","issue":"one sentence explaining the evidence and the next thing to confirm"}]}. ' +
    "Flag only when a human follow-up is valuable: a genuine conflict/change, a blocked task, missing completion evidence, or no meaningful evidence for several days. " +
    "Do not flag a task merely because it has no due date. Do not invent elapsed time; use the timestamps. " +
    "Be conservative and return an empty array when the evidence is insufficient.";
  const result = await completeJson<{ flags: { taskName: string; issue: string }[] }>(
    sys,
    `ACTIVE TASKS:\n${taskText}\n\nRECENT TEAM NOTES:\n${noteText}`,
    project.model
  );
  const flags = Array.isArray(result?.flags) ? result!.flags : [];
  const validNames = new Set(tasks.map((t) => t.name.toLowerCase()));

  for (const f of flags) {
    if (!f?.taskName || !f?.issue) continue;
    const task = tasks.find((t) => t.name.toLowerCase() === f.taskName.toLowerCase());
    if (!task || !validNames.has(f.taskName.toLowerCase())) continue;
    await prisma.reconcileFlag.upsert({
      where: { memberId_taskName: { memberId, taskName: task.name } },
      create: { memberId, taskName: task.name, text: `“${task.name}” may be stale — ${f.issue}` },
      update: { text: `“${task.name}” may be stale — ${f.issue}`, resolved: false },
    });
  }
}
