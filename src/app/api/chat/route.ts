import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState, proposalsToDrafts } from "@/lib/state";
import { buildSystemPrompt } from "@/lib/prompts";
import { runAgentTurn } from "@/lib/minimax";
import { buildPptxBase64, presentationMarkdown } from "@/lib/pptx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/chat  { memberId, message }
// Runs one Relay turn for the given member and persists the exchange.
export async function POST(req: NextRequest) {
  try {
    const { memberId, message, boardId } = (await req.json()) as {
      memberId?: string;
      message?: string;
      boardId?: string;
    };
    if (!memberId || !message?.trim()) {
      return NextResponse.json({ error: "memberId and message are required" }, { status: 400 });
    }

    const state = await loadState();
    const member = state.members.find((m) => m.id === memberId);
    if (!member) return NextResponse.json({ error: "Unknown member" }, { status: 404 });

    const chatBoardId = (state.boards.find((b) => b.id === boardId) ?? state.boards[0])?.id ?? null;

    // Persist the user's message, scoped to the active workstream.
    await prisma.message.create({
      data: { projectId: state.project.id, memberId, boardId: chatBoardId, role: "user", content: message.trim() },
    });

    // Build history from this member's chat thread FOR THIS WORKSTREAM.
    const priorRows = await prisma.message.findMany({
      where: { projectId: state.project.id, memberId, boardId: chatBoardId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    const history = priorRows.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const activeBoard = state.boards.find((b) => b.id === boardId) ?? state.boards[0];
    if (!activeBoard) return NextResponse.json({ error: "No board found" }, { status: 404 });
    const systemPrompt = buildSystemPrompt(state, activeBoard, member.name);
    const result = await runAgentTurn(systemPrompt, history, state.project.model);

    // Persist Relay's visible reply (store just the reply text so history stays clean).
    await prisma.message.create({
      data: { projectId: state.project.id, memberId, boardId: chatBoardId, role: "assistant", content: result.reply },
    });

    // Full agent-turn log (raw tool calls) for inspectability. Survives reseeds.
    await prisma.agentLog.create({
      data: {
        memberName: member.name,
        boardName: activeBoard.name,
        userMessage: message.trim(),
        toolCalls: JSON.stringify(result.rawToolCalls ?? []),
        reply: result.reply,
      },
    });

    // In chat, the agent PROPOSES: board/timeline changes come back as editable
    // drafts the user reviews and publishes (POST /api/publish). Only documents
    // (reports/specs it actually wrote) are delivered instantly as artifacts —
    // they don't mutate shared state.
    const drafts = proposalsToDrafts(result.proposals, result.syncActions);
    const docArtifacts = result.documents.map((d) => ({
      title: d.title,
      filename: d.filename,
      markdown: d.markdown,
      kind: "document" as const,
    }));
    // Render any authored decks into real .pptx bytes (base64) delivered as artifacts.
    const deckArtifacts = await Promise.all(
      result.presentations.map(async (p) => ({
        title: p.title,
        filename: p.filename,
        markdown: presentationMarkdown(p),
        kind: "slides" as const,
        pptxBase64: await buildPptxBase64(p),
      }))
    );
    const artifacts = [...docArtifacts, ...deckArtifacts];

    return NextResponse.json({
      turn: {
        reply: result.reply,
        stage: result.stage,
        questions: result.questions,
        suggestions: result.suggestions,
      },
      drafts,
      artifacts,
      state,
    });
  } catch (err) {
    console.error("chat error:", err);
    return NextResponse.json(
      { error: "Relay couldn't reach the model. " + (err as Error).message },
      { status: 500 }
    );
  }
}
