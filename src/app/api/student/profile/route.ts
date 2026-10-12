import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { googleConfigured } from "@/lib/google";
import { studentAccount, districtById, localDataKey } from "@/lib/student/account";
import { PRIVATE_HEADERS, sameOrigin, limitedText } from "@/lib/student/security";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
export async function GET() {
  try {
    const account = await studentAccount();
    if (!account) return json({ user: null, googleEnabled: googleConfigured() });
    const { revision: _revision, ...profile } = account;
    return json({ ...profile, dataKey: account.scope ? localDataKey(account.scope) : null, googleEnabled: googleConfigured() });
  } catch { return json({ error: "Student account setup is unavailable. No private sources were loaded." }, 503); }
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Invalid origin." }, 403);
  try {
    const account = await studentAccount();
    if (!account) return json({ error: "Sign into Relay first." }, 401);
    const body = JSON.parse(await limitedText(req, 2000));
    if (body.binding !== account.binding) return json({ error: "Account changed. Refresh before choosing a district." }, 409);
    const district = districtById(body.districtId);
    if (!district) return json({ error: "Choose a supported district." }, 400);
    if (account.district?.id !== district.id) {
      if (account.district) {
        const changed = await prisma.studentProfile.updateMany({ where: { userId: account.user.id, revision: account.revision }, data: { districtId: district.id, revision: randomUUID() } });
        if (!changed.count) return json({ error: "District changed in another tab. Refresh and try again." }, 409);
      } else {
        // A concurrent first selection fails rather than overwriting another tab.
        await prisma.studentProfile.create({ data: { userId: account.user.id, districtId: district.id, revision: randomUUID() } });
      }
    }
    return json({ ok: true });
  } catch { return json({ error: "District selection could not be saved. Refresh and try again." }, 400); }
}
