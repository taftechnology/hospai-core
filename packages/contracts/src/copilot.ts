import { HOUSEKEEPING_TASK_STATUSES } from './housekeeping-tasks.js';
import { REPORT_DEFINITIONS, REPORT_ROUTE_SEGMENT, type ReportRouteId } from './reports.js';

/**
 * Copilot, read-only and permission-aware (R4.16). The registry below is the one list of what the
 * copilot may read. Every tool is an existing GET route that the handler calls through `dispatchV1`
 * as the asking user, so the route's own permission, entitlement, tenant and degraded-mode gates
 * apply unchanged. No tool is a command, and no tool is a route that does not already exist.
 * Prompt text and the model provider are not part of this contract.
 * Spec: docs/superpowers/specs/2026-11-21-copilot-read-only-design.md
 */

/** Visible turns accepted in one request, and the characters in each. Over either is `limit_exceeded`. */
export const COPILOT_MAX_TURNS = 20 as const;
export const COPILOT_MAX_TURN_CHARS = 4000 as const;
/** Tool calls the loop may make for one question. */
export const COPILOT_MAX_TOOL_CALLS = 6 as const;
/** Links returned with one answer. */
export const COPILOT_MAX_SOURCES = 8 as const;
export const COPILOT_MAX_SUGGESTED_ACTIONS = 4 as const;
/** Appended when no tool returned data, so every answer carries a source or says it has none. */
export const COPILOT_NO_RECORDS_SENTENCE = 'No records were read for this answer.' as const;

/** The soft meter an answered question counts against (spec D5). */
export const COPILOT_METER_KEY = 'ai_ops.messages.limit' as const;

export type CopilotRole = 'user' | 'assistant';
export type CopilotTurn = { role: CopilotRole; content: string };

/** A link to an existing SPA screen (a path, never a POST and never another origin). */
export type CopilotLink = { label: string; href: string };
export type CopilotToolUse = { toolId: string; ok: boolean };

/** Success body of `post_copilot_message`. */
export type CopilotMessageResponse = {
  ok: true;
  answer: string;
  sources: CopilotLink[];
  suggestedActions: CopilotLink[];
  toolsUsed: CopilotToolUse[];
  /** True when this answer is over the soft message limit. The answer still returns. */
  overSoftLimit: boolean;
};

export type CopilotRequestParse =
  | { ok: true; messages: CopilotTurn[] }
  | { ok: false; error: 'invalid_body' }
  | { ok: false; error: 'limit_exceeded'; limit: 'turns' | 'chars'; max: number };

/**
 * Validates the request body: `{ messages: [{ role, content }] }`, at most 20 turns of at most
 * 4,000 characters, the last one from the user. Used by the route before anything else runs.
 */
export function parseCopilotRequest(body: unknown): CopilotRequestParse {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'invalid_body' };
  if (raw.length > COPILOT_MAX_TURNS) {
    return { ok: false, error: 'limit_exceeded', limit: 'turns', max: COPILOT_MAX_TURNS };
  }
  const messages: CopilotTurn[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: 'invalid_body' };
    }
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return { ok: false, error: 'invalid_body' };
    }
    if (content.length > COPILOT_MAX_TURN_CHARS) {
      return { ok: false, error: 'limit_exceeded', limit: 'chars', max: COPILOT_MAX_TURN_CHARS };
    }
    if (content.trim() === '') return { ok: false, error: 'invalid_body' };
    messages.push({ role, content });
  }
  if (messages[messages.length - 1]!.role !== 'user') return { ok: false, error: 'invalid_body' };
  return { ok: true, messages };
}

// ---------------------------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------------------------

/**
 * The only POST routes a tool may call. Each is a read: no `commandId`, nothing written. This one
 * takes its search text in the JSON body so a guest name never lands in a URL.
 */
export const COPILOT_POST_READ_ROUTE_IDS: readonly string[] = ['post_reservation_search'];

