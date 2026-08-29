// Verify Phase 1 issue fields end-to-end on a disposable project (auto-deleted).
import { PrismaClient } from "@prisma/client";
import { applyActions } from "../src/lib/state";

async function main() {
  const prisma = new PrismaClient();
  const proj = await prisma.project.create({ data: { name: "ZZ Issue Test", inviteCode: "zz-" + Date.now() } });
  const board = await prisma.board.create({ data: { projectId: proj.id, name: "Main" } });
  await applyActions(proj.id, board.id, [
    { type: "create_task", name: "Sprint Foundation", issueType: "epic" },
    { type: "create_task", name: "Build the schema", issueType: "story", points: 5, epic: "Sprint Foundation", labels: ["backend"] },
    { type: "create_task", name: "Key collision bug", issueType: "bug", priority: "high" },
  ]);
  const tasks = await prisma.task.findMany({ where: { projectId: proj.id }, orderBy: { createdAt: "asc" } });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  console.log("prefix expected: ZZI");
  for (const t of tasks) {
    console.log(`  ${t.key}  [${t.type}]  "${t.name}"  pts=${t.points ?? "-"}  labels=[${t.labels}]  epic=${t.parentId ? byId.get(t.parentId)?.name : "-"}`);
  }
  await prisma.project.delete({ where: { id: proj.id } });
  console.log("cleaned up disposable project");
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
