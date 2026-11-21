import { describe, expect, it } from 'vitest';
import { COMMAND_CATALOG } from './commands/catalog.js';
import { AUDIT_WRITER_COMMAND_IDS } from './commands/audit-writers.js';
import {
  COPILOT_MAX_TOOL_CALLS,
  COPILOT_POST_READ_ROUTE_IDS,
  COPILOT_MAX_TURN_CHARS,
  COPILOT_MAX_TURNS,
  COPILOT_TOOLS,
  collectGuestRefs,
  copilotTool,
  copilotToolJsonSchema,
  copilotToolRequestBody,
  copilotToolRequestPath,
  isCopilotSpaHref,
  parseCopilotRequest,
  parseCopilotToolArgs,
} from './copilot.js';
import { COPILOT_UNAVAILABLE } from './idempotency.js';
import { COMMAND_ERROR_CODES } from './command-error.js';
import { GRANTABLE_PERMISSIONS, ROLE_GRANTS } from './permissions.js';
import { REPORT_DEFINITIONS } from './reports.js';
import { V1_HTTP_ROUTE_AUDIT } from './v1-http-routes.js';

describe('copilot tool registry (R4.16)', () => {
  it('maps every tool to an existing read route: a GET, or an allow-listed POST, never a command', () => {
    expect(COPILOT_TOOLS.length).toBeGreaterThan(0);
    for (const tool of COPILOT_TOOLS) {
      const route = V1_HTTP_ROUTE_AUDIT.find((r) => r.id === tool.routeId);
      expect(route, `${tool.toolId} → ${tool.routeId}`).toBeDefined();
      if ((tool.method ?? 'GET') === 'GET') {
        expect(tool.routeId.startsWith('get_'), `${tool.toolId} must be a GET route`).toBe(true);
        expect(tool.params.some((p) => p.where === 'body')).toBe(false);
      } else {
        expect(COPILOT_POST_READ_ROUTE_IDS, `${tool.toolId} POST route not allow-listed`).toContain(tool.routeId);
        expect(tool.routeId.startsWith('post_')).toBe(true);
      }
      expect(route && 'commandId' in route && route.commandId, `${tool.toolId} is a command`).toBeFalsy();
      expect(route?.scope).toBe('property');
      expect(tool.pathTemplate.startsWith('/v1/properties/{propertyId}')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('has unique tool ids and covers the spec list', () => {
    const ids = COPILOT_TOOLS.map((t) => t.toolId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'front_desk_summary',
      'room_board',
      'reservation_search',
      'reservation_detail',
      'reservation_folio',
      'open_folios',
      'housekeeping_dashboard',
      'housekeeping_tasks',
      'front_office_report',
      'cashier_report',
      'night_audit_report',
      'housekeeping_report',
      'manager_report',
      'night_audit_status',
    ]);
  });

  it('never lets the model name the property: no tool has a propertyId or orgId parameter', () => {
    for (const tool of COPILOT_TOOLS) {
      for (const p of tool.params) expect(['propertyId', 'orgId']).not.toContain(p.name);
    }
  });

  it('report tools list exactly the registry reports of their route', () => {
    const covered: string[] = [];
    for (const toolId of ['front_office_report', 'cashier_report', 'night_audit_report', 'housekeeping_report']) {
      const tool = copilotTool(toolId)!;
      const reportId = tool.params.find((p) => p.name === 'reportId')!;
      covered.push(...(reportId.values ?? []));
      for (const id of reportId.values ?? []) {
        expect(REPORT_DEFINITIONS.find((d) => d.id === id)?.routeId).toBe(tool.routeId);
      }
    }
    expect([...covered].sort()).toEqual(REPORT_DEFINITIONS.map((d) => d.id).sort());
  });

  it('source and action links are SPA paths, and carry no raw tenant ids', () => {
    for (const tool of COPILOT_TOOLS) {
      const args: Record<string, string> = { reservationId: 'res_1', reportId: tool.params.find((p) => p.name === 'reportId')?.values?.[0] ?? '' };
      const links = [tool.source(args), ...tool.actions(args)];
      for (const l of links) {
        expect(isCopilotSpaHref(l.href), `${tool.toolId}: ${l.href}`).toBe(true);
        expect(l.label.length).toBeGreaterThan(0);
        expect(l.href).not.toContain('propertyId');
      }
    }
    expect(isCopilotSpaHref('https://evil.example/x')).toBe(false);
    expect(isCopilotSpaHref('//evil.example/x')).toBe(false);
    expect(isCopilotSpaHref('javascript:alert(1)')).toBe(false);
  });

  it('caps the loop at six tool calls', () => {
    expect(COPILOT_MAX_TOOL_CALLS).toBe(6);
  });
});

describe('POST read tools', () => {
  it('the allow-list is exactly the desk search, and its text goes in the body, never the URL', () => {
    expect(COPILOT_POST_READ_ROUTE_IDS).toEqual(['post_reservation_search']);
    expect(COPILOT_TOOLS.filter((t) => t.method === 'POST').map((t) => t.routeId)).toEqual(['post_reservation_search']);
    const search = copilotTool('reservation_search')!;
    const parsed = parseCopilotToolArgs(search, { q: '  Chetan Rao ' });
    expect(parsed).toEqual({ ok: true, args: { q: 'Chetan Rao' } });
    if (parsed.ok) {
      expect(copilotToolRequestPath(search, 'p1', parsed.args)).toBe('/v1/properties/p1/reservations-search');
      expect(copilotToolRequestBody(search, parsed.args)).toEqual({ q: 'Chetan Rao' });
    }
    expect(copilotToolRequestBody(copilotTool('open_folios')!, {})).toBeNull();
  });
});

describe('copilot tool arguments', () => {
  const summary = copilotTool('front_desk_summary')!;
  const detail = copilotTool('reservation_detail')!;
  const report = copilotTool('front_office_report')!;

  it('fills a date from the business date and rejects unknown names and bad values', () => {
    expect(parseCopilotToolArgs(summary, {}, { businessDate: '2026-11-21' })).toEqual({
      ok: true,
      args: { date: '2026-11-21' },
    });
    expect(parseCopilotToolArgs(summary, {})).toEqual({ ok: false, error: 'invalid_args', detail: 'date_required' });
    expect(parseCopilotToolArgs(summary, { date: '2026-02-30' })).toMatchObject({ ok: false, detail: 'invalid_date' });
    expect(parseCopilotToolArgs(summary, { date: 20260101 })).toMatchObject({ ok: false, detail: 'invalid_date' });
    expect(parseCopilotToolArgs(summary, { propertyId: 'prop_other' })).toEqual({
      ok: false,
      error: 'invalid_args',
      detail: 'unknown_propertyId',
    });
    expect(parseCopilotToolArgs(summary, 'x')).toMatchObject({ ok: false, detail: 'args_not_object' });
  });

  it('keeps path segments safe', () => {
    expect(parseCopilotToolArgs(detail, { reservationId: '../prop_b/folio' })).toMatchObject({
      ok: false,
      detail: 'invalid_reservationId',
    });
    expect(parseCopilotToolArgs(detail, { reservationId: 'a/b' })).toMatchObject({ ok: false });
    expect(parseCopilotToolArgs(detail, {})).toMatchObject({ ok: false, detail: 'reservationId_required' });
    const ok = parseCopilotToolArgs(detail, { reservationId: 'res_ab-1' });
    expect(ok).toEqual({ ok: true, args: { reservationId: 'res_ab-1' } });
    if (ok.ok) {
      expect(copilotToolRequestPath(detail, 'prop 1', ok.args)).toBe(
        '/v1/properties/prop%201/reservations/res_ab-1',
      );
    }
  });

  it('accepts only registry report ids and builds the query', () => {
    expect(parseCopilotToolArgs(report, { reportId: 'cashier_summary' })).toMatchObject({ ok: false });
    const ok = parseCopilotToolArgs(report, { reportId: 'front_office_arrivals', from: '2026-11-20', to: '2026-11-21' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(copilotToolRequestPath(report, 'p1', ok.args)).toBe(
        '/v1/properties/p1/reports/front-office/front_office_arrivals?from=2026-11-20&to=2026-11-21',
      );
    }
  });

  it('produces a closed JSON schema for the model', () => {
    const schema = copilotToolJsonSchema(report);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['reportId']);
    expect(schema.properties.reportId?.enum).toContain('front_office_arrivals');
    expect(copilotToolJsonSchema(summary).required).toEqual([]);
  });
});

describe('copilot request body', () => {
  const turn = (role: 'user' | 'assistant', content: string) => ({ role, content });

  it('accepts a conversation that ends with a user turn', () => {
    expect(parseCopilotRequest({ messages: [turn('user', 'Who arrives today?')] })).toEqual({
      ok: true,
      messages: [turn('user', 'Who arrives today?')],
    });
    expect(
      parseCopilotRequest({ messages: [turn('user', 'a'), turn('assistant', 'b'), turn('user', 'c')] }).ok,
    ).toBe(true);
  });

  it('rejects the wrong shape', () => {
    for (const body of [
      null,
      [],
      {},
      { messages: [] },
      { messages: 'x' },
      { messages: [turn('assistant', 'x')] },
      { messages: [{ role: 'system', content: 'x' }] },
      { messages: [{ role: 'user', content: 5 }] },
      { messages: [turn('user', '   ')] },
    ]) {
      expect(parseCopilotRequest(body), JSON.stringify(body)).toEqual({ ok: false, error: 'invalid_body' });
    }
  });

  it('caps turns at 20 and characters at 4,000', () => {
    const many = Array.from({ length: COPILOT_MAX_TURNS + 1 }, () => turn('user', 'x'));
    expect(parseCopilotRequest({ messages: many })).toMatchObject({ ok: false, error: 'limit_exceeded', limit: 'turns' });
    const exactly = Array.from({ length: COPILOT_MAX_TURNS }, (_, i) => turn(i % 2 === 0 ? 'assistant' : 'user', 'x'));
    expect(parseCopilotRequest({ messages: exactly }).ok).toBe(true);
    expect(
      parseCopilotRequest({ messages: [turn('user', 'x'.repeat(COPILOT_MAX_TURN_CHARS))] }).ok,
    ).toBe(true);
    expect(
      parseCopilotRequest({ messages: [turn('user', 'x'.repeat(COPILOT_MAX_TURN_CHARS + 1))] }),
    ).toMatchObject({ ok: false, error: 'limit_exceeded', limit: 'chars' });
  });
});

describe('guest reference collection', () => {
  it('counts distinct references, in report columns and in plain fields', () => {
    const report = {
      columns: [
        { key: 'guest', type: 'guest' },
        { key: 'room', type: 'text' },
      ],
      rows: [
        { guest: 'g_1', room: 'g_not_a_guest' },
        { guest: 'g_1', room: '101' },
        { guest: 'g_2', room: '102' },
      ],
    };
    expect([...collectGuestRefs(report)].sort()).toEqual(['g_1', 'g_2']);
    expect([...collectGuestRefs({ items: [{ guestRef: 'g_3' }, { guestRef: 'g_3' }, { guestRef: 'g_4' }] })].sort()).toEqual([
      'g_3',
      'g_4',
    ]);
    expect(collectGuestRefs({ ok: true, rooms: [{ id: 'r1' }] }).size).toBe(0);
  });
});

describe('copilot pins and permission', () => {
  it('grants copilot:use to staff, admin and owner', () => {
    for (const role of ['staff', 'admin', 'owner'] as const) {
      expect(ROLE_GRANTS[role]).toContain('copilot:use');
    }
    expect(GRANTABLE_PERMISSIONS).toContain('copilot:use');
  });

  it('records reads through an internal audit-writing command with no HTTP route', () => {
    const entry = COMMAND_CATALOG.find((c) => c.id === 'copilot.record_read');
    expect(entry).toMatchObject({
      lane: 'INTERACTIVE',
      degraded: 'FAIL_CLOSED',
      idempotent: true,
      entitlement: 'ai_ops.enabled',
      permission: 'copilot:use',
      events: [],
    });
    expect(AUDIT_WRITER_COMMAND_IDS.has('copilot.record_read')).toBe(true);
    expect(V1_HTTP_ROUTE_AUDIT.some((r) => 'commandId' in r && r.commandId === 'copilot.record_read')).toBe(false);
  });

  it('declares the route once, last, with the permission and entitlement', () => {
    expect(V1_HTTP_ROUTE_AUDIT.filter((r) => r.id === 'post_copilot_message')).toHaveLength(1);
    expect(V1_HTTP_ROUTE_AUDIT.at(-1)).toEqual({
      id: 'post_copilot_message',
      scope: 'property',
      permission: 'copilot:use',
      entitlement: 'ai_ops.enabled',
    });
  });

  it('copilot_unavailable is a registered wire code', () => {
    expect(COPILOT_UNAVAILABLE).toBe('copilot_unavailable');
    expect(COMMAND_ERROR_CODES).toContain('copilot_unavailable');
  });
});