export type CopilotParamDef = {
  name: string;
  kind: 'date' | 'id' | 'enum' | 'text';
  /**
   * `path` fills a `{name}` placeholder in the template; `query` goes on the query string; `body`
   * goes in the JSON body (POST read routes only).
   */
  where: 'path' | 'query' | 'body';
  required: boolean;
  description: string;
  /** `enum` only. */
  values?: readonly string[];
  /** `text` only. */
  maxLength?: number;
  /** `date` only: when the model leaves it out, the property's open business date is used. */
  defaultsToBusinessDate?: boolean;
};

export type CopilotToolArgs = Record<string, string>;

export type CopilotToolDef = {
  toolId: string;
  /** One line for the model. */
  description: string;
  /**
   * The existing route this tool calls: a GET route, or a POST read route on the allow-list
   * (`COPILOT_POST_READ_ROUTE_IDS`). Never a command: a contracts test asserts both.
   */
  routeId: string;
  /** Defaults to GET. */
  method?: 'GET' | 'POST';
  /** Path with `{propertyId}` and `{param}` placeholders, under `/v1`. */
  pathTemplate: string;
  params: readonly CopilotParamDef[];
  /** The SPA screen that shows the same data. */
  source: (args: CopilotToolArgs) => CopilotLink;
  /** Where the clerk may go next. Links to existing screens only. */
  actions: (args: CopilotToolArgs) => CopilotLink[];
};

