// One-off: give existing projects a key prefix and assign human issue keys
// (REL-1, REL-2…) to existing tasks in creation order. Idempotent.
import { PrismaClient } from "@prisma/client";

function prefixFrom(name: string): string {
  const letters = (name.match(/[A-Za-z]/g) ?? []).join("").toUpperCase();
  return (letters.slice(0, 3) || "REL");
}

async function main() {
  const prisma = new PrismaClient();
  const projects = await prisma.project.findMany({ select: { id: true, name: true, taskKeyPrefix: true, taskSeq: true } });
  for (const p of projects) {
    const prefix = p.taskKeyPrefix || prefixFrom(p.name);
    const tasks = await prisma.task.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "asc" }, select: { id: true, key: true } });
    let seq = p.taskSeq || 0;
    for (const t of tasks) {
      if (t.key) { const n = parseInt(t.key.split("-")[1] || "0", 10); if (n > seq) seq = n; continue; }
      seq += 1;
      await prisma.task.update({ where: { id: t.id }, data: { key: `${prefix}-${seq}` } });
    }
    await prisma.project.update({ where: { id: p.id }, data: { taskKeyPrefix: prefix, taskSeq: seq } });
    console.log(`${p.name}: prefix=${prefix}, ${tasks.length} tasks, seq=${seq}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
