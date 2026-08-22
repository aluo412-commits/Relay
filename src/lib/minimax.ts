import OpenAI from "openai";
import type {
  RelayTurn,
  ConnectorSuggestion,
  UpdateDraft,
  ShareDraft,
  TaskDraft,
  BoardAction,
  PresentationSpec,
} from "./types";

export interface AgentProposal {
  update: UpdateDraft | null;
  share: ShareDraft | null;
  tasks: TaskDraft[] | null;
  actions: BoardAction[];
  connector: ConnectorSuggestion | null;
  draftId: string | null;
  board?: string | null; // name of the board these tasks target (null → active board)
}

export interface AgentDocument {
  title: string;
  filename: string; // e.g. "status-report.md"
  markdown: string;
}

export interface AgentResult {
  reply: string;
  stage: "coaching" | "proposing" | "done";
  questions?: string[];
  suggestions?: string[];
  proposals: AgentProposal[];
  documents: AgentDocument[]; // real markdown artifacts the agent produced
  presentations: PresentationSpec[]; // real .pptx decks the agent authored
  askQuestions: AgentQuestion[]; // questions to hang on the board and deliver
  syncActions: BoardAction[]; // status changes to APPLY immediately (log mode)
  rawToolCalls: { name: string; arguments: string }[];
  finishReason?: string | null; // "length" => the reply was cut off (offer "Continue")
}

// A question the agent decided to hang on the board (from "ask Sam if…" in chat).
export interface AgentQuestion {
  text: string;
  ask: string; // "everyone" or comma-separated member names
  visibility: "private" | "team";
  answerType: "open" | "yesno";
  ifYesTask?: string;
  ifYesStatus?: string;
  ifNoTask?: string;
  ifNoStatus?: string;
}

// Provider-agnostic OpenAI-compatible client (currently OpenCode Zen; MiniMax vars
// kept as fallback). The key stays server-side.
const client = new OpenAI({
  apiKey: process.env.OPENCODE_API_KEY || process.env.MINIMAX_API_KEY,
  baseURL: process.env.LLM_BASE_URL || process.env.MINIMAX_BASE_URL || "https://opencode.ai/zen/v1",
});

const MODEL = process.env.LLM_MODEL || process.env.MINIMAX_MODEL || "claude-haiku-4-5";

/** The models the provider actually serves (from GET /models). Empty on failure. */
export async function listModels(): Promise<string[]> {
  try {
    const res = await client.models.list();
    return res.data.map((m) => m.id).sort();
  } catch {
    return [];
  }
}

/** Is the AI reachable right now? Does a tiny completion to surface auth/billing errors. */
export async function checkAiHealth(model?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await client.chat.completions.create({
      model: model || MODEL,
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 1,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) };
  }
}

/**
 * MiniMax-M2 is a reasoning model that emits inline <think>...</think> blocks,
 * sometimes wraps JSON in markdown fences, and sometimes returns its answer as a
 * native tool call: a natural-language preamble followed by
 * <minimax:tool_call><message>{...json...}</message>. Normalize all of that,
 * then extract the outermost JSON object.
 */
function extractJson(raw: string): string | null {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  s = s.replace(/<think>[\s\S]*$/gi, ""); // dangling, unclosed <think>

  // If the model used the MiniMax tool-call format, the real JSON is inside
  // a <message>...</message> block — prefer that and drop any preamble.
  const msg = s.match(/<message>\s*([\s\S]*?)\s*<\/message>/i);
  if (msg) s = msg[1];
  s = s.replace(/<\/?minimax:tool_call>/gi, "").replace(/<\/?message>/gi, "");

  s = s.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}

/**
 * Pick the best raw string from a completion message: normally `content`, but if
 * the model made a tool call instead, the JSON lives in tool_calls[].arguments.
 */
function rawFromMessage(message: unknown): string {
  const m = message as
    | { content?: string | null; tool_calls?: { function?: { arguments?: string } }[] }
    | undefined;
  const content = m?.content ?? "";
  if (content && content.includes("{")) return content;
  const args = m?.tool_calls?.[0]?.function?.arguments;
  if (args) return args;
  return content;
}

export interface MiniMaxCallResult {
  turn: RelayTurn;
  raw: string;
}

