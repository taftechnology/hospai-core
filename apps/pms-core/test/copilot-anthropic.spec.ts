import { describe, expect, it } from 'vitest';
import { COPILOT_TOOLS } from '@hospai/contracts';
import {
  AnthropicModel,
  CopilotModelError,
  FakeCopilotModel,
  OpenAiCompatibleModel,
  copilotToolSpecs,
  selectCopilotModel,
  type CopilotModelMessage,
} from '../src/copilot-model.js';
import { runCopilot } from '../src/copilot-run.js';

/** R4.16 amendment: the native Anthropic adapter (spec D2). No network: `fetchImpl` is mocked. */

const SECRET_KEY = 'sk-ant-test-key-do-not-leak';
const PROVIDER_TEXT = 'provider says: internal detail about your account';

type Sent = { url: string; headers: Headers; body: Record<string, any> };

function mockFetch(responses: Array<Record<string, unknown> | Response | Error>) {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: new Headers(init?.headers as HeadersInit),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, any>,
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

function message(content: unknown[], stop_reason: string) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const model = (fetchImpl: typeof fetch) => new AnthropicModel({ model: 'claude-haiku-5-5', apiKey: SECRET_KEY, fetchImpl });
const tools = copilotToolSpecs(COPILOT_TOOLS);
const ask: CopilotModelMessage[] = [
  { role: 'system', content: 'You are the copilot.' },
  { role: 'user', content: 'Who arrives today?' },
];

describe('AnthropicModel request', () => {
  it('sends the documented body and no sampling or thinking parameters', async () => {
    const { sent, fetchImpl } = mockFetch([message([{ type: 'text', text: 'Hello.' }], 'end_turn')]);
    const out = await model(fetchImpl).step(ask, tools);
    expect(out).toEqual({ text: 'Hello.' });
    expect(sent).toHaveLength(1);
    const { body, headers, url } = sent[0]!;
    expect(url).toContain('/v1/messages');
    // SDK 1.x authenticates with a bearer header.
    expect(headers.get('authorization')).toBe(`Bearer ${SECRET_KEY}`);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(8000);
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tool_choice).toEqual({ type: 'auto' });
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'stream']) expect(body, k).not.toHaveProperty(k);
    expect(body.system).toBe('You are the copilot.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Who arrives today?' }]);
    expect(body.tools).toHaveLength(tools.length);
    expect(body.tools[0]).toEqual({
      name: tools[0]!.toolId,
      description: tools[0]!.description,
      input_schema: tools[0]!.parameters,
    });
  });

  it('every tool id is a valid Anthropic tool name', () => {
    for (const t of tools) expect(t.toolId).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it('honours a custom base URL', async () => {
    const { sent, fetchImpl } = mockFetch([message([{ type: 'text', text: 'ok' }], 'end_turn')]);
    await new AnthropicModel({ model: 'm', apiKey: 'k', baseUrl: 'https://gw.example.test/', fetchImpl }).step(ask, tools);
    expect(sent[0]!.url.startsWith('https://gw.example.test/')).toBe(true);
  });
});

describe('AnthropicModel responses', () => {
  it('parses tool_use blocks and returns the provider content untouched', async () => {
    const content = [
      { type: 'thinking', thinking: 'Need the arrivals report.', signature: 'sig-abc==' },
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'toolu_1', name: 'front_office_report', input: { reportId: 'front_office_arrivals' } },
    ];
    const { fetchImpl } = mockFetch([message(content, 'tool_use')]);
    const out = await model(fetchImpl).step(ask, tools);
    expect(out).toEqual({
      toolCalls: [{ id: 'toolu_1', toolId: 'front_office_report', args: { reportId: 'front_office_arrivals' } }],
      providerContent: content,
    });
  });

  it('answers a refusal with the fixed sentence', async () => {
    const { fetchImpl } = mockFetch([message([], 'refusal')]);
    expect(await model(fetchImpl).step(ask, tools)).toEqual({ text: "I can't answer that question." });
  });

  it('treats max_tokens as truncation', async () => {
    const { fetchImpl } = mockFetch([message([{ type: 'text', text: 'cut off' }], 'max_tokens')]);
    await expect(model(fetchImpl).step(ask, tools)).rejects.toMatchObject({ message: 'provider_truncated' });
  });

  it('joins text blocks and skips thinking blocks', async () => {
    const { fetchImpl } = mockFetch([
      message(
        [
          { type: 'thinking', thinking: 'hm', signature: 's' },
          { type: 'text', text: 'One. ' },
          { type: 'text', text: 'Two.' },
        ],
        'end_turn',
      ),
    ]);
    expect(await model(fetchImpl).step(ask, tools)).toEqual({ text: 'One. Two.' });
  });
});

