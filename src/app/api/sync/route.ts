import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeSyncFeed, type SyncTask } from "@/lib/sync";

export const dynamic = "force-dynamic";

// Build the per-member sync input straight from the DB (needs task createdAt/deps,
// which the state DTOs don't carry) and run the relevance engine.
async function buildFeed(memberId: string) {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) return [];
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return [];

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

  return computeSyncFeed(
    {
      memberName: member.name,
      tasks,
      updates: updates.map((u) => ({ title: u.title, author: u.author?.name ?? null, summary: u.summary, createdAt: u.createdAt.toISOString() })),
      knowledge: knowledge.map((k) => ({ tag: k.tag, text: k.text, importance: k.importance ?? "normal", createdAt: k.createdAt.toISOString() })),
      lastSeenAt: member.lastSeenAt ? member.lastSeenAt.toISOString() : null,
    },
    new Set(dismissals.map((d) => d.key))
  );
}

// GET /api/sync?memberId=  -> ranked "in sync" feed for that member.
export async function GET(req: NextRequest) {
  try {
    const memberId = req.nextUrl.searchParams.get("memberId");
    if (!memberId) return NextResponse.json({ items: [] });
    return NextResponse.json({ items: await buildFeed(memberId) });
  } catch (err) {
    console.error("sync GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/sync  { memberId, key }  -> dismiss an item so it stops surfacing.
export async function POST(req: NextRequest) {
  try {
    const { memberId, key } = (await req.json()) as { memberId?: string; key?: string };
    if (!memberId || !key) return NextResponse.json({ error: "memberId and key are required" }, { status: 400 });
    await prisma.syncDismissal.upsert({
      where: { memberId_key: { memberId, key } },
      create: { memberId, key },
      update: {},
    });
    return NextResponse.json({ items: await buildFeed(memberId) });
  } catch (err) {
    console.error("sync POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
