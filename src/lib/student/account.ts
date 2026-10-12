import { NextResponse } from "next/server";
import { PRIVATE_HEADERS } from "./security";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getSessionUserId, SESSION_COOKIE } from "@/lib/auth";
import { districtById } from "../../../extensions/course-reader/districts.js";
export { districtById, DISTRICTS } from "../../../extensions/course-reader/districts.js";
export type DistrictId = "fuhsd" | "pausd";
function digest(value: string) {
  const key = process.env.AUTH_SECRET;
  if (!key || key.length < 32) throw new Error("Student accounts require AUTH_SECRET >= 32 characters.");
  return createHmac("sha256", key).update(value).digest("hex");
}
export function accountScope(uid: string, district: string) { return digest(`student-scope:v1:${uid}:${district}`).slice(0, 32); }
export function localDataKey(scope: string) { return digest(`student-local-key:v1:${scope}`); }
export function sessionBinding(uid: string, district: string, revision: string, session: string) { return digest(`student-binding:v1:${uid}:${district}:${revision}:${session}`); }
export async function studentAccount() {
  const uid = await getSessionUserId();
  if (!uid) return null;
  const user = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, name: true, email: true, studentProfile: true } });
  if (!user) return null;
  const district = districtById(user.studentProfile?.districtId);
  const revision = user.studentProfile?.revision || "unselected";
  const session = (await cookies()).get(SESSION_COOKIE)?.value || "";
  const binding = sessionBinding(uid, district?.id || "unselected", revision, session);
  const scope = district ? accountScope(uid, district.id) : null;
  return { user: { id: uid, name: user.name, email: user.email }, district, revision, binding, scope };
}
export type StudentAccount = NonNullable<Awaited<ReturnType<typeof studentAccount>>> & { scope: string; district: NonNullable<ReturnType<typeof districtById>> };
export class StudentAccessError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function requireStudent(request?: Request): Promise<StudentAccount> {
  const account = await studentAccount();
  if (!account) throw new StudentAccessError("Sign into your Relay account.", 401);
  if (!account.district || !account.scope) throw new StudentAccessError("Choose your school district first.", 409);
  if (request && request.headers.get("X-Relay-Student-Binding") !== account.binding) throw new StudentAccessError("Your account or district changed. Refresh Relay before continuing.", 409);
  return account as StudentAccount;
}
export function studentError(error: unknown) { return NextResponse.json({ error: error instanceof StudentAccessError ? error.message : "Student account service unavailable." }, { status: error instanceof StudentAccessError ? error.status : 503, headers: PRIVATE_HEADERS }); }
export function connectionCookie(base: string, account: StudentAccount) { return `${base}_${account.scope}`; }
export function connectionPurpose(base: string, account: StudentAccount) { return `${base}:${account.scope}:${account.revision}`; }
