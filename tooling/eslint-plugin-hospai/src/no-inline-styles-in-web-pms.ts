/**
 * web-pms TSX must not use layout/colour inline styles — classes + tokens only.
 * Escape hatch: style keys that are CSS custom properties (start with `--`).
 */

type RuleContext = {
  filename: string;
  report: (r: { node: unknown; messageId: string }) => void;
};

type PropNode = {
  type?: string;
  key?: {
    type?: string;
    name?: string;
    value?: unknown;
    expression?: { type?: string; value?: unknown };
  };
  computed?: boolean;
};

type StyleAttrNode = {
  type?: string;
  name?: { type?: string; name?: string };
  value?: {
    type?: string;
    expression?: { type?: string; properties?: PropNode[] };
  };
};

function isWebPmsTsx(file: string): boolean {
  const f = file.replace(/\\/g, '/');
  return f.includes('/apps/web-pms/') && f.endsWith('.tsx');
}

function cssVarKeyName(key: PropNode['key']): string | null {
  if (!key) return null;
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  if (key.type === 'JSXIdentifier' && typeof key.name === 'string') return key.name;
  // style={{ ['--x']: … }} — computed Literal
  if (key.type === 'Literal') return typeof key.value === 'string' ? key.value : null;
  return null;
}

function isCssCustomPropertyKey(prop: PropNode): boolean {
  const key = prop.key;
  if (!key) return false;

  // Computed: ['--gap'] or ['--x' as string]
  if (prop.computed) {
    if (key.type === 'Literal' && typeof key.value === 'string') {
      return key.value.startsWith('--');
    }
    if (key.type === 'TSAsExpression' || key.type === 'TSTypeAssertion') {
      const expr = (key as { expression?: { type?: string; value?: unknown } }).expression;
      if (expr?.type === 'Literal' && typeof expr.value === 'string') {
        return expr.value.startsWith('--');
      }
    }
    return false;
  }

  const name = cssVarKeyName(key);
  return name != null && name.startsWith('--');
}

export const noInlineStylesInWebPms = {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'web-pms .tsx files must not use inline styles except CSS custom properties',
    },
    schema: [],
    messages: {
      forbidden:
        'Do not use inline styles in web-pms UI (except CSS variables). Use classes and tokens.',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    if (!isWebPmsTsx(file)) return {};
    return {
      JSXAttribute(node: StyleAttrNode) {
        if (node.name?.name !== 'style') return;
        const expr = node.value?.expression;
        if (!expr || expr.type !== 'ObjectExpression') {
          // style={something} dynamic — still forbidden (forces classes)
          if (node.value?.type === 'JSXExpressionContainer') {
            context.report({ node, messageId: 'forbidden' });
          }
          return;
        }
        const props = expr.properties ?? [];
        for (const prop of props) {
          if (prop.type === 'SpreadElement') {
            context.report({ node, messageId: 'forbidden' });
            return;
          }
          if (!isCssCustomPropertyKey(prop)) {
            context.report({ node, messageId: 'forbidden' });
            return;
          }
        }
      },
    };
  },
};
