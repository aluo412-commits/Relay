import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Fresh, empty workspace — no demo scenario. A team, a few members, one empty board.
async function main() {
  // wipe everything
  await prisma.question.deleteMany();
  await prisma.reconcileFlag.deleteMany();
  await prisma.proactiveDelivery.deleteMany();
  await prisma.syncDismissal.deleteMany();
  await prisma.compactEntry.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.logEntry.deleteMany();
  await prisma.agentLog.deleteMany();
  await prisma.changeRequest.deleteMany();
  await prisma.message.deleteMany();
  await prisma.knowledge.deleteMany();
  await prisma.update.deleteMany();
  await prisma.task.deleteMany();
  await prisma.board.deleteMany();
  await prisma.member.deleteMany();
  await prisma.project.deleteMany();

  const project = await prisma.project.create({
    data: {
      name: "My Workspace",
      deadline: null,
      model: "deepseek-v4-flash",
    },
  });

  await prisma.member.createMany({
    data: [
      { projectId: project.id, name: "Alex", color: "#e0662a", role: null },
      { projectId: project.id, name: "Sam", color: "#2f7fd1", role: null },
      { projectId: project.id, name: "Jordan", color: "#0d9488", role: null },
    ],
  });

  await prisma.board.create({
    data: { projectId: project.id, name: "General", deadline: null, color: "#e0662a", summary: "Your first workstream — rename it or start another." },
  });

  console.log(`Seeded a fresh, empty "${project.name}" (3 members, 1 empty board).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
