import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { googleConfigured, redirectUri } from "../google";
import { GMAIL_COOKIE, OAUTH_COOKIE, PRIVATE_HEADERS, privateCookie, seal, unseal } from "./security";
import { plainText } from "./district";
import type { StudyItem } from "./types";

export type GmailConnection = { accessToken: string; refreshToken?: string; expires: number; email: string };
type OAuthState = { state: string; verifier: string };
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export function startGmail(origin: string): NextResponse {
  if (!googleConfigured()) return NextResponse.redirect(new URL("/?connection=gmail_setup", origin), 303);
  const state = `study_${randomBytes(24).toString("hex")}`;
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(origin), response_type: "code", scope: SCOPE, state, access_type: "offline", prompt: "consent select_account", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 303);
  res.cookies.set(OAUTH_COOKIE, seal({ state, verifier }, OAUTH_COOKIE, 600), privateCookie(600));
  res.headers.set("Cache-Control", "no-store");
  return res;
}
async function googleToken(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! }), signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("Google authorization expired. Reconnect your school email.");
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>;
}
export async function finishGmail(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const finish = (status: string) => {
    const response = NextResponse.redirect(new URL(`/?connection=${status}`, origin));
    response.cookies.set(OAUTH_COOKIE, "", privateCookie(0));
    for (const [key, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(key, value);
    return response;
  };
  const saved = unseal<OAuthState>(req.cookies.get(OAUTH_COOKIE)?.value, OAUTH_COOKIE);
  const code = req.nextUrl.searchParams.get("code");
  if (!saved || saved.state !== req.nextUrl.searchParams.get("state")) return finish("gmail_state");
  if (!code || req.nextUrl.searchParams.has("error")) return finish("gmail_denied");
  try {
    const token = await googleToken({ code, redirect_uri: redirectUri(origin), grant_type: "authorization_code", code_verifier: saved.verifier });
    if (!token.scope?.split(" ").includes(SCOPE)) return finish("gmail_denied");
    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!profileResponse.ok) return finish("gmail_api");
    const profile = await profileResponse.json() as { emailAddress: string };
    const connection: GmailConnection = { accessToken: token.access_token, refreshToken: token.refresh_token, expires: Date.now() + token.expires_in * 1000, email: profile.emailAddress };
    const res = finish("gmail_connected");
    res.cookies.set(GMAIL_COOKIE, seal(connection, GMAIL_COOKIE), privateCookie());
    return res;
  } catch { return finish("gmail_failed"); }
}
export async function readGmail(connection: GmailConnection): Promise<{ items: StudyItem[]; connection: GmailConnection }> {
  if (connection.expires < Date.now() + 60_000) {
    if (!connection.refreshToken) throw new Error("Google authorization expired. Reconnect your school email.");
    const token = await googleToken({ grant_type: "refresh_token", refresh_token: connection.refreshToken });
    connection = { ...connection, accessToken: token.access_token, expires: Date.now() + token.expires_in * 1000 };
  }
  const request = async (path: string) => {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${connection.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error("School email is unavailable. Reconnect, or check whether your school allows Gmail access.");
    return res.json();
  };
  const query = new URLSearchParams({ maxResults: "12", q: "in:inbox newer_than:30d {from:fuhsd.org from:schoology.com}" });
  const listed = await request(`messages?${query}`) as { messages?: { id: string }[] };
  const items: StudyItem[] = [];
  const messages = listed.messages ?? [];
  for (let i = 0; i < messages.length; i += 4) {
    const batch = await Promise.all(messages.slice(i, i + 4).map(async ({ id }) => {
      const message = await request(`messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
      const headers: { name: string; value: string }[] = message.payload?.headers ?? [];
      const value = (name: string) => headers.find(h => h.name.toLowerCase() === name)?.value ?? "";
      const from = value("from");
      const address = (/<([^<>]+)>/.exec(from)?.[1] ?? from).trim();
      const domain = address.split("@").at(-1)?.toLowerCase();
      if (domain !== "fuhsd.org" && domain !== "schoology.com" && !domain?.endsWith(".schoology.com")) return null;
      return { id: `gmail:${id}`, source: "gmail", kind: "mail", title: value("subject") || "(No subject)", description: plainText(message.snippet ?? "").slice(0, 1000), date: new Date(Number(message.internalDate)).toISOString(), allDay: false, sender: from, url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(connection.email)}#all/${id}` } satisfies StudyItem;
    }));
    items.push(...batch.filter((item): item is NonNullable<typeof item> => !!item));
  }
  return { items, connection };
}
