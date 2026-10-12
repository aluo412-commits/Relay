import { NextRequest, NextResponse } from "next/server";
import { requireStudent, studentError } from "@/lib/student/account";
import { assertDistrictPages } from "@/lib/student/readerSync";
import { createHash } from "node:crypto";
import { getSessionUserId } from "@/lib/auth";
import { googleConfigured } from "@/lib/google";
import { prisma } from "@/lib/db";
import { limitedText, PRIVATE_HEADERS, sameOrigin } from "@/lib/student/security";
import { READER_AI_TEXT_LIMIT, validateCapture } from "@/lib/student/reader";
import { analyzeReaderCapture, readerProvider } from "@/lib/student/readerAnalysis";
import { READER_DAILY_LIMIT, reserveReaderBudget, releaseReaderBudget } from "@/lib/student/readerBudget";
import { canAnalyzeExcerpt } from "@/lib/student/readerPolicy";
import { dayKey } from "@/lib/student/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
function aiIdentity(uid: string) { const c = readerProvider(); return createHash("sha256").update(`${uid}\n${new URL(c.baseURL).hostname}\n${c.model}`).digest("hex"); }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
export async function GET(req: NextRequest) {
  let account; try { account = await requireStudent(req); } catch (e) { return studentError(e); }
  try {
    const uid = await getSessionUserId();
    const user = uid ? await prisma.user.findUnique({ where: { id: uid }, select: { id: true, email: true } }) : null;
    const budget = user ? await prisma.readerAiBudget.findUnique({ where: { userId: user.id } }) : null;
    const config = readerProvider();
    return json({ identity: user ? aiIdentity(account.binding) : null, authenticated: !!user, email: user?.email ?? null, googleEnabled: googleConfigured(), configured: !!config.apiKey, provider: new URL(config.baseURL).hostname, model: config.model, remaining: budget?.day === dayKey(new Date()) ? Math.max(0, READER_DAILY_LIMIT - budget.used) : READER_DAILY_LIMIT, dailyLimit: READER_DAILY_LIMIT });
  } catch { return json({ error: "AI setup is unavailable. Your local course reader still works." }, 503); }
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Open Relay to request an analysis." }, 403);
  const uid = await getSessionUserId();
  if (!uid) return json({ error: "Sign in to Relay before using AI analysis. Reading and importing pages does not require sign-in." }, 401);
  let account; try { account = await requireStudent(req); } catch (e) { return studentError(e); }
  let capture; let expectedIdentity: string | undefined;
  try {
    const body = JSON.parse(await limitedText(req, 200000));
    if (body.consent !== true) return json({ error: "Confirm that you want to send the selected excerpts to the AI provider." }, 400);
    if (body.expectedAiIdentity !== undefined) {
      if (typeof body.expectedAiIdentity !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedAiIdentity)) return json({ error: "Refresh AI availability and confirm the current account and provider." }, 400);
      expectedIdentity = body.expectedAiIdentity;
    }
    capture = validateCapture(body.capture);
    assertDistrictPages(capture.pages, account.district.schoology);
    if (capture.pages.some(p => !canAnalyzeExcerpt(p))) return json({ error: "Descriptions are not document contents. Answer/example materials are excluded; Relay provides requirements and learning information, not coursework answers." }, 400);
    if (capture.pages.reduce((n, p) => n + p.text.length, 0) > READER_AI_TEXT_LIMIT) return json({ error: "Choose fewer pages: analysis accepts at most 32,000 characters." }, 400);
  } catch { return json({ error: "Invalid capture. Select 1–8 readable pages with at most 6,000 characters each." }, 400); }
  if (!readerProvider().apiKey) return json({ error: "AI is not configured on this deployment." }, 503);
  let lease: Date | null = null;
  try {
    if (!await prisma.user.findUnique({ where: { id: uid }, select: { id: true } })) return json({ error: "Sign in again to continue." }, 401);
    if (expectedIdentity && expectedIdentity !== aiIdentity(account.binding)) return json({ error: "Your Relay account or AI provider changed. Refresh AI availability and grant permission again. No text was sent to the model." }, 409);
    lease = await reserveReaderBudget(uid);
    if (!lease) return json({ error: "Another analysis is running, or today’s 12-request limit has been reached. The limit resets at midnight Pacific time." }, 429);
    const result = await analyzeReaderCapture(capture);
    return json({ ...result, analyzedAt: new Date().toISOString() });
  } catch {
    return json({ error: "Analysis could not finish. No cards were added. The provider or usage service may be unavailable; try fewer pages and retry later." }, 503);
  } finally {
    if (lease) await releaseReaderBudget(uid, lease).catch(() => {});
  }
}