/* ─────────────────────────  AGENT (tool-calling)  ─────────────────────────
   Instead of forcing one giant JSON blob (fragile once markdown grows), we give
   the model real tools. It calls exactly one; the SDK gives us validated,
   properly-escaped arguments. Each tool maps to a RelayTurn the client already
   understands.
*/

const connectorParams = {
  connectorTarget: { type: "string", description: "teammate to offer to notify, if this affects someone" },
  connectorText: { type: "string", description: "one line on what to tell them and why" },
  connectorUnblockTask: { type: "string", description: "exact name of a board task to set in-progress if the offer is accepted" },
} as const;

const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "ask_questions",
      description:
        "Ask 1–3 short questions when you still need info before proposing anything (e.g. a work record needs a summary AND details).",
      parameters: {
        type: "object",
        properties: {
          reply: { type: "string", description: "one short lead-in sentence, with NO question in it" },
          questions: { type: "array", items: { type: "string" }, description: "each question its own item, under ~12 words" },
          suggestions: { type: "array", items: { type: "string" }, description: "2–4 short tappable example answers" },
        },
        required: ["reply", "questions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_work_record",
      description:
        "Propose a work-record document when the user finished/progressed real work and you have at least a summary AND substantive details. Markdown is welcome in text fields.",
      parameters: {
        type: "object",
        properties: {
          reply: { type: "string", description: "short lead-in; do NOT claim you published — the user publishes from the panel" },
          title: { type: "string" },
          status: { type: "string", description: "Complete | In progress | Blocked" },
          summary: { type: "string" },
          details: { type: "string", description: "the substantive body — markdown allowed (lists, bold)" },
          changes: { type: "string" },
          impact: { type: "string" },
          artifacts: { type: "array", items: { type: "string" } },
          nextSteps: { type: "string" },
          completesTask: { type: "string", description: "exact name of an existing board task this completes, if any" },
          ...connectorParams,
          draftId: { type: "string", description: "id of an existing open draft to REVISE instead of creating a new one" },
        },
        required: ["reply", "title", "status", "summary", "details"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_share",
      description: "Propose sharing a piece of knowledge/news with the team. Evaluate importance honestly.",
      parameters: {
        type: "object",
        properties: {
          reply: { type: "string" },
          tag: { type: "string", description: "short category e.g. decision, schedule, strategy, heads-up" },
          text: { type: "string", description: "the crisp thing the team should know (markdown ok)" },
          importance: { type: "string", enum: ["normal", "important", "critical"] },
          ...connectorParams,
          draftId: { type: "string" },
        },
        required: ["reply", "tag", "text", "importance"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_tasks",
      description: "Propose one or more well-specified tasks to publish to the board.",
      parameters: {
        type: "object",
        properties: {
          reply: { type: "string" },
          board: { type: "string", description: "exact name of the board these tasks belong on; omit to use the active board. See OTHER BOARDS for names." },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                objective: { type: "string" },
                owner: { type: "string" },
                priority: { type: "string", enum: ["low", "medium", "high"] },
                acceptanceCriteria: { type: "array", items: { type: "string" } },
                dependencies: { type: "string" },
                due: { type: "string" },
                status: { type: "string", enum: ["new", "inprogress", "blocked", "done"] },
              },
              required: ["name"],
            },
          },
          draftId: { type: "string" },
        },
        required: ["reply", "tasks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_document",
      description:
        "Produce an ACTUAL document/artifact (a markdown file) when the user asks for a report, summary, plan, spec, notes, write-up, or 'markdown file'. Write the COMPLETE content yourself — do not stub it or ask what to include. This is real output, not a draft to approve.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "human title of the document" },
          filename: { type: "string", description: "kebab-case filename ending in .md, e.g. status-report.md" },
          markdown: { type: "string", description: "the full document body in markdown (headings, lists, bold). No tables." },
        },
        required: ["title", "filename", "markdown"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_presentation",
      description:
        "Author a real PowerPoint DECK (.pptx) when the user asks for a presentation, slides, a deck, a pitch, or 'a ppt'. Write ALL the slides yourself with complete content — do not stub them or ask what to include. The FIRST slide is the title slide (give it a punchy title + a one-line subtitle). Each following slide gets a short title and 3–5 tight, presentable bullet points (not paragraphs). This produces a downloadable .pptx artifact.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "deck title (also the title-slide headline)" },
          filename: { type: "string", description: "kebab-case filename ending in .pptx, e.g. q3-roadmap.pptx" },
          slides: {
            type: "array",
            description: "ordered slides; slide 1 is the title slide",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "slide headline (short)" },
                subtitle: { type: "string", description: "optional one-line tagline under the title (great for the title slide)" },
                bullets: { type: "array", items: { type: "string" }, description: "3–5 short bullet lines; keep each under ~12 words" },
                notes: { type: "string", description: "optional speaker notes" },
              },
              required: ["title", "bullets"],
            },
          },
        },
        required: ["title", "filename", "slides"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_teammate",
      description:
        "Hang a QUESTION on the board when the user asks you to ask/check with someone or find something out (e.g. 'ask Sam if v1 is ready', 'check with the team about the deadline'). Relay reaches the person and brings the answer back. This executes immediately — you're asking on their behalf, not drafting.",
      parameters: {
        type: "object",
        properties: {
          reply: { type: "string", description: "short confirmation, e.g. 'Asked Sam — I'll bring back the answer.'" },
          question: { type: "string", description: "the question to ask, in plain words" },
          ask: { type: "string", description: "who to ask: a member's name, several names comma-separated, or 'everyone'" },
          visibility: { type: "string", enum: ["team", "private"], description: "team = others can see it; private = only the asked" },
          answerType: { type: "string", enum: ["open", "yesno"], description: "'yesno' if it's a yes/no question, else 'open'" },
          ifYesTask: { type: "string", description: "optional: exact task name to change if answered yes (only when asking ONE person a yes/no)" },
          ifYesStatus: { type: "string", enum: ["new", "inprogress", "blocked", "done"] },
          ifNoTask: { type: "string", description: "optional: exact task name to change if answered no" },
          ifNoStatus: { type: "string", enum: ["new", "inprogress", "blocked", "done"] },
        },
        required: ["question", "ask"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_task",
      description:
        "Silently apply a status change to an EXISTING board task when a log entry clearly states it (e.g. 'finished the claw' → done; 'blocked on X' → blocked). Use the exact task name. Only for existing tasks and only when unambiguous.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "exact name of the existing board task" },
          status: { type: "string", enum: ["inprogress", "blocked", "done"] },
          note: { type: "string", description: "short note, optional" },
        },
        required: ["task", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "say",
      description:
        "Reply conversationally (acknowledgement, sign-off, answering a question, a summary, or a catch-up) when there is nothing to propose. Use markdown — bold, bullet/numbered lists, short headings — to make the answer clear and skimmable.",
      parameters: {
        type: "object",
        properties: { reply: { type: "string", description: "markdown-formatted reply" } },
        required: ["reply"],
      },
    },
  },
];

type ToolArgs = Record<string, unknown>;

function buildConnector(a: ToolArgs): ConnectorSuggestion | null {
  const target = a.connectorTarget as string | undefined;
  if (!target) return null;
  const unblock = a.connectorUnblockTask as string | undefined;
  return {
    target,
    text: (a.connectorText as string) || `This affects ${target} — want me to loop them in?`,
    onAcceptActions: unblock
      ? [{ type: "update_task", task: unblock, status: "inprogress", note: "Unblocked" }]
      : [],
  };
}

// Interpret a single tool call into either coaching fields or a publishable proposal.
function proposalFromArgs(name: string, a: ToolArgs): AgentProposal | null {
  if (name === "propose_work_record") {
    return {
      update: {
        title: a.title as string,
        status: a.status as string,
        summary: (a.summary as string) || "",
        details: (a.details as string) || "",
        changes: (a.changes as string) || "",
        impact: (a.impact as string) || "",
        artifacts: (a.artifacts as string[]) || [],
        nextSteps: (a.nextSteps as string) || "",
      },
      share: null,
      tasks: null,
      actions: a.completesTask ? [{ type: "complete_task", task: a.completesTask as string }] : [],
      connector: buildConnector(a),
      draftId: (a.draftId as string) || null,
    };
  }
  if (name === "propose_share") {
    return {
      update: null,
      share: {
        tag: (a.tag as string) || "note",
        text: a.text as string,
        importance: (a.importance as "normal" | "important" | "critical") || "normal",
      },
      tasks: null,
      actions: [],
      connector: buildConnector(a),
      draftId: (a.draftId as string) || null,
    };
  }
  if (name === "propose_tasks") {
    return {
      update: null,
      share: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tasks: (a.tasks as any[]) || [],
      actions: [],
      connector: null,
      draftId: (a.draftId as string) || null,
      board: (a.board as string) || null,
    };
  }
  return null;
}

// Minimal shape both the streaming and non-streaming paths reduce to.
type ToolCallLike = { function?: { name?: string; arguments?: string } };

/**
 * Turn a set of tool calls (+ any plain content) into an AgentResult. Shared by the
 * streaming and non-streaming turns so parsing behaves identically either way.
 */
function buildAgentResult(
  calls: ToolCallLike[],
  msgContent: string,
  rawToolCalls: { name: string; arguments: string }[],
  finishReason: string | null
): AgentResult {
  const proposals: AgentProposal[] = [];
  const documents: AgentDocument[] = [];
  const presentations: PresentationSpec[] = [];
  const askQuestions: AgentQuestion[] = [];
  const syncActions: BoardAction[] = [];
  let reply = "";
  let questions: string[] | undefined;
  let suggestions: string[] | undefined;

  for (const call of calls) {
    const name = call?.function?.name;
    if (!name) continue;
    let a: ToolArgs = {};
    try {
      a = JSON.parse(call.function?.arguments || "{}");
    } catch {
      continue;
    }
    if (name === "ask_questions") {
      reply = (a.reply as string) || reply;
      questions = (a.questions as string[]) || [];
      suggestions = (a.suggestions as string[]) || [];
    } else if (name === "say") {
      reply = (a.reply as string) || reply;
    } else if (name === "create_document") {
      const title = (a.title as string) || "Document";
      documents.push({
        title,
        filename: (a.filename as string) || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".md",
        markdown: (a.markdown as string) || "",
      });
    } else if (name === "create_presentation") {
      const title = (a.title as string) || "Presentation";
      const rawSlides = Array.isArray(a.slides) ? (a.slides as Record<string, unknown>[]) : [];
      const slides = rawSlides
        .map((s) => ({
          title: (s.title as string) || "",
          subtitle: (s.subtitle as string) || undefined,
          bullets: Array.isArray(s.bullets) ? (s.bullets as unknown[]).map(String) : [],
          notes: (s.notes as string) || undefined,
        }))
        .filter((s) => s.title || s.bullets.length);
      if (slides.length) {
        presentations.push({
          title,
          filename: (a.filename as string) || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".pptx",
          slides,
        });
      }
    } else if (name === "ask_teammate") {
      if (a.question && a.ask) {
        askQuestions.push({
          text: a.question as string,
          ask: a.ask as string,
          visibility: (a.visibility as "private" | "team") === "private" ? "private" : "team",
          answerType: (a.answerType as "open" | "yesno") === "yesno" ? "yesno" : "open",
          ifYesTask: (a.ifYesTask as string) || undefined,
          ifYesStatus: (a.ifYesStatus as string) || undefined,
          ifNoTask: (a.ifNoTask as string) || undefined,
          ifNoStatus: (a.ifNoStatus as string) || undefined,
        });
        if (!reply) reply = (a.reply as string) || "";
      }
    } else if (name === "sync_task") {
      if (a.task) {
        syncActions.push({
          type: "update_task",
          task: a.task as string,
          status: (a.status as "inprogress" | "blocked" | "done") ?? "inprogress",
          note: (a.note as string) || undefined,
        });
      }
    } else {
      const p = proposalFromArgs(name, a);
      if (p) {
        proposals.push(p);
        if (!reply) reply = (a.reply as string) || "";
      }
    }
  }

  if (calls.length === 0) {
    // No tool call — recover a plain reply from content.
    const jsonStr = extractJson(msgContent);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr) as RelayTurn;
        if (parsed.reply) {
          return { reply: parsed.reply, stage: parsed.stage ?? "coaching", questions: parsed.questions, suggestions: parsed.suggestions, proposals: [], documents: [], presentations: [], askQuestions: [], syncActions: [], rawToolCalls, finishReason };
        }
      } catch {
        /* fall through */
      }
    }
    const cleaned = msgContent
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<\/?minimax:tool_call>/gi, "")
      .replace(/<\/?message>/gi, "")
      .trim();
    return { reply: cleaned || "Sorry — could you say that again?", stage: "coaching", proposals: [], documents: [], presentations: [], askQuestions: [], syncActions: [], rawToolCalls, finishReason };
  }

  const stage: AgentResult["stage"] = proposals.length > 0 ? "proposing" : "coaching";
  if (proposals.length > 1) {
    reply = reply || `Drafted ${proposals.length} things — they're in the panel to review.`;
  } else if (!reply) {
    if (proposals.length) reply = "Here's the draft — review and publish when it looks right.";
    else if (presentations.length) reply = "Built your deck — preview it and download the .pptx from the panel.";
    else if (documents.length) reply = "Wrote it up — it's in the artifact panel to download.";
    else if (askQuestions.length) reply = "Asked them — I'll bring the answer back to you.";
    else reply = "Got it.";
  }

  return { reply, stage, questions, suggestions, proposals, documents, presentations, askQuestions, syncActions, rawToolCalls, finishReason };
}

