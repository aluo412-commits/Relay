import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState, proposalsToDrafts, normalizeStatus } from "@/lib/state";
import { buildSystemPrompt } from "@/lib/prompts";
import { runAgentTurn, selectRelevantCompactions } from "@/lib/minimax";
import { buildPptxBase64, presentationMarkdown } from "@/lib/pptx";
import { createQuestion } from "@/lib/questions";
import { loadSourceContext, loadAttachedContext } from "@/lib/files";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/chat  { message, boardId? }
// Runs one Relay turn for the signed-in member and persists the exchange.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const memberId = ctx.member.id;

    const { message, boardId, attachedFileIds } = (await req.json()) as {
      message?: string;
      boardId?: string;
      attachedFileIds?: string[];
    };
    const attachIds = Array.isArray(attachedFileIds)
      ? attachedFileIds.filter((x): x is string => typeof x === "string")
      : [];
    const trimmed = message?.trim() ?? "";
    if (!trimmed && attachIds.length === 0) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const state = await loadState(ctx.project.id);
    const member = ctx.member;

    // Load any files attached to this message (already committed to Sources by the
    // client). Their content is injected below so the agent analyzes them now.
    const attached = await loadAttachedContext(state.project.id, attachIds);
    // A bare attachment (no typed text) still needs a directive for the agent.
    const userText =
      trimmed || (attached.names.length ? "Please analyze the attached file(s)." : "");
    // The stored/displayed message notes attachments so the thread has context and
    // the agent's history reflects what was sent.
    const storedContent = attached.names.length
      ? `${userText}\n\n[Attached files: ${attached.names.join(", ")}]`
      : userText;

    const chatBoardId = (state.boards.find((b) => b.id === boardId) ?? state.boards[0])?.id ?? null;

    // Persist the user's message, scoped to the active workstream.
    await prisma.message.create({
      data: { projectId: state.project.id, memberId, boardId: chatBoardId, role: "user", content: storedContent },
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

    // Compacted context: the agent scans past-conversation summaries and pulls back
    // only the ones relevant to this message, so context stays light without loss.
    let recalled = "";
    const compactions = await prisma.compactEntry.findMany({
      where: { projectId: state.project.id, memberId },
      orderBy: { createdAt: "desc" },
      select: { id: true, heading: true, summary: true, content: true },
    });
    if (compactions.length) {
      const relevantIds = await selectRelevantCompactions(
        userText,
        compactions.map((c) => ({ id: c.id, heading: c.heading, summary: c.summary })),
        state.project.model
      );
      const chosen = compactions.filter((c) => relevantIds.includes(c.id));
      if (chosen.length) {
        recalled =
          "\n\nRELEVANT PAST CONTEXT (compacted earlier, recalled because it fits this message — use it, don't repeat it verbatim):\n" +
          chosen.map((c) => `### ${c.heading}\n${c.content}`).join("\n\n");
      }
    }

    const sources = await loadSourceContext(state.project.id);
    const systemPrompt =
      buildSystemPrompt(state, activeBoard, member.name) + sources + recalled + attached.block;
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
        userMessage: storedContent,
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

    // Execute any questions the agent decided to ask (resolve names → members,
    // build branch actions, create + deliver). These run immediately.
    let askedCount = 0;
    for (const aq of result.askQuestions) {
      const everyone = aq.ask.trim().toLowerCase() === "everyone";
      const names = aq.ask.split(",").map((s) => s.trim()).filter(Boolean);
      const targets = everyone
        ? []
        : state.members.filter((m) => names.some((n) => n.toLowerCase() === m.name.toLowerCase()));
      if (!everyone && targets.length === 0) continue; // couldn't resolve anyone
      const single = targets.length === 1;
      const branchYes =
        single && aq.answerType === "yesno" && aq.ifYesTask
          ? [{ type: "update_task" as const, task: aq.ifYesTask, status: normalizeStatus(aq.ifYesStatus) }]
          : null;
      const branchNo =
        single && aq.answerType === "yesno" && aq.ifNoTask
          ? [{ type: "update_task" as const, task: aq.ifNoTask, status: normalizeStatus(aq.ifNoStatus) }]
          : null;
      await createQuestion({
        projectId: state.project.id,
        askerId: memberId,
        boardId: activeBoard.id,
        text: aq.text,
        audience: everyone ? "everyone" : "specific",
        visibility: aq.visibility,
        targetIds: targets.map((m) => m.id),
        answerType: aq.answerType,
        branchYes,
        branchNo,
        askerName: member.name,
        allMemberIds: state.members.map((m) => m.id),
      });
      askedCount++;
    }

    return NextResponse.json({
      turn: {
        reply: result.reply,
        stage: result.stage,
        questions: result.questions,
        suggestions: result.suggestions,
      },
      drafts,
      artifacts,
      asked: askedCount,
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
