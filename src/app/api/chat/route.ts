import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadState, proposalsToDrafts, normalizeStatus } from "@/lib/state";
import { buildSystemPrompt } from "@/lib/prompts";
import { runAgentTurnStream, selectRelevantCompactions } from "@/lib/minimax";
import { buildPptxBase64, presentationMarkdown } from "@/lib/pptx";
import { createQuestion } from "@/lib/questions";
import { loadSourceContext, loadAttachedContext } from "@/lib/files";
import { getContext } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A short title from the first user message: first ~6 words, trimmed.
function titleFrom(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return (words || "New chat").slice(0, 60);
}

// Resolve (or create) the conversation this turn belongs to. Adopts any legacy
// messages (conversationId null) for this member+board into a brand-new thread so
// existing history isn't orphaned by the switch to named conversations.
async function resolveConversation(
  projectId: string,
  memberId: string,
  boardId: string | null,
  conversationId: string | undefined,
  firstUserText: string
): Promise<string> {
  if (conversationId) {
    const c = await prisma.conversation.findFirst({ where: { id: conversationId, memberId } });
    if (c) return c.id;
  }
  const created = await prisma.conversation.create({
    data: { projectId, memberId, boardId, title: titleFrom(firstUserText) },
  });
  await prisma.message.updateMany({
    where: { projectId, memberId, boardId, conversationId: null },
    data: { conversationId: created.id },
  });
  return created.id;
}

