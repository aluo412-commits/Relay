// Server-side request context: resolve WHO the caller is and WHICH workspace they're
// acting in, entirely from cookies. Every data route uses this instead of trusting a
// client-supplied memberId. Returns null when unauthenticated or not a workspace member.

import { prisma } from "./db";
import { getSessionUserId, getActiveWorkspaceId } from "./auth";
import type { Member, Project } from "@prisma/client";

export interface RequestContext {
  userId: string;
  member: Member;
  project: Project;
}

/**
 * Resolve the current member + workspace from the session and workspace cookies.
 * If the workspace cookie is missing or the user isn't a member of it, fall back to
 * the user's most recent membership so the app still has somewhere to land.
 */
export async function getContext(): Promise<RequestContext | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const wsId = await getActiveWorkspaceId();
  let member: (Member & { project: Project }) | null = null;
  if (wsId) {
    member = await prisma.member.findFirst({
      where: { userId, projectId: wsId },
      include: { project: true },
    });
  }
  if (!member) {
    member = await prisma.member.findFirst({
      where: { userId },
      include: { project: true },
      orderBy: { project: { createdAt: "asc" } },
    });
  }
  if (!member) return null;

  return { userId, member, project: member.project };
}
