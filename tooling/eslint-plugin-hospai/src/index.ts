/**
 * Merge-blocking ESLint rules for HospAI (ARCHITECTURE §11).
 * Keep this plugin dependency-light — no typescript-eslint utils.
 */

import { noDomInClientCore } from './no-dom-in-client-core.js';
import { noFetchInComponents } from './no-fetch-in-components.js';
import { noInlineStylesInWebPms } from './no-inline-styles-in-web-pms.js';
import { noNonCloneableBoundaryTypes } from './no-non-cloneable-boundary-types.js';

export { CLASS_DENYLIST, CLASS_DENYLIST_SET } from './class-denylist.js';

type RuleContext = {
  filename: string;
  report: (r: { node: unknown; messageId: string; data?: Record<string, string> }) => void;
  getSourceCode: () => { text: string; getText: (node?: unknown) => string };
};

type CallNode = {
  type?: string;
  callee: {
    type: string;
    property?: { type?: string; name?: string };
    name?: string;
    object?: {
      type: string;
      property?: { name?: string };
      name?: string;
      object?: { property?: { name?: string }; name?: string };
    };
  };
  arguments: Array<{
    type: string;
    value?: string;
    quasis?: Array<{ value: { cooked?: string | null; raw?: string } }>;
    expressions?: unknown[];
  }>;
};

type ImportNode = { source: { value: string } };

/**
 * DOMAIN key prefixes — must cover every key from domainConfigKeys() in @hospai/contracts.
 * Contracts tests assert every DOMAIN key matches one of these prefixes.
 */
export const DOMAIN_KEY_PREFIXES = [
  'pms.availability',
  'pms.time',
  'pms.night_audit',
  'pms.booking',
  'pms.money',
  'pms.folio',
  'pms.reservations',
  'pms.housekeeping',
] as const;

function stringLooksLikeDomainKey(value: string): boolean {
  return DOMAIN_KEY_PREFIXES.some((p) => value === p || value.startsWith(`${p}.`));
}

function templateLooksLikeDomainKey(hint: string): boolean {
  return DOMAIN_KEY_PREFIXES.some((p) => hint.includes(p));
}

function isKvGet(callee: CallNode['callee']): boolean {
  if (callee.type === 'Identifier' && callee.name === 'getDomainConfigFromKv') return true;
  if (callee.type !== 'MemberExpression') return false;
  if (callee.property?.name !== 'get') return false;
  // env.KV.get / KV.get
  const obj = callee.object;
  if (!obj) return false;
  if (obj.type === 'Identifier' && obj.name === 'KV') return true;
  if (obj.type === 'MemberExpression' && obj.property?.name === 'KV') return true;
  return false;
}

const ALLOWED_ID_FROM_NAME_PATH = 'packages/tenant-router';

const noIdFromName = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'idFromName / getByName may only be called from packages/tenant-router' },
    schema: [],
    messages: {
      forbidden: '{{method}} is only allowed in packages/tenant-router (ARCHITECTURE §2 / §3 / §4.5).',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    if (file.includes(ALLOWED_ID_FROM_NAME_PATH)) return {};
    return {
      CallExpression(node: CallNode) {
        const callee = node.callee;
        const method =
          callee.type === 'MemberExpression'
            ? callee.property?.name
            : callee.type === 'Identifier'
              ? callee.name
              : undefined;
        if (method === 'idFromName' || method === 'getByName') {
          context.report({ node, messageId: 'forbidden', data: { method } });
        }
      },
    };
  },
};

const noDomainFromKv = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'DOMAIN config must not be read from KV' },
    schema: [],
    messages: {
      forbidden: 'Do not read DOMAIN config from KV (ARCHITECTURE §5.1). Key hint: {{hint}}',
    },
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: CallNode) {
        if (!isKvGet(node.callee)) return;
        for (const arg of node.arguments) {
          if (arg.type === 'Literal' && typeof arg.value === 'string' && stringLooksLikeDomainKey(arg.value)) {
            context.report({ node, messageId: 'forbidden', data: { hint: arg.value } });
            return;
          }
          if (arg.type === 'TemplateLiteral' && arg.quasis) {
            const hint = arg.quasis.map((q) => q.value.cooked ?? '').join('${…}');
            if (templateLooksLikeDomainKey(hint)) {
              context.report({ node, messageId: 'forbidden', data: { hint } });
              return;
            }
          }
        }
      },
    };
  },
};

