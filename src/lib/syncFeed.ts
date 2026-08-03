// Server-side loader that assembles the Active-Sync input from the DB and runs the
// (pure, test-covered) relevance engine in ./sync. Kept separate so ./sync imports
// nothing but types + dates and stays unit-testable without Prisma.

import { prisma } from "./db";
import { computeSyncFeed, type SyncTask } from "./sync";
import type { SyncItem } from "./types";

export async function loadSyncFeed(memberId: string): Promise<{ memberName: string; items: SyncItem[] }> {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) return { memberName: "", items: [] };
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return { memberName: "", items: [] };

  const [taskRows, updates, knowledge, dismissals] = await Promise.all([
    prisma.task.findMany({ where: { projectId: project.id }, include: { owner: true } }),
    prisma.update.findMany({ where: { projectId: project.id }, include: { author: true } }),
    prisma.knowledge.findMany({ where: { projectId: project.id } }),
    prisma.syncDismissal.findMany({ where: { memberId } }),
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

  return { memberName: member.name, items };
}