// POST /api/chat  -> streams NDJSON: {type:"delta",text} … then {type:"done", …}.
// { message?, boardId?, conversationId?, attachedFileIds?, regenerate?, editMessageId?, continue? }
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const memberId = ctx.member.id;

    const body = (await req.json()) as {
      message?: string;
      boardId?: string;
      conversationId?: string;
      attachedFileIds?: string[];
      regenerate?: boolean;
      editMessageId?: string;
      continue?: boolean;
    };
    const attachIds = Array.isArray(body.attachedFileIds)
      ? body.attachedFileIds.filter((x): x is string => typeof x === "string")
      : [];
    const trimmed = body.message?.trim() ?? "";
    const isRegen = !!body.regenerate;
    const isContinue = !!body.continue;
    if (!trimmed && attachIds.length === 0 && !isRegen && !isContinue) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const state = await loadState(ctx.project.id);
    const member = ctx.member;
    const activeBoard = state.boards.find((b) => b.id === body.boardId) ?? state.boards[0];
    if (!activeBoard) return NextResponse.json({ error: "No board found" }, { status: 404 });
    const chatBoardId = activeBoard.id;

    const attached = await loadAttachedContext(state.project.id, attachIds);
    const userText =
      trimmed || (attached.names.length ? "Please analyze the attached file(s)." : "");
    const storedContent = attached.names.length
      ? `${userText}\n\n[Attached files: ${attached.names.join(", ")}]`
      : userText;

    const conversationId = await resolveConversation(
      state.project.id,
      memberId,
      chatBoardId,
      body.conversationId,
      userText
    );

    // Ordered thread for this conversation (used for rewind + history).
    const convoRows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, role: true, content: true },
    });

    // Edit-and-rerun: drop the edited message and everything after it.
    if (body.editMessageId) {
      const idx = convoRows.findIndex((m) => m.id === body.editMessageId);
      if (idx >= 0) {
        await prisma.message.deleteMany({ where: { id: { in: convoRows.slice(idx).map((m) => m.id) } } });
        convoRows.length = idx;
      }
    }

    // Regenerate: drop the trailing assistant message(s) so we answer the last user turn afresh.
    if (isRegen) {
      const toDelete: string[] = [];
      while (convoRows.length && convoRows[convoRows.length - 1].role === "assistant") {
        toDelete.push(convoRows[convoRows.length - 1].id);
        convoRows.pop();
      }
      if (toDelete.length) await prisma.message.deleteMany({ where: { id: { in: toDelete } } });
    }

    // Persist the fresh user message (not for regenerate/continue, which reuse the thread as-is).
    let userMessageId: string | null = null;
    if (!isRegen && !isContinue) {
      const created = await prisma.message.create({
        data: { projectId: state.project.id, memberId, boardId: chatBoardId, conversationId, role: "user", content: storedContent },
      });
      convoRows.push({ id: created.id, role: "user", content: storedContent });
      userMessageId = created.id;
    }

    const history = convoRows.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    if (isContinue) {
      history.push({ role: "user", content: "Continue exactly where you left off. Do not repeat what you already wrote." });
    }

    // Compacted context recall.
    let recalled = "";
    const compactions = await prisma.compactEntry.findMany({
      where: { projectId: state.project.id, memberId },
      orderBy: { createdAt: "desc" },
      select: { id: true, heading: true, summary: true, content: true },
    });
    if (compactions.length && userText) {
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

    // Stream the turn: delta events as the reply forms, then a single done event.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          const result = await runAgentTurnStream(systemPrompt, history, state.project.model, (text) =>
            emit({ type: "delta", text })
          );

          // Bump conversation updatedAt + set title from first message if still default.
          const convoMeta = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { title: true } });
          await prisma.conversation.update({
            where: { id: conversationId },
            data: {
              updatedAt: new Date(),
              ...(userText && convoMeta?.title === "New chat" ? { title: titleFrom(userText) } : {}),
            },
          });

          // Continue appends to the previous assistant bubble; otherwise a new one.
          let assistantId: string;
          if (isContinue) {
            const lastAssistant = [...convoRows].reverse().find((m) => m.role === "assistant");
            if (lastAssistant) {
              const merged = `${lastAssistant.content}\n\n${result.reply}`.trim();
              await prisma.message.update({ where: { id: lastAssistant.id }, data: { content: merged } });
              assistantId = lastAssistant.id;
            } else {
              const m = await prisma.message.create({
                data: { projectId: state.project.id, memberId, boardId: chatBoardId, conversationId, role: "assistant", content: result.reply },
              });
              assistantId = m.id;
            }
          } else {
            const m = await prisma.message.create({
              data: { projectId: state.project.id, memberId, boardId: chatBoardId, conversationId, role: "assistant", content: result.reply },
            });
            assistantId = m.id;
          }

          await prisma.agentLog.create({
            data: {
              memberName: member.name,
              boardName: activeBoard.name,
              userMessage: storedContent || (isContinue ? "[continue]" : "[regenerate]"),
              toolCalls: JSON.stringify(result.rawToolCalls ?? []),
              reply: result.reply,
            },
          });

          const drafts = proposalsToDrafts(result.proposals, result.syncActions);
          const docArtifacts = result.documents.map((d) => ({
            title: d.title,
            filename: d.filename,
            markdown: d.markdown,
            kind: "document" as const,
          }));
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

          let askedCount = 0;
          for (const aq of result.askQuestions) {
            const everyone = aq.ask.trim().toLowerCase() === "everyone";
            const names = aq.ask.split(",").map((s) => s.trim()).filter(Boolean);
            const targets = everyone
              ? []
              : state.members.filter((m) => names.some((n) => n.toLowerCase() === m.name.toLowerCase()));
            if (!everyone && targets.length === 0) continue;
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

          emit({
            type: "done",
            turn: {
              reply: result.reply,
              stage: result.stage,
              questions: result.questions,
              suggestions: result.suggestions,
            },
            messageId: assistantId,
            userMessageId,
            conversationId,
            append: isContinue,
            truncated: result.finishReason === "length",
            drafts,
            artifacts,
            asked: askedCount,
            state,
          });
        } catch (err) {
          console.error("chat stream error:", err);
          emit({ type: "error", error: "Relay couldn't reach the model. " + (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
    });
  } catch (err) {
    console.error("chat error:", err);
    return NextResponse.json(
      { error: "Relay couldn't reach the model. " + (err as Error).message },
      { status: 500 }
    );
  }
}
