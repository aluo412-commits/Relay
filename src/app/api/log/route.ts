import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState, applyActions, executeAgentOutput } from "@/lib/state";
import { buildLogPrompt } from "@/lib/prompts";
import { runAgentTurn } from "@/lib/minimax";
import { buildPptxBase64, presentationMarkdown } from "@/lib/pptx";
import type { LogEntryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function toDTO(e: { id: string; text: string; synced: string | null; createdAt: Date }, memberName: string): LogEntryDTO {
  return { id: e.id, memberName, text: e.text, synced: e.synced, createdAt: e.createdAt.toISOString() };
}

// GET /api/log  -> the whole TEAM's recent log entries (oldest first), attributed by author.
export async function GET() {
  try {
    const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
    if (!project) return NextResponse.json({ entries: [] });
    const rows = await prisma.logEntry.findMany({
      where: { projectId: project.id },
      include: { member: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return NextResponse.json({ entries: rows.map((r) => toDTO(r, r.member?.name ?? "?")) });
  } catch (err) {
    console.error("log GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/log { memberId, boardId, text }
// Records the entry, silently auto-syncs clear status changes, and returns any
// drafts (proposals) for documentation-worthy / structural things.
export async function POST(req: NextRequest) {
  try {
    const { memberId, boardId, text } = (await req.json()) as {
      memberId?: string;
      boardId?: string;
      text?: string;
    };
    if (!memberId || !text?.trim()) {
      return NextResponse.json({ error: "memberId and text are required" }, { status: 400 });
    }

    const state = await loadState();
    const member = state.members.find((m) => m.id === memberId);
    if (!member) return NextResponse.json({ error: "Unknown member" }, { status: 404 });
    const activeBoard = state.boards.find((b) => b.id === boardId) ?? state.boards[0];

    // Always record the raw entry first.
    const entry = await prisma.logEntry.create({
      data: { projectId: state.project.id, memberId, boardId: activeBoard?.id ?? null, text: text.trim() },
    });

    // Recent team log for context (excluding the entry we just created).
    const recentRows = await prisma.logEntry.findMany({
      where: { projectId: state.project.id, id: { not: entry.id } },
      include: { member: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
    const recentLog = recentRows
      .reverse()
      .map((r) => ({ memberName: r.member?.name ?? "?", text: r.text }));

    // Silent agent pass.
    let artifacts: Array<{ title: string; filename: string; markdown: string; kind: string; pptxBase64?: string }> = [];
    let syncedSummary: string | null = null;
    if (activeBoard) {
      const prompt = buildLogPrompt(state, activeBoard, member.name, recentLog);
      const result = await runAgentTurn(prompt, [{ role: "user", content: text.trim() }], state.project.model);

      // Apply clear status changes immediately.
      if (result.syncActions.length) {
        await applyActions(state.project.id, activeBoard.id, result.syncActions, member.name);
        const labels: Record<string, string> = { inprogress: "In progress", blocked: "Blocked", done: "Complete" };
        syncedSummary = result.syncActions
          .map((a) => ("task" in a ? `${a.task} → ${labels[(a as { status?: string }).status ?? ""] ?? (a as { status?: string }).status ?? ""}` : ""))
          .filter(Boolean)
          .join(" · ");
      }

      // Execute everything else (tasks, records, shares, documents) directly.
      const execArtifacts = await executeAgentOutput(state, activeBoard.id, member.name, result.proposals, result.documents);
      const deckArtifacts = await Promise.all(
        result.presentations.map(async (p) => ({
          title: p.title,
          filename: p.filename,
          markdown: presentationMarkdown(p),
          kind: "slides",
          pptxBase64: await buildPptxBase64(p),
        }))
      );
      artifacts = [...execArtifacts, ...deckArtifacts];
      const execNote =
        result.proposals.length || result.documents.length || result.presentations.length
          ? [
              result.proposals.some((p) => p.tasks?.length) ? "tasks" : "",
              result.proposals.some((p) => p.update) ? "record" : "",
              result.proposals.some((p) => p.share) ? "share" : "",
              result.documents.length ? "document" : "",
              result.presentations.length ? "deck" : "",
            ]
              .filter(Boolean)
              .join("+")
          : "";
      const summaryParts = [syncedSummary, execNote].filter(Boolean);
      if (summaryParts.length) {
        syncedSummary = summaryParts.join(" · ");
        await prisma.logEntry.update({ where: { id: entry.id }, data: { synced: syncedSummary } });
      }

      // Inspectable log of the agent turn.
      await prisma.agentLog.create({
        data: {
          memberName: member.name,
          boardName: activeBoard.name,
          userMessage: "[LOG] " + text.trim(),
          toolCalls: JSON.stringify(result.rawToolCalls ?? []),
          reply: syncedSummary || "(no action)",
        },
      });
    }

    const fresh = await loadState();
    return NextResponse.json({
      entry: { ...toDTO(entry, member.name), synced: syncedSummary },
      artifacts,
      state: fresh,
    });
  } catch (err) {
    console.error("log POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
