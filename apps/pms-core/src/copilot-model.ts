import Anthropic from '@anthropic-ai/sdk';
import {
  COPILOT_TOOLS,
  copilotToolJsonSchema,
  type CopilotToolDef,
} from '@hospai/contracts';
import type { PmsEnv } from './env.js';

/**
 * The copilot's model adapter (R4.16, spec D2). The route knows only this interface, so the
 * provider is a configuration choice: nothing here names a vendor, a URL or a key.
 *   - `FakeCopilotModel`: deterministic keyword to tool mapping for tests, and for local dev behind
 *     `HOSPAI_UNSAFE_LOCAL`, so the demo works without a provider.
 *   - `OpenAiCompatibleModel`: a chat-completions endpoint with tool calling. Off unless
 *     `COPILOT_BASE_URL`, `COPILOT_MODEL` and the secret `COPILOT_API_KEY` are all set.
 *   - `AnthropicModel`: the Anthropic Messages API through the official SDK. Chosen only by
 *     `COPILOT_PROVIDER=anthropic`, and then needs `COPILOT_MODEL` and the secret
 *     `COPILOT_API_KEY`; `COPILOT_BASE_URL` is optional. Without that provider setting, selection
 *     is exactly as before.
 */

export type CopilotModelToolSpec = {
  toolId: string;
  description: string;
  parameters: ReturnType<typeof copilotToolJsonSchema>;
};

export type CopilotToolCall = { id: string; toolId: string; args: unknown };

export type CopilotModelMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  /** The model asked for these tools. */
  | {
      role: 'assistant_tool_calls';
      calls: CopilotToolCall[];
      /**
       * Opaque provider content for this assistant turn (the Anthropic adapter's exact content
       * blocks, thinking included, which the API requires back unchanged inside a tool loop). Held
       * in memory for one question only: never logged, stored or returned. Other adapters ignore it.
       */
      providerContent?: unknown;
    }
  /** What a tool returned (JSON text), or why it could not be read. */
  | { role: 'tool'; callId: string; toolId: string; content: string };

export type CopilotModelStep =
  | { text: string }
  | { toolCalls: CopilotToolCall[]; providerContent?: unknown };

export interface CopilotModel {
  readonly kind: 'fake' | 'openai_compatible' | 'anthropic';
  step(
    messages: readonly CopilotModelMessage[],
    tools: readonly CopilotModelToolSpec[],
    opts?: { signal?: AbortSignal },
  ): Promise<CopilotModelStep>;
}

/** Any model failure: the route answers 503 `copilot_unavailable`. The message is a code, never provider text. */
export class CopilotModelError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'CopilotModelError';
  }
}

export function copilotToolSpecs(tools: readonly CopilotToolDef[] = COPILOT_TOOLS): CopilotModelToolSpec[] {
  return tools.map((t) => ({
    toolId: t.toolId,
    description: t.description,
    parameters: copilotToolJsonSchema(t),
  }));
}

// ---------------------------------------------------------------------------------------------
// Fake
// ---------------------------------------------------------------------------------------------

const ID_PHRASE = /\b(?:reservation|folio|stay|booking|bill)\s+(?:for\s+|of\s+|id\s+|number\s+|#\s*|:\s*)?([A-Za-z0-9_.:@|-]{4,128})/i;
const RES_PREFIX = /\b(res[_-][A-Za-z0-9_.:@|-]{1,120})/i;
const UUID_TOKEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const FOLIO_NAME = /\b(?:folio|bill|balance)\s+(?:for|of)\s+(.{2,128}?)[?!.]*$/i;
const STOP_WORDS = new Set(['today', 'tonight', 'tomorrow', 'yesterday', 'details', 'balance', 'status', 'folio', 'please']);

function lastUserText(messages: readonly CopilotModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user') return m.content;
  }
  return '';
}

function toolMessagesAfterLastUser(messages: readonly CopilotModelMessage[]): CopilotModelMessage[] {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      start = i + 1;
      break;
    }
  }
  return messages.slice(start).filter((m) => m.role === 'tool');
}

function extractReservationId(text: string): string | null {
  const prefixed = RES_PREFIX.exec(text);
  if (prefixed) return prefixed[1]!;
  const phrase = ID_PHRASE.exec(text);
  const id = phrase?.[1]?.replace(/[.,;:!?]+$/, '');
  if (id && !STOP_WORDS.has(id.toLowerCase()) && /[0-9_-]/.test(id)) return id;
  return null;
}

