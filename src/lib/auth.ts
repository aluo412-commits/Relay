// Self-hosted auth: bcrypt password hashing + a signed (jose HS256) session cookie.
// Identity and the active workspace both live in httpOnly cookies, so the server
// derives who you are and which workspace you're in — the client never asserts it.

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "relay_session";
export const WORKSPACE_COOKIE = "relay_ws";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    // Fail loudly in production; allow a dev fallback so `next dev` works pre-config.
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is not set (must be a random string ≥ 32 chars).");
    }
    return new TextEncoder().encode("dev-only-insecure-secret-change-me");
  }
  return new TextEncoder().encode(s);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

const isProd = process.env.NODE_ENV === "production";

/** Cookie options shared by the session + workspace cookies. */
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/** Read the logged-in user id from the session cookie (null if not signed in). */
export async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/** Read the active workspace id from its cookie (null if none selected). */
export async function getActiveWorkspaceId(): Promise<string | null> {
  return (await cookies()).get(WORKSPACE_COOKIE)?.value ?? null;
}