// Strip reasoning/tool-call scaffolding for a clean streamed preview.
function stripScaffold(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/<\/?minimax:tool_call>/gi, "")
    .replace(/<\/?message>/gi, "")
    .trimStart();
}

// Best-effort extract of the (possibly incomplete) "reply" string from a partial
// tool-call arguments JSON, decoding escapes as they arrive. Returns "" if not begun.
function extractPartialReply(argsStr: string): string {
  const key = argsStr.indexOf('"reply"');
  if (key === -1) return "";
  let i = argsStr.indexOf(":", key);
  if (i === -1) return "";
  i++;
  while (i < argsStr.length && /\s/.test(argsStr[i])) i++;
  if (argsStr[i] !== '"') return "";
  i++; // past the opening quote
  let out = "";
  while (i < argsStr.length) {
    const ch = argsStr[i];
    if (ch === "\\") {
      const next = argsStr[i + 1];
      if (next === undefined) break; // escape not fully arrived yet
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "/") out += "/";
      else if (next === "u") {
        const hex = argsStr.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16) || 0);
        i += 4;
      } else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') break; // closing quote → reply complete
    out += ch;
    i++;
  }
  return out;
}

// The agent turn: the model may call SEVERAL tools in one response (e.g. log a
// work record AND spec a follow-up task). We collect every proposal into drafts,
// plus one coaching/reply message.
export async function runAgentTurn(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  model?: string
): Promise<AgentResult> {
  const completion = await client.chat.completions.create({
    model: model || MODEL,
    temperature: 0.4,
    max_tokens: 1800,
    tools: AGENT_TOOLS,
    tool_choice: "auto",
    messages: [{ role: "system", content: systemPrompt }, ...history],
  });
  const msg = completion.choices[0]?.message;
  const calls = msg?.tool_calls ?? [];
  const rawToolCalls = calls.map((c) => ({ name: c?.function?.name ?? "?", arguments: c?.function?.arguments ?? "" }));
  return buildAgentResult(calls, msg?.content ?? "", rawToolCalls, completion.choices[0]?.finish_reason ?? null);
}