describe('AnthropicModel tool loop', () => {
  it('replays the first response blocks byte for byte and groups results in one user message', async () => {
    const first = [
      { type: 'thinking', thinking: 'Plan: two reads.', signature: 'EqQBCkYIARgC+/sig==' },
      { type: 'tool_use', id: 'toolu_a', name: 'front_desk_summary', input: {} },
      { type: 'tool_use', id: 'toolu_b', name: 'open_folios', input: {} },
    ];
    const { sent, fetchImpl } = mockFetch([
      message(first, 'tool_use'),
      message([{ type: 'text', text: 'Done.' }], 'end_turn'),
    ]);
    const m = model(fetchImpl);

    // Through the real run loop, so the carry in copilot-run.ts is covered.
    const result = await runCopilot({
      model: m,
      systemPrompt: 'You are the copilot.',
      turns: [{ role: 'user', content: 'How are we doing?' }],
      businessDate: '2026-11-21',
      runTool: async (toolId) => ({ ok: true, data: { toolId } }),
    });
    expect(result.answer).toContain('Done.');
    expect(sent).toHaveLength(2);

    const second = sent[1]!.body;
    expect(second.messages).toHaveLength(3);
    expect(JSON.stringify(second.messages[1])).toBe(JSON.stringify({ role: 'assistant', content: first }));
    expect(second.messages[2].role).toBe('user');
    expect(second.messages[2].content.map((b: any) => [b.type, b.tool_use_id])).toEqual([
      ['tool_result', 'toolu_a'],
      ['tool_result', 'toolu_b'],
    ]);
    expect(second).not.toHaveProperty('thinking');
    expect(second.system).toBe('You are the copilot.');
  });

  it('rebuilds tool_use blocks when no provider content is present', async () => {
    const { sent, fetchImpl } = mockFetch([message([{ type: 'text', text: 'ok' }], 'end_turn')]);
    await model(fetchImpl).step(
      [
        { role: 'user', content: 'q' },
        { role: 'assistant_tool_calls', calls: [{ id: 'c1', toolId: 'open_folios', args: { a: 1 } }] },
        { role: 'tool', callId: 'c1', toolId: 'open_folios', content: '{"ok":true}' },
      ],
      tools,
    );
    expect(sent[0]!.body.messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'open_folios', input: { a: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' }] },
    ]);
  });

  it('keeps tools defined (tool_choice none) on a no-tools step that follows tool blocks', async () => {
    const { sent, fetchImpl } = mockFetch([
      message([{ type: 'tool_use', id: 't1', name: 'open_folios', input: {} }], 'tool_use'),
      message([{ type: 'text', text: 'final' }], 'end_turn'),
    ]);
    const m = model(fetchImpl);
    const first = await m.step(ask, tools);
    if (!('toolCalls' in first)) throw new Error('expected tool calls');
    await m.step(
      [
        ...ask,
        { role: 'assistant_tool_calls', calls: first.toolCalls, providerContent: first.providerContent },
        { role: 'tool', callId: 't1', toolId: 'open_folios', content: '{}' },
      ],
      [],
    );
    expect(sent[1]!.body.tools).toHaveLength(tools.length);
    expect(sent[1]!.body.tool_choice).toEqual({ type: 'none' });
  });
});

