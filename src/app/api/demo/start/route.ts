import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { cookieOptions, signSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Start a fresh, private browser demo using the real Relay data model and APIs. */
export async function POST() {
  try {
    const jar = await cookies();
    const browserId = jar.get("relay_demo_id")?.value ?? randomBytes(12).toString("hex");
    const email = `demo-${browserId}@relay.local`;
    const existingUsers = await prisma.user.findMany({ where: { email: { startsWith: `demo-${browserId}` } }, select: { id: true } });
    if (existingUsers.length) {
      await prisma.project.deleteMany({ where: { members: { some: { userId: { in: existingUsers.map((u) => u.id) } } } } });
      await prisma.user.deleteMany({ where: { id: { in: existingUsers.map((u) => u.id) } } });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, name: "Alex Demo" } });
      const project = await tx.project.create({
        data: {
          name: "Robot v2",
          deadline: dayOffset(21),
          inviteCode: randomBytes(5).toString("hex").toUpperCase(),
          taskKeyPrefix: "ROB",
          model: process.env.LLM_MODEL || process.env.MINIMAX_MODEL || "glm-5.3-flash",
        },
      });
      const board = await tx.board.create({
        data: { projectId: project.id, name: "Robot v2", color: "#5b5fe9", summary: "Competition-ready drive base and autonomous routine" },
      });
      const jordanUser = await tx.user.create({ data: { email: `demo-jordan-${browserId}@relay.local`, name: "Jordan" } });
      const mayaUser = await tx.user.create({ data: { email: `demo-maya-${browserId}@relay.local`, name: "Maya" } });
      const alex = await tx.member.create({ data: { projectId: project.id, userId: user.id, name: "Alex", color: "#5b5fe9", role: "Build lead", admin: true } });
      const jordan = await tx.member.create({ data: { projectId: project.id, userId: jordanUser.id, name: "Jordan", color: "#e5662f", role: "Controls" } });
      const maya = await tx.member.create({ data: { projectId: project.id, userId: mayaUser.id, name: "Maya", color: "#0e9e92", role: "Mechanical" } });

      await tx.task.createMany({
        data: [
          { projectId: project.id, boardId: board.id, key: "ROB-1", name: "Validate intake geometry", status: "done", type: "task", ownerId: maya.id, objective: "Confirm the intake is consistent under match conditions.", acceptanceCriteria: JSON.stringify(["Intake clears the frame", "Three repeatable cycles pass"]), due: dayOffset(-1) },
          { projectId: project.id, boardId: board.id, key: "ROB-2", name: "Wire motor controller", status: "inprogress", type: "task", ownerId: jordan.id, objective: "Connect and verify the controller for the drive base.", acceptanceCriteria: JSON.stringify(["All motors respond", "Encoder direction is verified"]), due: dayOffset(1), priority: "high" },
          { projectId: project.id, boardId: board.id, key: "ROB-3", name: "Run full autonomous test", status: "blocked", type: "task", ownerId: alex.id, objective: "Run the autonomous routine on the competition field.", acceptanceCriteria: JSON.stringify(["Routine completes without a manual reset", "Timing is recorded"]), dependencies: "Wire motor controller", due: dayOffset(3), priority: "high" },
        ],
      });
      await tx.update.createMany({ data: [
        { projectId: project.id, authorId: maya.id, title: "Intake geometry is consistent", status: "Complete", summary: "Three repeatable cycles passed on the practice field.", details: "The intake cleared the frame and held alignment through repeated cycles.", nextSteps: "Move on to controller wiring." },
        { projectId: project.id, authorId: jordan.id, title: "Controller wiring in progress", status: "In progress", summary: "Motor controller is mounted; final encoder check remains.", details: "The drive base is wired on the bench. Encoder direction still needs verification before autonomous testing." },
      ] });
      await tx.knowledge.createMany({ data: [
        { projectId: project.id, tag: "dependency", text: "Controller wiring gates the autonomous test.", importance: "important" },
        { projectId: project.id, tag: "decision", text: "Intake geometry is stable enough to move on.", importance: "normal" },
      ] });
      await tx.logEntry.create({ data: { projectId: project.id, memberId: alex.id, boardId: board.id, text: "The intake is finally consistent. Controller wiring is next — autonomous testing cannot start until that lands.", synced: "Captured the dependency between controller wiring and autonomous testing." } });
      await tx.reconcileFlag.create({ data: { memberId: alex.id, taskName: "Run full autonomous test", text: "“Run full autonomous test” is blocked — controller wiring has no completion evidence yet.", resolved: false } });
      const conversation = await tx.conversation.create({ data: { projectId: project.id, memberId: alex.id, boardId: board.id, title: "Robot v2 kickoff" } });
      await tx.message.create({ data: { projectId: project.id, memberId: alex.id, boardId: board.id, conversationId: conversation.id, role: "user", content: "The intake is finally consistent. Controller wiring is next — autonomous testing cannot start until that lands." } });
      await tx.message.create({ data: { projectId: project.id, memberId: alex.id, boardId: board.id, conversationId: conversation.id, role: "assistant", content: "I found a dependency: **Run full autonomous test** is blocked by **Wire motor controller**. I’ll keep the evidence beside the work and follow up when the state changes." } });
      return { userId: user.id, projectId: project.id };
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set("relay_demo_id", browserId, { ...cookieOptions(60 * 60 * 24 * 30), httpOnly: true });
    response.cookies.set("relay_session", await signSession(result.userId), cookieOptions(60 * 60 * 24));
    response.cookies.set("relay_ws", result.projectId, cookieOptions(60 * 60 * 24));
    return response;
  } catch (error) {
    console.error("demo start error:", error);
    return NextResponse.json({ error: "Unable to start demo" }, { status: 500 });
  }
}
