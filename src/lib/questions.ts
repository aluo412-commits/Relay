import { prisma } from "./db";
import type { BoardAction } from "./types";

export interface CreateQuestionInput {
  projectId: string;
  askerId: string;
  boardId: string | null;
  text: string;
  audience: "specific" | "everyone";
  visibility: "private" | "team";
  targetIds: string[]; // resolved member ids (empty for "everyone")
  answerType: "open" | "yesno";
  branchYes?: BoardAction[] | null;
  branchNo?: BoardAction[] | null;
  askerName: string;
  allMemberIds: string[];
}

/** Create a Question and deliver it to the asked people (or everyone else). */
export async function createQuestion(input: CreateQuestionInput) {
  // Branching is only allowed for a single-target yes/no question (KTD2).
  const branchAllowed = input.audience === "specific" && input.targetIds.length === 1 && input.answerType === "yesno";
  const branchYes = branchAllowed && input.branchYes?.length ? JSON.stringify(input.branchYes) : null;
  const branchNo = branchAllowed && input.branchNo?.length ? JSON.stringify(input.branchNo) : null;

  const q = await prisma.question.create({
    data: {
      projectId: input.projectId,
      boardId: input.boardId,
      askerId: input.askerId,
      text: input.text.trim(),
      audience: input.audience,
      visibility: input.visibility,
      targetIds: JSON.stringify(input.audience === "everyone" ? [] : input.targetIds),
      answerType: input.answerType,
      branchYes,
      branchNo,
    },
  });

  const recipientIds =
    input.audience === "everyone" ? input.allMemberIds.filter((id) => id !== input.askerId) : input.targetIds;
  if (recipientIds.length) {
    await prisma.notification.createMany({
      data: recipientIds.map((rid) => ({
        projectId: input.projectId,
        recipientId: rid,
        kind: "question",
        text: `${input.askerName} asks: ${input.text.trim()}`,
        fromName: input.askerName,
      })),
    });
  }
  return q;
}
