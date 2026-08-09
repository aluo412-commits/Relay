import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeCode, fetchGoogleProfile } from "@/lib/google";
import { signSession, SESSION_COOKIE, WORKSPACE_COOKIE, cookieOptions, SESSION_MAX_AGE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "g_oauth_state";

// GET /api/auth/google/callback -> exchange the code, upsert the user, start a session.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const fail = (reason: string) => NextResponse.redirect(new URL(`/?authError=${reason}`, origin));

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  if (searchParams.get("error")) return fail("google_denied");
  if (!code || !state || !cookieState || state !== cookieState) return fail("google_state");

  try {
    const { access_token } = await exchangeCode(origin, code);
    const profile = await fetchGoogleProfile(access_token);
    if (!profile.email || profile.email_verified === false) return fail("google_email");
    const email = profile.email.toLowerCase();

    // Link by Google id, else by existing email, else create.
    let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });
    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: { googleId: profile.sub, image: profile.picture ?? byEmail.image },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email,
            name: profile.name || email.split("@")[0],
            googleId: profile.sub,
            image: profile.picture ?? null,
          },
        });
      }
    }

    const token = await signSession(user.id);
    const firstMembership = await prisma.member.findFirst({
      where: { userId: user.id },
      orderBy: { project: { createdAt: "asc" } },
    });

    const res = NextResponse.redirect(new URL("/", origin));
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE));
    if (firstMembership) {
      res.cookies.set(WORKSPACE_COOKIE, firstMembership.projectId, cookieOptions(SESSION_MAX_AGE));
    }
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("google callback error:", err);
    return fail("google_failed");
  }
}