describe('AnthropicModel errors', () => {
  for (const status of [429, 500]) {
    it(`maps HTTP ${status} to a code with no provider text and no key`, async () => {
      const { fetchImpl } = mockFetch([
        new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: PROVIDER_TEXT } }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ]);
      const err = await model(fetchImpl).step(ask, tools).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CopilotModelError);
      const msg = (err as Error).message;
      expect(msg).toBe(`provider_status_${status}`);
      expect(msg).not.toContain(PROVIDER_TEXT);
      expect(msg).not.toContain(SECRET_KEY);
    });
  }

  it('does not retry (the run has a 25s budget)', async () => {
    const { sent, fetchImpl } = mockFetch([new Response('{}', { status: 529 }), new Response('{}', { status: 529 })]);
    await expect(model(fetchImpl).step(ask, tools)).rejects.toMatchObject({ message: 'provider_status_529' });
    expect(sent).toHaveLength(1);
  });

  it('maps a network failure to provider_unreachable without leaking text', async () => {
    const { fetchImpl } = mockFetch([new TypeError(`connect failed ${SECRET_KEY}`)]);
    const err = await model(fetchImpl).step(ask, tools).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopilotModelError);
    expect((err as Error).message).toBe('provider_unreachable');
  });

  it('maps an aborted request to provider_timeout', async () => {
    const { fetchImpl } = mockFetch([message([{ type: 'text', text: 'x' }], 'end_turn')]);
    const ctl = new AbortController();
    ctl.abort();
    const err = await model(fetchImpl).step(ask, tools, { signal: ctl.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopilotModelError);
    expect((err as Error).message).toBe('provider_timeout');
  });
});

describe('selectCopilotModel with COPILOT_PROVIDER', () => {
  const base = { COPILOT_MODEL: 'claude-haiku-5-5', COPILOT_API_KEY: 'k' };

  it('selects the Anthropic adapter with model and key, with or without a valid base URL', () => {
    expect(selectCopilotModel({ COPILOT_PROVIDER: 'anthropic', ...base })).toBeInstanceOf(AnthropicModel);
    expect(selectCopilotModel({ COPILOT_PROVIDER: ' anthropic ', ...base })).toBeInstanceOf(AnthropicModel);
    expect(
      selectCopilotModel({ COPILOT_PROVIDER: 'anthropic', ...base, COPILOT_BASE_URL: 'https://gw.example.test' }),
    ).toBeInstanceOf(AnthropicModel);
  });

  it('returns null for an invalid base URL', () => {
    expect(selectCopilotModel({ COPILOT_PROVIDER: 'anthropic', ...base, COPILOT_BASE_URL: 'http://gw.example.test' })).toBeNull();
    expect(selectCopilotModel({ COPILOT_PROVIDER: 'anthropic', ...base, COPILOT_BASE_URL: 'nonsense' })).toBeNull();
  });

  it('returns null when model or key is missing, and never falls through to the fake', () => {
    expect(selectCopilotModel({ COPILOT_PROVIDER: 'anthropic', COPILOT_API_KEY: 'k', HOSPAI_UNSAFE_LOCAL: '1' })).toBeNull();
    expect(selectCopilotModel({ COPILOT_PROVIDER: 'anthropic', COPILOT_MODEL: 'm', HOSPAI_UNSAFE_LOCAL: '1' })).toBeNull();
    expect(selectCopilotModel({ COPILOT_PROVIDER: 'anthropic', COPILOT_MODEL: ' ', COPILOT_API_KEY: 'k' })).toBeNull();
  });

  it('returns null for any other provider value', () => {
    expect(
      selectCopilotModel({ COPILOT_PROVIDER: 'openai', ...base, COPILOT_BASE_URL: 'https://x.example.test/v1', HOSPAI_UNSAFE_LOCAL: '1' }),
    ).toBeNull();
    expect(selectCopilotModel({ COPILOT_PROVIDER: 'Anthropic', ...base })).toBeNull();
  });

  it('leaves selection unchanged when the provider is empty or absent', () => {
    expect(selectCopilotModel({ COPILOT_PROVIDER: '  ', HOSPAI_UNSAFE_LOCAL: '1' })).toBeInstanceOf(FakeCopilotModel);
    expect(
      selectCopilotModel({ COPILOT_PROVIDER: '', ...base, COPILOT_BASE_URL: 'https://x.example.test/v1' }),
    ).toBeInstanceOf(OpenAiCompatibleModel);
    expect(selectCopilotModel({})).toBeNull();
  });
});