/** An id-shaped value (reservation id, report id): bounded, no whitespace, slash or markup. */
const COPILOT_ID = /^[A-Za-z0-9_.:@|-]{1,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const DATE_PARAM = (description: string, defaults: boolean): CopilotParamDef => ({
  name: 'date',
  kind: 'date',
  where: 'query',
  required: false,
  description,
  defaultsToBusinessDate: defaults,
});

const RESERVATION_PARAM: CopilotParamDef = {
  name: 'reservationId',
  kind: 'id',
  where: 'path',
  required: true,
  description: 'The reservation id, as returned by another tool or given by the user.',
};

function reportIdsFor(routeId: ReportRouteId): string[] {
  return REPORT_DEFINITIONS.filter((d) => d.routeId === routeId).map((d) => d.id);
}

function reportTool(
  toolId: string,
  routeId: ReportRouteId,
  description: string,
  extraAction?: (reportId: string) => CopilotLink[],
): CopilotToolDef {
  const ids = reportIdsFor(routeId);
  return {
    toolId,
    description: `${description} Report ids: ${ids.join(', ')}.`,
    routeId,
    pathTemplate: `/v1/properties/{propertyId}/reports/${REPORT_ROUTE_SEGMENT[routeId]}/{reportId}`,
    params: [
      {
        name: 'reportId',
        kind: 'enum',
        where: 'path',
        required: true,
        description: 'Which report to run.',
        values: ids,
      },
      {
        name: 'date',
        kind: 'date',
        where: 'query',
        required: false,
        description: 'The date, for a report run for one date. Leave out for the open business date.',
      },
      {
        name: 'from',
        kind: 'date',
        where: 'query',
        required: false,
        description: 'First date of a range. Give together with `to`.',
      },
      {
        name: 'to',
        kind: 'date',
        where: 'query',
        required: false,
        description: 'Last date of a range. Give together with `from`.',
      },
      {
        name: 'reservationId',
        kind: 'id',
        where: 'query',
        required: false,
        description: 'The stay, for a report run for one stay.',
      },
    ],
    source: (args) => {
      const def = REPORT_DEFINITIONS.find((d) => d.id === args.reportId);
      const title = def?.title ?? 'Report';
      return {
        label: /report$/i.test(title) ? title : `${title} report`,
        href: `/reports/${encodeURIComponent(args.reportId ?? '')}`,
      };
    },
    actions: (args) => extraAction?.(args.reportId ?? '') ?? [],
  };
}

export const COPILOT_TOOLS: readonly CopilotToolDef[] = [
  {
    toolId: 'front_desk_summary',
    description:
      "Counts for the front desk on one date: arrivals, departures, in-house, rooms and availability.",
    routeId: 'get_front_desk_summary',
    pathTemplate: '/v1/properties/{propertyId}/front-desk/summary',
    params: [DATE_PARAM('The date. Leave out for the open business date.', true)],
    source: () => ({ label: 'Dashboard', href: '/dashboard' }),
    actions: () => [{ label: 'Open the front desk', href: '/arrivals' }],
  },
  {
    toolId: 'room_board',
    description: 'The live room board: every room with its housekeeping state and its guest, plus unassigned arrivals.',
    routeId: 'get_room_board',
    pathTemplate: '/v1/properties/{propertyId}/room-board',
    params: [],
    source: () => ({ label: 'Live rooms', href: '/rooms/live' }),
    actions: () => [{ label: 'Open Live rooms', href: '/rooms/live' }],
  },
  {
    toolId: 'reservation_search',
    description: 'Find reservations by guest name, room code or reservation id. Returns each match with its reservation id.',
    routeId: 'post_reservation_search',
    method: 'POST',
    pathTemplate: '/v1/properties/{propertyId}/reservations-search',
    params: [
      {
        name: 'q',
        kind: 'text',
        where: 'body',
        required: true,
        description: 'What to look for (1 to 128 characters).',
        maxLength: 128,
      },
    ],
    source: () => ({ label: 'Reservations', href: '/reservations' }),
    actions: () => [{ label: 'Open Reservations', href: '/reservations' }],
  },
  {
    toolId: 'reservation_detail',
    description: 'One reservation: dates, room, status, party size and rate.',
    routeId: 'get_reservation',
    pathTemplate: '/v1/properties/{propertyId}/reservations/{reservationId}',
    params: [RESERVATION_PARAM],
    source: (args) => ({ label: 'Reservation', href: `/reservations/${encodeURIComponent(args.reservationId ?? '')}` }),
    actions: (args) => [
      { label: 'Open the stay', href: `/reservations/${encodeURIComponent(args.reservationId ?? '')}` },
    ],
  },
  {
    toolId: 'reservation_folio',
    description: "One reservation's folio: lines, payments and the balance.",
    routeId: 'get_folio',
    pathTemplate: '/v1/properties/{propertyId}/reservations/{reservationId}/folio',
    params: [RESERVATION_PARAM],
    source: (args) => ({ label: 'Folio', href: `/folio/${encodeURIComponent(args.reservationId ?? '')}` }),
    actions: (args) => [
      { label: 'Open the folio', href: `/folio/${encodeURIComponent(args.reservationId ?? '')}` },
    ],
  },
  {
    toolId: 'open_folios',
    description: 'Folios that are still open after checkout, with their balances and follow-up dates.',
    routeId: 'get_open_folios',
    pathTemplate: '/v1/properties/{propertyId}/open-folios',
    params: [],
    source: () => ({ label: 'Open folios', href: '/folios' }),
    actions: () => [{ label: 'Review open folios', href: '/folios' }],
  },
  {
    toolId: 'housekeeping_dashboard',
    description: 'The housekeeping supervisor dashboard: room states, tasks, requests, lost items and cases.',
    routeId: 'get_housekeeping_dashboard',
    pathTemplate: '/v1/properties/{propertyId}/housekeeping/dashboard',
    params: [],
    source: () => ({ label: 'Housekeeping', href: '/housekeeping' }),
    actions: () => [{ label: 'Open housekeeping', href: '/housekeeping' }],
  },
  {
    toolId: 'housekeeping_tasks',
    description: 'Housekeeping tasks for one date, optionally for one status.',
    routeId: 'get_housekeeping_tasks',
    pathTemplate: '/v1/properties/{propertyId}/housekeeping/tasks',
    params: [
      DATE_PARAM('The date. Leave out for the open business date.', true),
      {
        name: 'status',
        kind: 'enum',
        where: 'query',
        required: false,
        description: 'Only tasks in this status.',
        values: HOUSEKEEPING_TASK_STATUSES,
      },
    ],
    source: () => ({ label: 'Housekeeping', href: '/housekeeping' }),
    actions: () => [{ label: 'Open housekeeping', href: '/housekeeping' }],
  },
  reportTool(
    'front_office_report',
    'get_front_office_report',
    'Front office reports: arrivals, departures, in-house, no-shows and similar lists.',
    (id) => {
      if (id === 'front_office_arrivals') return [{ label: 'Open arrivals', href: '/arrivals' }];
      if (id === 'front_office_departures') return [{ label: 'Open departures', href: '/departures' }];
      if (id === 'front_office_in_house') return [{ label: 'Open in-house guests', href: '/in-house' }];
      return [];
    },
  ),
  reportTool('cashier_report', 'get_cashier_report', 'Cashier and financial reports: payments, shifts, folios and receivables.'),
  reportTool('night_audit_report', 'get_audit_report', 'Night audit reports: closed-day figures and the audit trail.'),
  reportTool('housekeeping_report', 'get_housekeeping_report', 'Housekeeping reports: status history, blocks, requests, linen and inspections.'),
  {
    toolId: 'manager_report',
    description: 'The Manager Report for one closed date: day, month to date and year to date figures.',
    routeId: 'get_manager_report',
    pathTemplate: '/v1/properties/{propertyId}/reports/manager',
    params: [DATE_PARAM('A closed business date. Leave out for the latest closed date.', false)],
    source: () => ({ label: 'Manager Report', href: '/reports/manager' }),
    actions: () => [{ label: 'Open Reports', href: '/reports' }],
  },
  {
    toolId: 'night_audit_status',
    description: 'Night audit status: the open business date, the last audit run and any step that needs attention.',
    routeId: 'get_night_audit',
    pathTemplate: '/v1/properties/{propertyId}/night-audit',
    params: [],
    source: () => ({ label: 'Night audit', href: '/night-audit' }),
    actions: () => [{ label: 'Open night audit', href: '/night-audit' }],
  },
];

export function copilotTool(toolId: string): CopilotToolDef | undefined {
  return COPILOT_TOOLS.find((t) => t.toolId === toolId);
}

export type CopilotToolArgsParse =
  | { ok: true; args: CopilotToolArgs }
  | { ok: false; error: 'invalid_args'; detail: string };

/**
 * Validates what the model passed. Unknown names are rejected, so a model cannot add a property
 * id or any other path segment. A date the model left out is filled from `businessDate` when the
 * parameter says so; with no business date to fill it, a required date is `date_required`.
 */
export function parseCopilotToolArgs(
  tool: CopilotToolDef,
  raw: unknown,
  context: { businessDate?: string | null } = {},
): CopilotToolArgsParse {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return { ok: false, error: 'invalid_args', detail: 'args_not_object' };
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  const known = new Set(tool.params.map((p) => p.name));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) return { ok: false, error: 'invalid_args', detail: `unknown_${key}` };
  }
  const args: CopilotToolArgs = {};
  for (const param of tool.params) {
    const value = input[param.name];
    if (value === undefined || value === null || value === '') {
      if (param.kind === 'date' && param.defaultsToBusinessDate && context.businessDate) {
        args[param.name] = context.businessDate;
        continue;
      }
      if (param.required || (param.kind === 'date' && param.defaultsToBusinessDate)) {
        return { ok: false, error: 'invalid_args', detail: `${param.name}_required` };
      }
      continue;
    }
    if (typeof value !== 'string') return { ok: false, error: 'invalid_args', detail: `invalid_${param.name}` };
    const text = param.kind === 'text' ? value.trim() : value;
    switch (param.kind) {
      case 'date':
        if (!isRealIsoDate(text)) return { ok: false, error: 'invalid_args', detail: `invalid_${param.name}` };
        break;
      case 'id':
        if (!COPILOT_ID.test(text)) return { ok: false, error: 'invalid_args', detail: `invalid_${param.name}` };
        break;
      case 'enum':
        if (!(param.values ?? []).includes(text)) {
          return { ok: false, error: 'invalid_args', detail: `invalid_${param.name}` };
        }
        break;
      case 'text':
        if (text.length < 1 || text.length > (param.maxLength ?? 128)) {
          return { ok: false, error: 'invalid_args', detail: `invalid_${param.name}` };
        }
        break;
    }
    args[param.name] = text;
  }
  return { ok: true, args };
}

