import {
  COPILOT_MAX_SOURCES,
  COPILOT_MAX_TURN_CHARS,
  COPILOT_MAX_SUGGESTED_ACTIONS,
  COPILOT_MAX_TOOL_CALLS,
  COPILOT_NO_RECORDS_SENTENCE,
  COPILOT_TOOLS,
  collectGuestRefs,
  copilotTool,
  parseCopilotToolArgs,
  type CopilotLink,
  type CopilotToolUse,
  type CopilotTurn,
} from '@hospai/contracts';
import { collectChainIds, redactUuids } from './copilot-guests.js';
import {
  CopilotModelError,
  copilotToolSpecs,
  type CopilotModel,
  type CopilotModelMessage,
  type CopilotToolCall,
} from './copilot-model.js';

/** Total wall time for one question, under the Worker limits. */
export const COPILOT_TIME_BUDGET_MS = 25_000;
/** A tool result handed to the model is cut down to this many characters of JSON. */
export const COPILOT_TOOL_RESULT_CHARS = 20_000;
/**
 * The answer text is cut so that, with the "no records" sentence appended, it still fits in one
 * conversation turn: the client sends the answer back as history, and a turn is capped.
 */
export const COPILOT_ANSWER_MAX_CHARS = COPILOT_MAX_TURN_CHARS - COPILOT_NO_RECORDS_SENTENCE.length - 2;

/** What reading one tool gave: the route's body, or why there is no body. */
export type CopilotToolOutcome =
  | {
      ok: true;
      data: unknown;
      /** Guest references read, counted for the audit row. `data` no longer holds them. */
      guestRefs?: readonly string[];
    }
  | { ok: false; status: number; error: string; detail?: string };

export type CopilotRunResult = {
  answer: string;
  toolsUsed: CopilotToolUse[];
  sources: CopilotLink[];
  suggestedActions: CopilotLink[];
  /** Distinct guest references across every tool result that returned data. */
  guestRefs: Set<string>;
  /** Distinct tool ids that returned data. */
  readToolIds: string[];
};

/**
 * Cuts long arrays until the JSON fits. A report can hold 2,000 rows; the model needs the first
 * few and the fact that there are more.
 */
export function compactToolResult(value: unknown, maxChars = COPILOT_TOOL_RESULT_CHARS): string {
  const whole = JSON.stringify(value) ?? 'null';
  if (whole.length <= maxChars) return whole;
  for (const keep of [50, 25, 10, 5, 2]) {
    const trimmed = JSON.stringify(trimArrays(value, keep));
    if (trimmed !== undefined && trimmed.length <= maxChars) return trimmed;
  }
  return JSON.stringify({ truncated: true, note: 'The result was too large to include.' });
}

function trimArrays(value: unknown, keep: number): unknown {
  if (Array.isArray(value)) {
    const head = value.slice(0, keep).map((v) => trimArrays(v, keep));
    return value.length > keep ? [...head, { omittedRows: value.length - keep }] : head;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, trimArrays(v, keep)]),
    );
  }
  return value;
}

function outcomeForModel(outcome: CopilotToolOutcome): string {
  if (outcome.ok) return compactToolResult({ ok: true, data: outcome.data });
  return JSON.stringify({
    ok: false,
    status: outcome.status,
    error: outcome.error,
    ...(outcome.detail ? { detail: outcome.detail } : {}),
  });
}

function pushUnique(list: CopilotLink[], link: CopilotLink, cap: number): void {
  if (list.length >= cap) return;
  if (list.some((l) => l.href === link.href)) return;
  list.push(link);
}

/**
 * The tool loop for one question: at most six tool calls, one total time budget. The model sees
 * only what the user's own routes returned. Sources and next actions come from the registry, never
 * from the model's text, so the model cannot cite a screen it did not read or invent a link.
 */
