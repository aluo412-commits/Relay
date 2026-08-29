// One-off: point existing workspaces at the new default agent model.
// Prisma auto-loads .env for DATABASE_URL. Run: npx tsx scripts/set-model.ts
import { PrismaClient } from "@prisma/client";

const MODEL = process.argv[2] || "glm-5.3-flash";

async function main() {
  const prisma = new PrismaClient();
  const before = await prisma.project.findMany({ select: { name: true, model: true } });
  const res = await prisma.project.updateMany({ data: { model: MODEL } });
  console.log(`Set model="${MODEL}" on ${res.count} project(s).`);
  console.log("Previous models:", before.map((p) => `${p.name}:${p.model}`).join(", ") || "(none)");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
