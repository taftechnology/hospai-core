/**
 * Screens must not call fetch — use @hospai/client-core + Query queryFns.
 */

type RuleContext = {
  filename: string;
  report: (r: { node: unknown; messageId: string }) => void;
};

type CallNode = {
  type?: string;
  callee: { type: string; name?: string };
};

function isWebPmsTsx(file: string): boolean {
  const f = file.replace(/\\/g, '/');
  return (f.includes('/apps/web-pms/') || f.includes('/apps/web-admin/')) && f.endsWith('.tsx');
}

export const noFetchInComponents = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'web-pms and web-admin .tsx files must not call fetch (use client-core / the api module)',
    },
    schema: [],
    messages: {
      forbidden: 'Do not call fetch in web-pms or web-admin UI files; use @hospai/client-core or the app api module.',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    if (!isWebPmsTsx(file)) return {};
    return {
      CallExpression(node: CallNode) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};
