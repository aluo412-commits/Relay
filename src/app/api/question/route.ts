import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseList } from "@/lib/state";
import type { BoardAction, QuestionDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

async function ctx() {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) return null;
  const members = await prisma.member.findMany({ where: { projectId: project.id } });
  const boards = await prisma.board.findMany({ where: { projectId: project.id } });
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const boardById = new Map(boards.map((b) => [b.id, b.name]));
  return { project, members, nameById, boardById };
}

type QRow = Awaited<ReturnType<typeof prisma.question.findMany>>[number];

function toDTO(q: QRow, memberId: string, nameById: Map<string, string>, boardById: Map<string, string>): QuestionDTO {
  const targets: string[] = parseList(q.targetIds);
  const isTarget = targets.includes(memberId);
  const mine = q.askerId === memberId;
  const canAnswer =
    q.status === "open" && !mine && (q.audience === "everyone" || isTarget);
  return {
    id: q.id,
    boardId: q.boardId,
    boardName: q.boardId ? boardById.get(q.boardId) ?? null : null,
    asker: nameById.get(q.askerId) ?? null,
    text: q.text,
    audience: q.audience as QuestionDTO["audience"],
    visibility: q.visibility as QuestionDTO["visibility"],
    targets: targets.map((id) => nameById.get(id) ?? "?"),
    answerType: q.answerType as QuestionDTO["answerType"],
    hasBranch: !!(q.branchYes || q.branchNo),
    status: q.status as QuestionDTO["status"],
    answer: q.answer,
    answerer: q.answererId ? nameById.get(q.answererId) ?? null : null,
    firedActions: parseList(q.firedActions),
    createdAt: q.createdAt.toISOString(),
    canAnswer,
    mine,
  };
}

// GET /api/question?memberId=  -> questions this member is allowed to see.
export async function GET(req: NextRequest) {
  try {
    const memberId = req.nextUrl.searchParams.get("memberId");
    const c = await ctx();
    if (!c || !memberId) return NextResponse.json({ questions: [] });
    const rows = await prisma.question.findMany({ where: { projectId: c.project.id }, orderBy: { createdAt: "desc" } });
    // Visibility: team → everyone; private → asker + targets only.
    const visible = rows.filter((q) => {
      if (q.visibility === "team") return true;
      const targets: string[] = parseList(q.targetIds);
      return q.askerId === memberId || targets.includes(memberId) || q.audience === "everyone";
    });
    return NextResponse.json({ questions: visible.map((q) => toDTO(q, memberId, c.nameById, c.boardById)) });
  } catch (err) {
    console.error("question GET error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/question  { askerId, boardId?, text, audience, visibility, targetIds[],
//                       answerType, branchYes?, branchNo? }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      askerId?: string;
      boardId?: string | null;
      text?: string;
      audience?: "specific" | "everyone";
      visibility?: "private" | "team";
      targetIds?: string[];
      answerType?: "open" | "yesno";
      branchYes?: BoardAction[];
      branchNo?: BoardAction[];
    };
    const c = await ctx();
    if (!c) return NextResponse.json({ error: "No team found" }, { status: 404 });
    if (!body.askerId || !body.text?.trim()) {
      return NextResponse.json({ error: "askerId and text are required" }, { status: 400 });
    }
    const audience = body.audience === "everyone" ? "everyone" : "specific";
    const visibility = body.visibility === "team" ? "team" : "private";
    const targetIds = audience === "everyone" ? [] : (body.targetIds ?? []).filter((id) => c.nameById.has(id));
    if (audience === "specific" && targetIds.length === 0) {
      return NextResponse.json({ error: "Pick at least one person to ask" }, { status: 400 });
    }
    const answerType = body.answerType === "yesno" ? "yesno" : "open";
    // Branching is only allowed for a single-target yes/no question (KTD2).
    const branchAllowed = audience === "specific" && targetIds.length === 1 && answerType === "yesno";
    const branchYes = branchAllowed && body.branchYes?.length ? JSON.stringify(body.branchYes) : null;
    const branchNo = branchAllowed && body.branchNo?.length ? JSON.stringify(body.branchNo) : null;

    const asker = c.nameById.get(body.askerId) ?? "Someone";
    const q = await prisma.question.create({
      data: {
        projectId: c.project.id,
        boardId: body.boardId ?? null,
        askerId: body.askerId,
        text: body.text.trim(),
        audience,
        visibility,
        targetIds: JSON.stringify(targetIds),
        answerType,
        branchYes,
        branchNo,
      },
    });

    // Delivery: reach the asked people (or everyone else).
    const recipientIds =
      audience === "everyone" ? c.members.filter((m) => m.id !== body.askerId).map((m) => m.id) : targetIds;
    if (recipientIds.length) {
      await prisma.notification.createMany({
        data: recipientIds.map((rid) => ({
          projectId: c.project.id,
          recipientId: rid,
          kind: "question",
          text: `${asker} asks: ${body.text!.trim()}`,
          fromName: asker,
        })),
      });
    }

    return NextResponse.json({ question: toDTO(q, body.askerId, c.nameById, c.boardById) });
  } catch (err) {
    console.error("question POST error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