/** The request path (with query) a validated call makes. Values are percent-encoded. */
export function copilotToolRequestPath(
  tool: CopilotToolDef,
  propertyId: string,
  args: CopilotToolArgs,
): string {
  let path = tool.pathTemplate.replace('{propertyId}', encodeURIComponent(propertyId));
  for (const param of tool.params) {
    if (param.where === 'path') {
      path = path.replace(`{${param.name}}`, encodeURIComponent(args[param.name] ?? ''));
    }
  }
  const query = new URLSearchParams();
  for (const param of tool.params) {
    if (param.where !== 'query') continue;
    const value = args[param.name];
    if (value !== undefined) query.set(param.name, value);
  }
  const q = query.toString();
  return q ? `${path}?${q}` : path;
}

/** The JSON body of a POST read tool, or null for a GET tool. */
export function copilotToolRequestBody(
  tool: CopilotToolDef,
  args: CopilotToolArgs,
): Record<string, string> | null {
  if ((tool.method ?? 'GET') !== 'POST') return null;
  const body: Record<string, string> = {};
  for (const param of tool.params) {
    if (param.where === 'body' && args[param.name] !== undefined) body[param.name] = args[param.name]!;
  }
  return body;
}

/** JSON Schema of a tool's arguments, for providers that take a function schema. */
export function copilotToolJsonSchema(tool: CopilotToolDef): {
  type: 'object';
  properties: Record<string, { type: 'string'; description: string; enum?: string[]; maxLength?: number }>;
  required: string[];
  additionalProperties: false;
} {
  const properties: Record<string, { type: 'string'; description: string; enum?: string[]; maxLength?: number }> = {};
  const required: string[] = [];
  for (const p of tool.params) {
    const entry: { type: 'string'; description: string; enum?: string[]; maxLength?: number } = {
      type: 'string',
      description:
        p.kind === 'date' ? `${p.description} Format YYYY-MM-DD.` : p.description,
    };
    if (p.kind === 'enum') entry.enum = [...(p.values ?? [])];
    if (p.kind === 'text') entry.maxLength = p.maxLength ?? 128;
    properties[p.name] = entry;
    // A date that defaults to the business date is never required of the model.
    if (p.required) required.push(p.name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/**
 * Distinct guest references in a tool result. Report rows hold them in the columns typed `guest`;
 * every other route names the field `guestRef`. The audit row stores only the count.
 */
export function collectGuestRefs(result: unknown): Set<string> {
  const refs = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 12 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
      const guestKeys = (obj.columns as Array<{ key?: unknown; type?: unknown }>)
        .filter((c) => c && c.type === 'guest' && typeof c.key === 'string')
        .map((c) => c.key as string);
      for (const row of obj.rows as Array<Record<string, unknown>>) {
        for (const key of guestKeys) {
          const v = row?.[key];
          if (typeof v === 'string' && v !== '') refs.add(v);
        }
      }
    }
    for (const [key, v] of Object.entries(obj)) {
      if ((key === 'guestRef' || key === 'guest_ref') && typeof v === 'string' && v !== '') refs.add(v);
      else walk(v, depth + 1);
    }
  };
  walk(result, 0);
  return refs;
}

/** True for a path the SPA can navigate to: same origin, rooted, no scheme. */
export function isCopilotSpaHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//') && !/[\\\s]/.test(href) && !href.includes('://');
}