function extractSearchTerm(text: string): string | null {
  const quoted = /["“']([^"”']{1,128})["”']/.exec(text);
  if (quoted) return quoted[1]!.trim();
  const m = /\b(?:find|search(?:\s+for)?|look\s*up|named|guest)\s+(.{1,128})$/i.exec(text.trim());
  if (!m) return null;
  const term = m[1]!.replace(/[?!.]+$/, '').trim();
  return term === '' ? null : term;
}

type Plan = Array<{ toolId: string; args: Record<string, string> }>;

/** Which tools a question needs. Deterministic: the same words always give the same plan. */
export function planFakeCopilotCalls(question: string): Plan {
  const q = question.toLowerCase();
  const plan: Plan = [];
  const add = (toolId: string, args: Record<string, string> = {}) => {
    if (!plan.some((p) => p.toolId === toolId && JSON.stringify(p.args) === JSON.stringify(args))) {
      plan.push({ toolId, args });
    }
  };

  const reservationId = extractReservationId(question);
  const wantsFolio = /\b(folio|balance|bill|owe|charges?)\b/.test(q);
  if (reservationId && wantsFolio) add('reservation_folio', { reservationId });
  else if (reservationId) add('reservation_detail', { reservationId });

  if (/manager('s)? report/.test(q)) add('manager_report');
  if (/\barriv/.test(q)) add('front_office_report', { reportId: 'front_office_arrivals' });
  if (/\bdepart|check(ing)?[ -]?out/.test(q)) add('front_office_report', { reportId: 'front_office_departures' });
  if (/in[- ]house|currently staying/.test(q)) add('front_office_report', { reportId: 'front_office_in_house' });
  // A bare id with a folio request: look it up first, then read its folio with what the lookup returned.
  const bareId = UUID_TOKEN.exec(question)?.[0];
  if (!reservationId && bareId && wantsFolio) add('reservation_search', { q: bareId });
  // "folio for <guest name>": find the stay by name, then read its folio (see chainFolioCall).
  const folioName = !reservationId && !bareId ? FOLIO_NAME.exec(question.trim())?.[1]?.trim() : undefined;
  if (folioName && /[a-z]/i.test(folioName) && !/^(the |a |an |reservation|stay|booking)/i.test(folioName)) {
    add('reservation_search', { q: folioName });
  }
  if (!reservationId && /open folios?|folios?\b.*\bopen|unsettled|outstanding/.test(q)) add('open_folios');
  if (/housekeeping task|cleaning task/.test(q)) add('housekeeping_tasks');
  else if (/housekeeping|\bclean|\bdirty|inspect/.test(q)) add('housekeeping_dashboard');
  if (/night audit|\baudit\b|exception/.test(q)) add('night_audit_status');
  if (/room board|live rooms?|room status|which rooms/.test(q)) add('room_board');
  if (/summary|overview|how are we doing|occupancy|dashboard/.test(q)) add('front_desk_summary');

  if (plan.length === 0) {
    const term = extractSearchTerm(question);
    if (term) add('reservation_search', { q: term });
  }
  return plan.slice(0, 3);
}

function firstArray(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== 'object' || depth > 2) return null;
  for (const v of Object.values(value as Record<string, unknown>)) {
    const found = firstArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Numbers in a result, with their field names as words. Times and the "as of" stamp are left out. */
function numberFacts(value: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || depth > 2) return out;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'asOf' || /At$/.test(key)) continue;
    if (typeof v === 'number') {
      out.push(`${`${prefix} ${key}`.trim().replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v}`);
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      numberFacts(v, key, depth + 1, out);
    }
  }
  return out;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function toolLabel(toolId: string): string {
  return toolId.replace(/_/g, ' ');
}

function summariseOne(toolId: string, content: string): string {
  let parsed: { ok?: boolean; status?: number; error?: string; data?: unknown };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    return `I could not read the ${toolLabel(toolId)}.`;
  }
  if (parsed.ok === false) {
    if (parsed.status === 403 || parsed.error === 'forbidden') {
      return `You do not have access to the ${toolLabel(toolId)}. Ask a manager if you need it.`;
    }
    if (parsed.status === 404 || parsed.error === 'not_found') {
      return 'I could not find that record at this property.';
    }
    if (parsed.status === 402) return 'This part of HospAI is not part of your plan.';
    return `I could not read the ${toolLabel(toolId)} right now.`;
  }
  const data = parsed.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.columns) && Array.isArray(data.rows)) {
    const columns = data.columns as Array<{ key: string; label: string; type?: string }>;
    const rows = data.rows as Array<Record<string, unknown>>;
    const lines = rows.slice(0, 5).map((row) =>
      columns
        .slice(0, 4)
        .map((c) => `${c.label}: ${row[c.key] ?? 'none'}`)
        .join(', '),
    );
    const head = `The ${toolLabel(toolId).replace(/ report$/, '')} report has ${plural(rows.length, 'row')}.`;
    const more = rows.length > lines.length ? ` (showing the first ${lines.length})` : '';
    return lines.length > 0 ? `${head}${more}\n${lines.map((l) => `- ${l}`).join('\n')}` : head;
  }
  const facts = numberFacts(data).slice(0, 8);
  if (facts.length > 0) return `${toolLabel(toolId)}: ${facts.join(', ')}.`;
  const list = firstArray(data);
  if (list) {
    return list.length === 0
      ? `Nothing came back from the ${toolLabel(toolId)}.`
      : `I read ${plural(list.length, 'record')} from the ${toolLabel(toolId)}.`;
  }
  return `I read the ${toolLabel(toolId)}.`;
}