const noEntitlementInDomain = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'domain/ folders must not import entitlement-client' },
    schema: [],
    messages: {
      forbidden: 'Entitlement client is forbidden in domain/ (ARCHITECTURE Rule 3).',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    if (!file.includes('/domain/')) return {};
    return {
      ImportDeclaration(node: ImportNode) {
        if (
          node.source.value.includes('entitlement-client') ||
          node.source.value.includes('@hospai/entitlement-client')
        ) {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};

const noPlatformImportInDomain = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'domain/ must not import cloudflare:workers or platform packages' },
    schema: [],
    messages: {
      forbidden: 'domain/ must not import "{{source}}" (ARCHITECTURE Rule 11).',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    if (!file.includes('/domain/')) return {};
    return {
      ImportDeclaration(node: ImportNode) {
        const source = node.source.value;
        if (
          source === 'cloudflare:workers' ||
          source.startsWith('cloudflare:') ||
          source === '@hospai/do-runtime' ||
          source === '@hospai/tenant-router'
        ) {
          context.report({ node, messageId: 'forbidden', data: { source } });
        }
      },
    };
  },
};

const noPmsImportingAddons = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'pms/* must not import addons/*' },
    schema: [],
    messages: {
      forbidden: 'pms/* must not import addons/* (ARCHITECTURE §11).',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    const inPms =
      file.includes('/packages/pms/') || file.includes('/apps/pms-') || /\/pms\//.test(file);
    if (!inPms) return {};
    return {
      ImportDeclaration(node: ImportNode) {
        const source = node.source.value;
        if (source.includes('/addons/') || source.startsWith('@hospai/addon')) {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};

function isBookabilityPath(file: string): boolean {
  return /\/(booking|booking-engine|ari|channels?|channel-manager)(\/|$)/i.test(file);
}

function isReservationsModulePath(file: string): boolean {
  return (
    /\/(modules|packages)\/[^/]*reservations(\/|$)/i.test(file) ||
    /\/reservations\/(domain|application|infrastructure)\//i.test(file)
  );
}

function isAvailabilityModulePath(file: string): boolean {
  return (
    /\/(modules|packages)\/[^/]*availability(\/|$)/i.test(file) ||
    /\/availability\/(domain|application|infrastructure)\//i.test(file)
  );
}

function isReservationModuleImport(source: string): boolean {
  if (source.startsWith('@hospai/reservations') || source.startsWith('@hospai/pms-reservations')) {
    return true;
  }
  if (/\/reservations(\/|$)/.test(source) && !/\/reservations\/types(\/|$)/.test(source)) {
    return true;
  }
  if (/(^|\/)reservations(\/|$)/.test(source) && !source.includes('/availability/')) {
    return (
      /reservations\/(queries|repo|repository|store|list|scan)/.test(source) ||
      /\/reservations$/.test(source)
    );
  }
  return false;
}

/**
 * §7.1 enforcement is structural, not an AST pattern match.
 * Bookability / ARI / channel code must not import reservation list/query modules —
 * capacity comes only from the availability module. Property-based ledger tests catch
 * behavioural regressions regardless of how a scan would be written.
 */
const noReservationsImportInBookability = {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'Bookability paths must not import reservation modules; use the availability ledger (§7.1)',
    },
    schema: [],
    messages: {
      forbidden:
        'Bookability/ARI/channel code must not import "{{source}}". Read capacity from the availability module only (ARCHITECTURE §7.1). Reservation-scan patterns cannot be reliably linted; this boundary is the enforcement.',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    if (!isBookabilityPath(file)) return {};
    if (isReservationsModulePath(file) || isAvailabilityModulePath(file)) return {};
    return {
      ImportDeclaration(node: ImportNode & { importKind?: string }) {
        if (node.importKind === 'type') return;
        const source = node.source.value;
        if (isReservationModuleImport(source)) {
          context.report({ node, messageId: 'forbidden', data: { source } });
        }
      },
    };
  },
};

export const rules = {
  'no-id-from-name-outside-tenant-router': noIdFromName,
  'no-domain-config-from-kv': noDomainFromKv,
  'no-entitlement-in-domain': noEntitlementInDomain,
  'no-reservations-import-in-bookability': noReservationsImportInBookability,
  'no-platform-import-in-domain': noPlatformImportInDomain,
  'no-pms-importing-addons': noPmsImportingAddons,
  'no-non-cloneable-boundary-types': noNonCloneableBoundaryTypes,
  'no-dom-in-client-core': noDomInClientCore,
  'no-fetch-in-components': noFetchInComponents,
  'no-inline-styles-in-web-pms': noInlineStylesInWebPms,
};

const plugin = {
  meta: { name: 'eslint-plugin-hospai', version: '0.0.1' },
  rules,
  configs: {
    recommended: {
      plugins: ['hospai'],
      rules: {
        'hospai/no-id-from-name-outside-tenant-router': 'error',
        'hospai/no-domain-config-from-kv': 'error',
        'hospai/no-entitlement-in-domain': 'error',
        'hospai/no-reservations-import-in-bookability': 'error',
        'hospai/no-platform-import-in-domain': 'error',
        'hospai/no-pms-importing-addons': 'error',
        'hospai/no-non-cloneable-boundary-types': 'error',
        'hospai/no-dom-in-client-core': 'error',
        'hospai/no-fetch-in-components': 'error',
        'hospai/no-inline-styles-in-web-pms': 'error',
      },
    },
  },
};

export default plugin;
