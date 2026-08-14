/**
 * web-pms and module UI must use @hospai/ui-kit controls, not raw intrinsics.
 */

type RuleContext = {
  filename: string;
  report: (r: { node: unknown; messageId: string; data?: Record<string, string> }) => void;
};

type JSXNode = {
  type?: string;
  name?: { type?: string; name?: string };
};

const FORBIDDEN = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'table',
  'th',
  'td',
  'tr',
  'thead',
  'tbody',
]);

function normalize(file: string): string {
  return file.replace(/\\/g, '/');
}

function inScope(file: string): boolean {
  const f = normalize(file);
  if (f.includes('/packages/ui-kit/')) return false;
  if (f.includes('/apps/web-pms/src/') && f.endsWith('.tsx') && !f.includes('.test.')) return true;
  if (f.includes('/modules/') && f.includes('/src/ui/') && f.endsWith('.tsx') && !f.includes('.test.')) {
    return true;
  }
  return false;
}

export const noRawControlsInWebPms = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'web-pms and module UI must use @hospai/ui-kit controls, not raw intrinsics',
    },
    schema: [],
    messages: {
      forbidden: 'Use <{{component}}> from @hospai/ui-kit, not a raw <{{tag}}>.',
    },
  },
  create(context: RuleContext) {
    const file = normalize(context.filename);
    if (!inScope(file)) return {};
    return {
      JSXOpeningElement(node: JSXNode) {
        if (node.name?.type !== 'JSXIdentifier') return;
        const tag = node.name.name;
        if (!tag || !FORBIDDEN.has(tag)) return;
        const component =
          tag === 'textarea'
            ? 'Textarea'
            : tag === 'select'
              ? 'NativeSelect'
              : tag === 'table'
                ? 'DataTable'
                : tag.charAt(0).toUpperCase() + tag.slice(1);
        context.report({
          node,
          messageId: 'forbidden',
          data: { component, tag },
        });
      },
    };
  },
};