const HELP_TEXT =
  'I can read arrivals, departures, in-house guests, open folios, housekeeping, reports and night audit status for this property. Ask about one of those, or give a reservation id.';

/** After a lookup that found a stay, a folio request continues on the id the lookup returned. */
function chainFolioCall(question: string, results: readonly CopilotModelMessage[]): CopilotToolCall | null {
  if (!/\b(folio|balance|bill|owe|charges?)\b/i.test(question)) return null;
  if (results.some((m) => m.role === 'tool' && m.toolId === 'reservation_folio')) return null;
  for (const m of results) {
    if (m.role !== 'tool' || m.toolId !== 'reservation_search') continue;
    try {
      const data = (JSON.parse(m.content) as { data?: { items?: Array<{ reservationId?: unknown }> } }).data;
      const id = data?.items?.[0]?.reservationId;
      if (typeof id === 'string' && id !== '') {
        return { id: 'fake_chain_folio', toolId: 'reservation_folio', args: { reservationId: id } };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export class FakeCopilotModel implements CopilotModel {
  readonly kind = 'fake' as const;

  async step(messages: readonly CopilotModelMessage[]): Promise<CopilotModelStep> {
    const results = toolMessagesAfterLastUser(messages);
    if (results.length > 0) {
      const chained = chainFolioCall(lastUserText(messages), results);
      if (chained) return { toolCalls: [chained] };
      const lines = results.map((m) => (m.role === 'tool' ? summariseOne(m.toolId, m.content) : ''));
      return { text: lines.join('\n') };
    }
    const plan = planFakeCopilotCalls(lastUserText(messages));
    if (plan.length === 0) return { text: HELP_TEXT };
    return {
      toolCalls: plan.map((p, i) => ({ id: `fake_${i}_${p.toolId}`, toolId: p.toolId, args: p.args })),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// OpenAI-compatible
// ---------------------------------------------------------------------------------------------

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Test seam; production uses the global fetch. */
  fetchImpl?: typeof fetch;
};

type OpenAiMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'assistant';
      content: null;
      tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAiMessages(messages: readonly CopilotModelMessage[]): OpenAiMessage[] {
  return messages.map((m): OpenAiMessage => {
    if (m.role === 'assistant_tool_calls') {
      return {
        role: 'assistant',
        content: null,
        tool_calls: m.calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.toolId, arguments: JSON.stringify(c.args ?? {}) },
        })),
      };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.callId, content: m.content };
    return { role: m.role, content: m.content };
  });
}

export class OpenAiCompatibleModel implements CopilotModel {
  readonly kind = 'openai_compatible' as const;
  private readonly endpoint: string;

  constructor(private readonly cfg: OpenAiCompatibleConfig) {
    this.endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  async step(
    messages: readonly CopilotModelMessage[],
    tools: readonly CopilotModelToolSpec[],
    opts?: { signal?: AbortSignal },
  ): Promise<CopilotModelStep> {
    const body = {
      model: this.cfg.model,
      messages: toOpenAiMessages(messages),
      temperature: 0,
      ...(tools.length > 0
        ? {
            tools: tools.map((t) => ({
              type: 'function' as const,
              function: { name: t.toolId, description: t.description, parameters: t.parameters },
            })),
            tool_choice: 'auto' as const,
          }
        : {}),
    };
    let res: Response;
    try {
      res = await (this.cfg.fetchImpl ?? fetch)(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: opts?.signal,
      });
    } catch {
      throw new CopilotModelError('provider_unreachable');
    }
    if (!res.ok) throw new CopilotModelError(`provider_status_${res.status}`);

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new CopilotModelError('provider_bad_response');
    }
    const message = (payload as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices?.[0]?.message;
    if (!message || typeof message !== 'object') throw new CopilotModelError('provider_bad_response');

    const rawCalls = message.tool_calls;
    if (Array.isArray(rawCalls) && rawCalls.length > 0) {
      const toolCalls: CopilotToolCall[] = rawCalls.map((c, i) => {
        const fn = (c as { function?: { name?: unknown; arguments?: unknown } }).function;
        const id = (c as { id?: unknown }).id;
        let args: unknown = {};
        if (typeof fn?.arguments === 'string' && fn.arguments.trim() !== '') {
          try {
            args = JSON.parse(fn.arguments) as unknown;
          } catch {
            args = 'unparseable';
          }
        }
        return {
          id: typeof id === 'string' && id !== '' ? id : `call_${i}`,
          toolId: typeof fn?.name === 'string' ? fn.name : '',
          args,
        };
      });
      return { toolCalls };
    }
    return { text: typeof message.content === 'string' ? message.content : '' };
  }
}

// ---------------------------------------------------------------------------------------------
// Anthropic (native Messages API)
// ---------------------------------------------------------------------------------------------

export type AnthropicModelConfig = {
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Test seam; passed to the SDK client as its `fetch`. Production uses the global fetch. */
  fetchImpl?: typeof fetch;
};

/** The route's budget is 25s per question; one request may not outlive it. */
const ANTHROPIC_REQUEST_TIMEOUT_MS = 20_000;
const ANTHROPIC_MAX_TOKENS = 8000;
export const ANTHROPIC_REFUSAL_SENTENCE = "I can't answer that question.";

type AnthropicWireMessage = { role: 'user' | 'assistant'; content: string | unknown[] };

/**
 * System messages go to the top-level `system` field. A tool turn replays the exact blocks the API
 * returned (`providerContent`) when present, else is rebuilt from the calls. All results that answer
 * one assistant message go in one user message, in order.
 */
export function toAnthropicRequestParts(messages: readonly CopilotModelMessage[]): {
  system: string | undefined;
  messages: AnthropicWireMessage[];
} {
  const system: string[] = [];
  const out: AnthropicWireMessage[] = [];
  let pendingResults: unknown[] | null = null;
  const flush = () => {
    if (pendingResults) out.push({ role: 'user', content: pendingResults });
    pendingResults = null;
  };
  for (const m of messages) {
    if (m.role === 'tool') {
      pendingResults ??= [];
      pendingResults.push({ type: 'tool_result', tool_use_id: m.callId, content: m.content });
      continue;
    }
    flush();
    if (m.role === 'system') system.push(m.content);
    else if (m.role === 'assistant_tool_calls') {
      out.push({
        role: 'assistant',
        content: Array.isArray(m.providerContent)
          ? (m.providerContent as unknown[])
          : m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.toolId, input: c.args ?? {} })),
      });
    } else out.push({ role: m.role, content: m.content });
  }
  flush();
  return { system: system.length > 0 ? system.join('\n\n') : undefined, messages: out };
}