/**
 * Streaming variant: same result, but emits incremental reply text via onDelta as it
 * arrives (for a ChatGPT-style typewriter). The final AgentResult is authoritative —
 * the caller should reconcile the streamed preview with result.reply at the end.
 */
export async function runAgentTurnStream(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  model: string | undefined,
  onDelta: (text: string) => void
): Promise<AgentResult> {
  const stream = await client.chat.completions.create({
    model: model || MODEL,
    temperature: 0.4,
    max_tokens: 1800,
    tools: AGENT_TOOLS,
    tool_choice: "auto",
    stream: true,
    messages: [{ role: "system", content: systemPrompt }, ...history],
  });

  let content = "";
  const toolAcc = new Map<number, { name: string; args: string }>();
  let finishReason: string | null = null;
  let emitted = "";

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const d = choice.delta as { content?: string | null; tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[] } | undefined;
    if (d?.content) content += d.content;
    if (d?.tool_calls) {
      for (const tc of d.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = toolAcc.get(idx) ?? { name: "", args: "" };
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolAcc.set(idx, cur);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;

    // Build the current best-effort preview: reply from the first tool call, else content.
    const primary = toolAcc.get(0);
    let preview = primary ? extractPartialReply(primary.args) : "";
    if (!preview && content) preview = stripScaffold(content);
    if (preview.length > emitted.length) {
      onDelta(preview.slice(emitted.length));
      emitted = preview;
    }
  }

  const calls = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ function: { name: v.name, arguments: v.args } }));
  const rawToolCalls = calls.map((c) => ({ name: c.function.name || "?", arguments: c.function.arguments || "" }));
  return buildAgentResult(calls, content, rawToolCalls, finishReason);
}

