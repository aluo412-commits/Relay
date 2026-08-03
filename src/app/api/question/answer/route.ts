import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applyActions, parseList } from "@/lib/state";
import { completeJson } from "@/lib/minimax";
import type { BoardAction } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function actionLabel(a: BoardAction): string {
  if (a.type === "complete_task") return `Marked “${a.task}” done`;
  if (a.type === "update_task") return `Set “${a.task}” to ${a.status}`;
  if (a.type === "create_task") return `Created task “${a.name}”`;
  if (a.type === "add_knowledge") return `Shared: ${a.tag}`;
  return "Applied an action";
}

// POST /api/question/answer { questionId, memberId, answerRaw, choice? }
// The answerer responds; Relay polishes the answer; it's returned to the asker; and
// (for a single-target yes/no with a branch) the matching actions fire.
export async function POST(req: NextRequest) {
  try {
    const { questionId, memberId, answerRaw, choice } = (await req.json()) as {
      questionId?: string;
      memberId?: string;
      answerRaw?: string;
      choice?: "yes" | "no";
    };
    if (!questionId || !memberId || !answerRaw?.trim()) {
      return NextResponse.json({ error: "questionId, memberId and answerRaw are required" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
    if (!project) return NextResponse.json({ error: "No team found" }, { status: 404 });
    const q = await prisma.question.findUnique({ where: { id: questionId } });
    if (!q || q.projectId !== project.id) return NextResponse.json({ error: "Unknown question" }, { status: 404 });
    if (q.status !== "open") return NextResponse.json({ error: "Already answered" }, { status: 409 });

    // Only a target (or anyone, for "everyone"), and never the asker, may answer.
    const targets: string[] = parseList(q.targetIds);
    const allowed = q.askerId !== memberId && (q.audience === "everyone" || targets.includes(memberId));
    if (!allowed) return NextResponse.json({ error: "You can't answer this question" }, { status: 403 });

    const answerer = await prisma.member.findUnique({ where: { id: memberId } });

    // AI mediation: polish the raw answer (degrade to raw if the AI is unavailable).
    let polished = answerRaw.trim();
    const r = await completeJson<{ answer: string }>(
      'You clean up a teammate\'s answer to a question so it\'s clear and complete. Return ONLY JSON {"answer":"<the polished answer, first person, concise>"}. Keep their meaning; do not invent facts.',
      `QUESTION: ${q.text}\n\nRAW ANSWER: ${answerRaw.trim()}`,
      project.model
    );
    if (r?.answer?.trim()) polished = r.answer.trim();

    // Branching: single-target yes/no with a matching branch.
    const fired: string[] = [];
    if (q.answerType === "yesno" && (choice === "yes" || choice === "no")) {
      const raw = choice === "yes" ? q.branchYes : q.branchNo;
      const actions = raw ? (JSON.parse(raw) as BoardAction[]) : [];
      if (actions.length) {
        const boardId = q.boardId ?? (await prisma.board.findFirst({ where: { projectId: project.id } }))?.id;
        if (boardId) {
          await applyActions(project.id, boardId, actions, answerer?.name);
          fired.push(...actions.map(actionLabel));
        }
      }
    }

    await prisma.question.update({
      where: { id: q.id },
      data: {
        answerRaw: answerRaw.trim(),
        answer: polished,
        answererId: memberId,
        status: "answered",
        firedActions: fired.length ? JSON.stringify(fired) : null,
      },
    });

    // Return the polished answer to the asker.
    await prisma.notification.create({
      data: {
        projectId: project.id,
        recipientId: q.askerId,
        kind: "question",
        text: `${answerer?.name ?? "Someone"} answered: ${polished}`,
        fromName: answerer?.name ?? null,
      },
    });

    return NextResponse.json({ ok: true, answer: polished, fired });
  } catch (err) {
    console.error("question answer error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
