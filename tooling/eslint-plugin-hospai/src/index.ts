/**
 * Merge-blocking ESLint rules for HospAI (ARCHITECTURE §11).
 * Keep this plugin dependency-light — no typescript-eslint utils.
 */

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

type BinaryNode = {
  operator: string;
  left: {
    type: string;
    property?: { name?: string };
    object?: { name?: string; type?: string };
  };
  right: {
    type: string;
    property?: { name?: string };
    object?: {
      type: string;
      callee?: {
        type: string;
        property?: { name?: string };
        object?: { name?: string };
      };
    };
  };
};

type ImportNode = { source: { value: string } };

type FunctionNode = {
  id?: { name?: string; type?: string } | null;
  init?: { type?: string };
};

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

function looksLikeReservationScan(node: BinaryNode): boolean {
  // rooms.length - reservations.filter(...).length
  if (node.operator !== '-') return false;
  if (node.left.type !== 'MemberExpression') return false;
  if (node.left.property?.name !== 'length' && node.left.property?.name !== 'size') return false;
  if (node.right.type !== 'MemberExpression') return false;
  if (node.right.property?.name !== 'length' && node.right.property?.name !== 'size') return false;
  const call = node.right.object;
  if (!call || call.type !== 'CallExpression') return false;
  if (call.callee?.type !== 'MemberExpression') return false;
  if (call.callee.property?.name !== 'filter') return false;
  return true;
}

const AVAILABILITY_FN = /^(calculate|compute|derive|get)Availability$/i;

const noReservationScanAvailability = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'Availability must not be derived by scanning reservations' },
    schema: [],
    messages: {
      forbidden:
        'Do not derive availability as rooms.length - reservations.filter(...).length (ARCHITECTURE §7.1).',
      named: 'Function "{{name}}" must not implement reservation-scan availability (§7.1).',
      call: 'Do not call {{name}} — reservation-scan availability is forbidden (§7.1).',
    },
  },
  create(context: RuleContext) {
    return {
      BinaryExpression(node: BinaryNode) {
        if (looksLikeReservationScan(node)) {
          context.report({ node, messageId: 'forbidden' });
        }
      },
      FunctionDeclaration(node: FunctionNode) {
        const name = node.id?.name;
        if (name && AVAILABILITY_FN.test(name)) {
          context.report({ node: node.id, messageId: 'named', data: { name } });
        }
      },
      VariableDeclarator(node: FunctionNode & { id?: { name?: string } }) {
        const name = node.id?.name;
        if (!name || !AVAILABILITY_FN.test(name)) return;
        if (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression') {
          context.report({ node: node.id, messageId: 'named', data: { name } });
        }
      },
      CallExpression(node: CallNode) {
        const name =
          node.callee.type === 'Identifier'
            ? node.callee.name
            : node.callee.property?.name;
        if (name === 'getOccupancyForDate' || (name && AVAILABILITY_FN.test(name))) {
          context.report({ node, messageId: 'call', data: { name } });
        }
      },
    };
  },
};

export const rules = {
  'no-id-from-name-outside-tenant-router': noIdFromName,
  'no-domain-config-from-kv': noDomainFromKv,
  'no-entitlement-in-domain': noEntitlementInDomain,
  'no-reservation-scan-availability': noReservationScanAvailability,
  'no-platform-import-in-domain': noPlatformImportInDomain,
  'no-pms-importing-addons': noPmsImportingAddons,
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
        'hospai/no-reservation-scan-availability': 'error',
        'hospai/no-platform-import-in-domain': 'error',
        'hospai/no-pms-importing-addons': 'error',
      },
    },
  },
};

export default plugin;
