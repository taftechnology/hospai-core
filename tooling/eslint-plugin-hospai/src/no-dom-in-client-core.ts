/**
 * Second net for bare DOM globals in @hospai/client-core.
 * Package deps catch React/Query/Clerk; this catches `window` / `document` / etc.
 *
 * Property keys and type-member names that happen to match a DOM global name
 * (e.g. folio wire field `window`) are not references and must not be flagged.
 */

type RuleContext = {
  filename: string;
  report: (r: { node: unknown; messageId: string; data?: Record<string, string> }) => void;
};

export type DomGlobalAstNode = {
  type?: string;
  name?: string;
  parent?: DomGlobalAstNode;
  key?: DomGlobalAstNode;
  property?: DomGlobalAstNode;
  computed?: boolean;
  object?: DomGlobalAstNode;
};

const DOM_GLOBALS = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator']);

function isClientCorePath(file: string): boolean {
  return file.replace(/\\/g, '/').includes('/packages/client-core/');
}

/** True when `node` is a name in a non-reference position (property/type key). */
function isNonReferenceName(node: DomGlobalAstNode): boolean {
  const parent = node.parent;
  if (!parent?.type) return false;

  // { window: ... } / { window }
  if (
    (parent.type === 'Property' || parent.type === 'PropertyDefinition') &&
    parent.key === node
  ) {
    return true;
  }
  // obj.window (property side only — window as object in window.x still flags)
  if (
    parent.type === 'MemberExpression' &&
    parent.property === node &&
    parent.computed !== true
  ) {
    return true;
  }
  // type / interface members: { window: ... }
  if (
    (parent.type === 'TSPropertySignature' ||
      parent.type === 'TSMethodSignature' ||
      parent.type === 'TSIndexSignature') &&
    parent.key === node
  ) {
    return true;
  }
  // enum member names, etc.
  if (parent.type === 'TSEnumMember' && parent.key === node) {
    return true;
  }
  return false;
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
      Identifier(node: DomGlobalAstNode) {
        if (!node.name || !DOM_GLOBALS.has(node.name)) return;
        if (isNonReferenceName(node)) return;
        context.report({ node, messageId: 'forbidden', data: { name: node.name } });
      },
    };
  },
};
