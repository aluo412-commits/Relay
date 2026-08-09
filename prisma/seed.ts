// Relay has real accounts now — there is no demo data to seed. A fresh database
// starts empty; the first person signs up and creates a workspace, and teammates
// join it with its invite code.
//
// `npm run db:reset` still recreates the schema from scratch (via `prisma db push
// --force-reset`) and then runs this, which intentionally does nothing.

async function main() {
  console.log("No seed data — sign up in the app to create your first account + workspace.");
}

main();