function hasToolBlocks(messages: readonly CopilotModelMessage[]): boolean {
  return messages.some((m) => m.role === 'assistant_tool_calls' || m.role === 'tool');
}

function anthropicFailure(err: unknown): CopilotModelError {
  if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
    return new CopilotModelError('provider_timeout');
  }
  if (err instanceof Anthropic.APIConnectionError) return new CopilotModelError('provider_unreachable');
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    return new CopilotModelError(`provider_status_${err.status}`);
  }
  return new CopilotModelError('provider_unreachable');
}

export class AnthropicModel implements CopilotModel {
  readonly kind = 'anthropic' as const;
  private readonly client: Anthropic;
  /** The last non-empty tool list: the API wants tools defined while the history holds tool blocks. */
  private lastTools: Anthropic.Tool[] = [];

  constructor(private readonly cfg: AnthropicModelConfig) {
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
      ...(cfg.fetchImpl ? { fetch: cfg.fetchImpl } : {}),
      maxRetries: 0,
      timeout: ANTHROPIC_REQUEST_TIMEOUT_MS,
    });
  }

  async step(
    messages: readonly CopilotModelMessage[],
    tools: readonly CopilotModelToolSpec[],
    opts?: { signal?: AbortSignal },
  ): Promise<CopilotModelStep> {
    const parts = toAnthropicRequestParts(messages);
    if (tools.length > 0) {
      this.lastTools = tools.map((t) => ({
        name: t.toolId,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool.InputSchema,
      }));
    }
    // With no tools offered but tool blocks in the history, keep the tools defined and forbid use.
    const toolsOff = tools.length === 0;
    const sendTools = !toolsOff || hasToolBlocks(messages) ? this.lastTools : [];

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.cfg.model,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          output_config: { effort: 'low' },
          cache_control: { type: 'ephemeral' },
          ...(parts.system !== undefined ? { system: parts.system } : {}),
          messages: parts.messages as Anthropic.MessageParam[],
          ...(sendTools.length > 0
            ? { tools: sendTools, tool_choice: toolsOff ? { type: 'none' as const } : { type: 'auto' as const } }
            : {}),
        },
        { signal: opts?.signal },
      );
    } catch (err) {
      throw anthropicFailure(err);
    }

    const blocks = Array.isArray(response?.content) ? response.content : null;
    if (!blocks) throw new CopilotModelError('provider_bad_response');

    const toolUses = blocks.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason === 'tool_use' && toolUses.length > 0) {
      return {
        toolCalls: toolUses.map((b) => ({ id: b.id, toolId: b.name, args: b.input })),
        providerContent: blocks,
      };
    }
    if (response.stop_reason === 'refusal') return { text: ANTHROPIC_REFUSAL_SENTENCE };
    if (response.stop_reason === 'max_tokens') throw new CopilotModelError('provider_truncated');
    return {
      text: blocks
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------------------------

/** Vitest-only override, as the auth override: `'none'` forces "no provider". */
let modelOverrideForTest: CopilotModel | 'none' | null = null;

export function __setCopilotModelForTest(model: CopilotModel | 'none' | null): void {
  modelOverrideForTest = model;
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** A usable base URL: https, or http only to localhost under the local marker. */
export function validCopilotBaseUrl(raw: string, env: Pick<PmsEnv, 'HOSPAI_UNSAFE_LOCAL'>): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:' && env.HOSPAI_UNSAFE_LOCAL === '1' && isLocalhost(url.hostname)) {
    return url.toString();
  }
  return null;
}

