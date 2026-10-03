import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SCHOOL_COOKIE = "relay_study_schoology";
export const GMAIL_COOKIE = "relay_study_gmail";
export const OAUTH_COOKIE = "relay_study_oauth";
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Vary": "Cookie", "Referrer-Policy": "no-referrer" };
export const privateCookie = (maxAge = 30 * 86400) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge });
function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Private connections require AUTH_SECRET (at least 32 characters).");
  return createHash("sha256").update(`relay-study-credentials-v1:${secret}`).digest();
}
export function seal(value: unknown, purpose: string, maxAge = 30 * 86400): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ value, expires: Date.now() + maxAge * 1000 })), cipher.final()]);
  const result = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  if (result.length > 3700) throw new Error("Connection information is too large to save securely.");
  return result;
}
export function unseal<T>(encoded: string | undefined, purpose: string): T | null {
  if (!encoded) return null;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    return typeof data.expires === "number" && data.expires > Date.now() ? data.value as T : null;
  } catch { return null; }
}
export function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}
export async function limitedText(response: Response | Request, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) throw new Error("Source exceeds the size limit.");
  const reader = response.body?.getReader();
  if (!reader) return "";
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("Source exceeds the size limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
