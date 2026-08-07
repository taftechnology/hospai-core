/**
 * Second net for bare DOM globals in @hospai/client-core.
 * Package deps catch React/Query/Clerk; this catches `window` / `document` / etc.
 */

type RuleContext = {
  filename: string;
  report: (r: { node: unknown; messageId: string; data?: Record<string, string> }) => void;
};

type IdentifierNode = { type?: string; name?: string };

const DOM_GLOBALS = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator']);

function isClientCorePath(file: string): boolean {
  return file.replace(/\\/g, '/').includes('/packages/client-core/');
}

export const noDomInClientCore = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'client-core must not reference DOM globals (ARCHITECTURE SPA boundary)',
    },
    schema: [],
    messages: {
      forbidden: 'DOM global "{{name}}" is forbidden in packages/client-core (use injected transport).',
    },
  },
  create(context: RuleContext) {
    const file = context.filename.replace(/\\/g, '/');
    if (!isClientCorePath(file)) return {};
    return {
      Identifier(node: IdentifierNode) {
        if (node.name && DOM_GLOBALS.has(node.name)) {
          context.report({ node, messageId: 'forbidden', data: { name: node.name } });
        }
      },
    };
  },
};