export async function runCopilot(opts: {
  model: CopilotModel;
  systemPrompt: string;
  turns: readonly CopilotTurn[];
  businessDate: string | null;
  /** Executes a validated call as the asking user. */
  runTool: (toolId: string, args: Record<string, string>) => Promise<CopilotToolOutcome>;
  budgetMs?: number;
  now?: () => number;
}): Promise<CopilotRunResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? COPILOT_TIME_BUDGET_MS);
  const tools = copilotToolSpecs(COPILOT_TOOLS);

  const messages: CopilotModelMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.turns.map((t) => ({ role: t.role, content: t.content }) as CopilotModelMessage),
  ];

  const toolsUsed: CopilotToolUse[] = [];
  const sources: CopilotLink[] = [];
  const actions: CopilotLink[] = [];
  const guestRefs = new Set<string>();
  const readToolIds = new Set<string>();
  const knownIds = new Set<string>();
  let calls = 0;
  let text: string | null = null;

  const step = async (withTools: boolean) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new CopilotModelError('time_budget');
    return opts.model.step(messages, withTools ? tools : [], { signal: AbortSignal.timeout(remaining) });
  };

  // At most one model call per tool round, plus the final answer.
  for (let round = 0; round <= COPILOT_MAX_TOOL_CALLS; round++) {
    const out = await step(calls < COPILOT_MAX_TOOL_CALLS);
    if ('text' in out) {
      text = out.text;
      break;
    }
    if (out.toolCalls.length === 0) {
      text = '';
      break;
    }
    messages.push({
      role: 'assistant_tool_calls',
      calls: out.toolCalls,
      ...(out.providerContent !== undefined ? { providerContent: out.providerContent } : {}),
    });
    for (const call of out.toolCalls) {
      messages.push({
        role: 'tool',
        callId: call.id,
        toolId: call.toolId,
        content: outcomeForModel(await executeCall(call)),
      });
    }
  }

  async function executeCall(call: CopilotToolCall): Promise<CopilotToolOutcome> {
    if (calls >= COPILOT_MAX_TOOL_CALLS) {
      return { ok: false, status: 429, error: 'tool_budget_exhausted' };
    }
    const tool = copilotTool(call.toolId);
    if (!tool) return { ok: false, status: 400, error: 'unknown_tool' };
    calls += 1;
    const parsed = parseCopilotToolArgs(tool, call.args, { businessDate: opts.businessDate });
    if (!parsed.ok) {
      toolsUsed.push({ toolId: tool.toolId, ok: false });
      return { ok: false, status: 400, error: parsed.error, detail: parsed.detail };
    }
    const outcome = await opts.runTool(tool.toolId, parsed.args);
    toolsUsed.push({ toolId: tool.toolId, ok: outcome.ok });
    if (outcome.ok) {
      readToolIds.add(tool.toolId);
      for (const ref of collectGuestRefs(outcome.data)) guestRefs.add(ref);
      for (const ref of outcome.guestRefs ?? []) guestRefs.add(ref);
      for (const id of collectChainIds(outcome.data)) knownIds.add(id);
      pushUnique(sources, tool.source(parsed.args), COPILOT_MAX_SOURCES);
      for (const link of tool.actions(parsed.args)) pushUnique(actions, link, COPILOT_MAX_SUGGESTED_ACTIONS);
    }
    return outcome;
  }

  // The model kept asking for tools past the budget: take whatever it says without tools.
  if (text === null) {
    const out = await step(false);
    text = 'text' in out ? out.text : '';
  }

  let answer = redactUuids(text, knownIds).trim().slice(0, COPILOT_ANSWER_MAX_CHARS).trim();
  if (answer === '') answer = 'I could not put an answer together. Try asking in a different way.';
  if (sources.length === 0 && !answer.includes(COPILOT_NO_RECORDS_SENTENCE)) {
    answer = `${answer}\n\n${COPILOT_NO_RECORDS_SENTENCE}`;
  }

  return {
    answer,
    toolsUsed,
    sources: sources.map((l) => ({ ...l, label: redactUuids(l.label, knownIds) })),
    suggestedActions: actions.map((l) => ({ ...l, label: redactUuids(l.label, knownIds) })),
    guestRefs,
    readToolIds: [...readToolIds],
  };
}
