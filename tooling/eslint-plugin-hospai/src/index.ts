/**
 * Merge-blocking ESLint rules for HospAI (ARCHITECTURE §11).
 */

type RuleContext = {
  filename: string;
  report: (r: { node: unknown; messageId: string }) => void;
  getSourceCode: () => { text: string };
};

const ALLOWED_ID_FROM_NAME_PATH = 'packages/tenant-router';

const noIdFromName = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'idFromName may only be called from packages/tenant-router' },
    schema: [],
    messages: {
      forbidden: 'idFromName is only allowed in packages/tenant-router (ARCHITECTURE §4.5).',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    if (file.includes(ALLOWED_ID_FROM_NAME_PATH)) return {};
    return {
      CallExpression(node: {
        callee: { type: string; property?: { name?: string }; name?: string };
      }) {
        const callee = node.callee;
        if (
          (callee.type === 'MemberExpression' && callee.property?.name === 'idFromName') ||
          (callee.type === 'Identifier' && callee.name === 'idFromName')
        ) {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};

const noDomainFromKv = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'DOMAIN config must not be read from KV helpers' },
    schema: [],
    messages: {
      forbidden: 'Do not read DOMAIN config from KV (ARCHITECTURE §5.1).',
    },
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: {
        callee: { type: string; property?: { name?: string }; name?: string };
        arguments: Array<{ type: string; value?: string }>;
      }) {
        const callee = node.callee;
        const isKvGet =
          (callee.type === 'MemberExpression' && callee.property?.name === 'get') ||
          (callee.type === 'Identifier' && callee.name === 'getDomainConfigFromKv');
        if (!isKvGet) return;
        for (const arg of node.arguments) {
          if (
            arg.type === 'Literal' &&
            typeof arg.value === 'string' &&
            arg.value.startsWith('pms.') &&
            arg.value.includes('availability')
          ) {
            context.report({ node, messageId: 'forbidden' });
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
      ImportDeclaration(node: { source: { value: string } }) {
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

const noReservationScanAvailability = {
  meta: {
    type: 'problem' as const,
    docs: { description: 'Availability must not be derived by scanning reservations' },
    schema: [],
    messages: {
      forbidden: 'Do not derive availability by scanning reservations (ARCHITECTURE §7.1).',
    },
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: {
        callee: { type: string; property?: { name?: string }; name?: string };
      }) {
        const name =
          node.callee.type === 'Identifier'
            ? node.callee.name
            : node.callee.property?.name;
        if (name === 'calculateAvailability' || name === 'getOccupancyForDate') {
          context.report({ node, messageId: 'forbidden' });
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
};

const plugin = {
  meta: { name: 'eslint-plugin-hospai', version: '0.0.1' },
  rules,
};

export default plugin;