/** Generic: ask the model for a JSON object of an arbitrary shape. Returns null on parse failure. */
export async function completeJson<T>(systemPrompt: string, userContent: string, model?: string): Promise<T | null> {
  const completion = await client.chat.completions.create({
    model: model || MODEL,
    temperature: 0.3,
    max_tokens: 900,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  const raw = rawFromMessage(completion.choices[0]?.message);
  const jsonStr = extractJson(raw);
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

/** Compress a conversation transcript into a compact memory entry (heading + brief summary). */
export async function summarizeForCompaction(
  transcript: string,
  model?: string
): Promise<{ heading: string; summary: string }> {
  const sys =
    'You compress a conversation into a compact memory entry so it can be re-surfaced later when relevant. ' +
    'Return ONLY JSON: {"heading": "<=6 words naming the topic", "summary": "1-2 sentences on what was discussed or decided"}. No preamble, no markdown.';
  const r = await completeJson<{ heading: string; summary: string }>(sys, transcript.slice(0, 8000), model);
  return {
    heading: (r?.heading || "").trim() || "Earlier conversation",
    summary: (r?.summary || "").trim() || "A previous discussion in this workspace.",
  };
}

/** Given the user's new message and the list of compacted entries, pick which are relevant to bring back. */
export async function selectRelevantCompactions(
  message: string,
  entries: { id: string; heading: string; summary: string }[],
  model?: string
): Promise<string[]> {
  if (!entries.length) return [];
  const list = entries.map((e) => `[${e.id}] ${e.heading} — ${e.summary}`).join("\n");
  const sys =
    "You decide which past compacted conversations are relevant to the user's new message. " +
    'Return ONLY JSON {"ids": ["<id>", ...]} listing just the ids whose content would genuinely help with the new message. ' +
    'Be selective — return {"ids": []} if none clearly apply.';
  const r = await completeJson<{ ids: string[] }>(sys, `PAST COMPACTIONS:\n${list}\n\nNEW MESSAGE:\n${message}`, model);
  const valid = new Set(entries.map((e) => e.id));
  return (Array.isArray(r?.ids) ? r!.ids : []).filter((id) => valid.has(id));
}

export async function relayTurn(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<MiniMaxCallResult> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    max_tokens: 1200,
    messages: [{ role: "system", content: systemPrompt }, ...history],
  });

  const raw = rawFromMessage(completion.choices[0]?.message);
  const jsonStr = extractJson(raw);

  if (!jsonStr) {
    // Fallback: treat the whole cleaned text as a plain coaching reply.
    const cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<\/?minimax:tool_call>/gi, "")
      .replace(/<\/?message>/gi, "")
      .trim();
    return {
      turn: {
        reply: cleaned || "Sorry — I didn't catch that. Could you say a bit more?",
        stage: "coaching",
      },
      raw,
    };
  }

  try {
    const parsed = JSON.parse(jsonStr) as RelayTurn;
    if (!parsed.reply) parsed.reply = "Got it.";
    if (!parsed.stage) parsed.stage = "coaching";
    return { turn: parsed, raw };
  } catch {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    return {
      turn: { reply: cleaned || "Let me try that again — could you rephrase?", stage: "coaching" },
      raw,
    };
  }
}
