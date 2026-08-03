// Server-side loader that assembles the Active-Sync input from the DB and runs the
// (pure, test-covered) relevance engine in ./sync. Kept separate so ./sync imports
// nothing but types + dates and stays unit-testable without Prisma.

import { prisma } from "./db";
import { computeSyncFeed, type SyncTask } from "./sync";
import { completeJson } from "./minimax";
import type { SyncItem } from "./types";

export async function loadSyncFeed(memberId: string): Promise<{ memberName: string; items: SyncItem[] }> {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) return { memberName: "", items: [] };
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return { memberName: "", items: [] };

  const [taskRows, updates, knowledge, dismissals, reconcileFlags] = await Promise.all([
    prisma.task.findMany({ where: { projectId: project.id }, include: { owner: true } }),
    prisma.update.findMany({ where: { projectId: project.id }, include: { author: true } }),
    prisma.knowledge.findMany({ where: { projectId: project.id } }),
    prisma.syncDismissal.findMany({ where: { memberId } }),
    prisma.reconcileFlag.findMany({ where: { memberId, resolved: false } }),
  ]);

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
    new Set(dismissals.map((d) => d.key))
  );

  // Persisted reconciliation flags ride at the front — a stale spec beats routine news.
  const reconcileItems: SyncItem[] = reconcileFlags.map((f) => ({
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

  return { memberName: member.name, items: [...reconcileItems, ...items] };
}

/**
 * Reconciliation tier (AI-judged): review the member's in-progress tasks against
 * recent shared knowledge/updates and flag any that may now be stale or contradicted.
 * Upserts persistent ReconcileFlag rows. Safe no-op if the AI is unavailable.
 */
export async function runReconcile(memberId: string): Promise<void> {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) return;
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return;

  const tasks = await prisma.task.findMany({
    where: { projectId: project.id, ownerId: memberId, status: "inprogress" },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  if (!tasks.length) return;

  const [knowledge, updates] = await Promise.all([
    prisma.knowledge.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.update.findMany({ where: { projectId: project.id }, include: { author: true }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  if (!knowledge.length && !updates.length) return;

  const taskText = tasks
    .map((t) => `- ${t.name}: ${t.objective ?? "(no objective)"}${t.acceptanceCriteria ? ` | criteria: ${t.acceptanceCriteria}` : ""}`)
    .join("\n");
  const noteText = [
    ...knowledge.map((k) => `[${k.tag}] ${k.text}`),
    ...updates.map((u) => `${u.author?.name ?? "?"}: ${u.title} — ${u.summary ?? ""}`),
  ].join("\n");

  const sys =
    "You check whether a person's in-progress tasks have gone stale given recent team notes. " +
    'Return ONLY JSON {"flags":[{"taskName":"<exact task name>","issue":"one sentence on what changed and what to review"}]}. ' +
    "Include a task ONLY if a note genuinely conflicts with or supersedes it. Empty array if nothing is stale. Be conservative.";
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