/**
 * The configured model, or null (the route answers 503 `copilot_unavailable`). A real provider
 * needs all three settings; the fake needs the local marker. Nothing here has a default key or URL.
 */
export function selectCopilotModel(
  env: Pick<PmsEnv, 'HOSPAI_UNSAFE_LOCAL' | 'COPILOT_PROVIDER' | 'COPILOT_BASE_URL' | 'COPILOT_MODEL' | 'COPILOT_API_KEY'>,
): CopilotModel | null {
  if (modelOverrideForTest === 'none') return null;
  if (modelOverrideForTest) return modelOverrideForTest;
  const provider = env.COPILOT_PROVIDER?.trim();
  if (provider) {
    // A named provider never falls through to the fake or the OpenAI-compatible adapter.
    if (provider !== 'anthropic') return null;
    const aModel = env.COPILOT_MODEL?.trim();
    const aKey = env.COPILOT_API_KEY?.trim();
    if (!aModel || !aKey) return null;
    const rawBase = env.COPILOT_BASE_URL?.trim();
    if (!rawBase) return new AnthropicModel({ model: aModel, apiKey: aKey });
    const validBase = validCopilotBaseUrl(rawBase, env);
    return validBase ? new AnthropicModel({ model: aModel, apiKey: aKey, baseUrl: validBase }) : null;
  }
  const baseUrl = env.COPILOT_BASE_URL?.trim();
  const model = env.COPILOT_MODEL?.trim();
  const apiKey = env.COPILOT_API_KEY?.trim();
  if (baseUrl && model && apiKey) {
    const valid = validCopilotBaseUrl(baseUrl, env);
    return valid ? new OpenAiCompatibleModel({ baseUrl: valid, model, apiKey }) : null;
  }
  if (env.HOSPAI_UNSAFE_LOCAL === '1') return new FakeCopilotModel();
  return null;
}
