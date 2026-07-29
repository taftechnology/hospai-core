import { CLASS_DENYLIST_SET } from './class-denylist.js';

type Surface = 'module export' | 'DO RPC signature';

type RuleContext = {
  filename: string;
  report: (r: { node: unknown; messageId: string; data?: Record<string, string> }) => void;
  getSourceCode: () => { ast: { body: unknown[] } };
};

type AstNode = {
  type: string;
  [key: string]: unknown;
};

const MODULE_HARD_FAILURES = new Set(['Function', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy']);
const DO_HARD_FAILURES = new Set(['WeakMap', 'WeakSet', 'Symbol', 'Proxy']);

export function boundarySurface(filename: string): Surface | null {
  const file = filename.replace(/\\/g, '/');
  if (/\/modules\/.+\/src\/index\.ts$/.test(file)) return 'module export';
  if (/\/apps\/pms-core\/src\/(property-do|org-do|org-entitlement-do)\.ts$/.test(file)) {
    return 'DO RPC signature';
  }
  return null;
}

function contractFor(surface: Surface): string {
  return surface === 'module export' ? 'structured clone' : 'Workers RPC';
}

function typeReferenceName(node: AstNode): string | null {
  if (node.type !== 'TSTypeReference') return null;
  const typeName = node.typeName as AstNode;
  if (typeName.type === 'Identifier') return typeName.name as string;
  if (typeName.type === 'TSQualifiedName') {
    let current: AstNode = typeName;
    while (current.type === 'TSQualifiedName') {
      current = current.right as AstNode;
    }
    if (current.type === 'Identifier') return current.name as string;
  }
  return null;
}

function collectClassNames(body: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const stmt of body) {
    const node = stmt as AstNode;
    if (node.type !== 'ClassDeclaration') continue;
    const id = node.id as AstNode | null | undefined;
    if (id?.type === 'Identifier' && typeof id.name === 'string') {
      names.add(id.name);
    }
  }
  return names;
}

function isHardFailure(name: string, surface: Surface): boolean {
  const set = surface === 'module export' ? MODULE_HARD_FAILURES : DO_HARD_FAILURES;
  return set.has(name);
}

function isClassType(name: string, sameFileClasses: Set<string>): boolean {
  return CLASS_DENYLIST_SET.has(name) || sameFileClasses.has(name);
}

function walkType(
  node: AstNode | null | undefined,
  surface: Surface,
  sameFileClasses: Set<string>,
  report: RuleContext['report'],
): void {
  if (!node) return;

  switch (node.type) {
    case 'TSTypeReference': {
      const name = typeReferenceName(node);
      if (name) {
        if (isHardFailure(name, surface)) {
          report({
            node,
            messageId: 'hardNonCloneable',
            data: { typeName: name, surface, contract: contractFor(surface) },
          });
        } else if (isClassType(name, sameFileClasses)) {
          report({
            node,
            messageId: 'classType',
            data: { typeName: name, surface },
          });
        }
      }
      const typeParams = node.typeParameters as { params?: AstNode[] } | null | undefined;
      if (typeParams?.params) {
        for (const param of typeParams.params) walkType(param, surface, sameFileClasses, report);
      }
      break;
    }
    case 'TSFunctionType':
    case 'TSConstructorType':
      if (surface === 'module export') {
        report({
          node,
          messageId: 'hardNonCloneable',
          data: { typeName: 'function', surface, contract: contractFor(surface) },
        });
      }
      walkFunctionType(node, surface, sameFileClasses, report);
      break;
    case 'TSUnionType':
    case 'TSIntersectionType':
      for (const t of (node.types as AstNode[]) ?? []) walkType(t, surface, sameFileClasses, report);
      break;
    case 'TSArrayType':
      walkType(node.elementType as AstNode, surface, sameFileClasses, report);
      break;
    case 'TSTupleType':
      for (const el of (node.elementTypes as AstNode[]) ?? []) walkType(el, surface, sameFileClasses, report);
      break;
    case 'TSTypeLiteral':
      for (const member of (node.members as AstNode[]) ?? []) {
        if (member.type === 'TSPropertySignature' || member.type === 'TSMethodSignature') {
          walkTypeAnnotation(member.typeAnnotation as AstNode, surface, sameFileClasses, report);
        }
      }
      break;
    case 'TSMappedType':
      walkType(node.typeAnnotation as AstNode, surface, sameFileClasses, report);
      break;
    case 'TSIndexedAccessType':
      walkType(node.objectType as AstNode, surface, sameFileClasses, report);
      walkType(node.indexType as AstNode, surface, sameFileClasses, report);
      break;
    case 'TSOptionalType':
    case 'TSRestType':
    case 'TSParenthesizedType':
      walkType(node.typeAnnotation as AstNode, surface, sameFileClasses, report);
      break;
    case 'TSTypeOperator':
      walkType(node.typeAnnotation as AstNode, surface, sameFileClasses, report);
      break;
    case 'TSTypeQuery': {
      const exprName = node.exprName as AstNode;
      if (exprName?.type === 'Identifier' && typeof exprName.name === 'string') {
        const name = exprName.name;
        if (isHardFailure(name, surface)) {
          report({
            node,
            messageId: 'hardNonCloneable',
            data: { typeName: name, surface, contract: contractFor(surface) },
          });
        }
      }
      break;
    }
    case 'TSSymbolKeyword':
      report({
        node,
        messageId: 'hardNonCloneable',
        data: { typeName: 'symbol', surface, contract: contractFor(surface) },
      });
      break;
    default:
      break;
  }
}

function walkFunctionType(
  node: AstNode,
  surface: Surface,
  sameFileClasses: Set<string>,
  report: RuleContext['report'],
): void {
  for (const param of (node.params as AstNode[]) ?? []) {
    walkTypeAnnotation(param.typeAnnotation as AstNode, surface, sameFileClasses, report);
  }
  walkTypeAnnotation(node.returnType as AstNode, surface, sameFileClasses, report);
}

function walkTypeAnnotation(
  typeAnnotation: AstNode | null | undefined,
  surface: Surface,
  sameFileClasses: Set<string>,
  report: RuleContext['report'],
): void {
  if (!typeAnnotation) return;
  if (typeAnnotation.type === 'TSTypeAnnotation') {
    walkType(typeAnnotation.typeAnnotation as AstNode, surface, sameFileClasses, report);
    return;
  }
  walkType(typeAnnotation, surface, sameFileClasses, report);
}

function isForTestMethod(key: AstNode): boolean {
  return key.type === 'Identifier' && typeof key.name === 'string' && key.name.endsWith('ForTest');
}

function isPrivateMethod(node: AstNode): boolean {
  if (node.accessibility === 'private') return true;
  const key = node.key as AstNode;
  return key?.type === 'PrivateIdentifier';
}

function methodSignatureParts(node: AstNode): { params: AstNode[]; returnType: AstNode | null | undefined } {
  const value = node.value as AstNode | undefined;
  if (value?.type === 'FunctionExpression' || value?.type === 'ArrowFunctionExpression') {
    return {
      params: (value.params as AstNode[]) ?? [],
      returnType: value.returnType as AstNode | null | undefined,
    };
  }
  return {
    params: (node.params as AstNode[]) ?? [],
    returnType: node.returnType as AstNode | null | undefined,
  };
}

function inspectMethodSignature(
  node: AstNode,
  surface: Surface,
  sameFileClasses: Set<string>,
  report: RuleContext['report'],
): void {
  if (isPrivateMethod(node) || isForTestMethod(node.key as AstNode)) return;

  const { params, returnType } = methodSignatureParts(node);
  for (const param of params) {
    walkTypeAnnotation(param.typeAnnotation as AstNode, surface, sameFileClasses, report);
  }
  walkTypeAnnotation(returnType as AstNode, surface, sameFileClasses, report);
}

function inspectExportedTypeDeclaration(
  node: AstNode,
  surface: Surface,
  sameFileClasses: Set<string>,
  report: RuleContext['report'],
): void {
  if (node.type === 'TSTypeAliasDeclaration') {
    walkType(node.typeAnnotation as AstNode, surface, sameFileClasses, report);
    return;
  }
  if (node.type === 'TSInterfaceDeclaration') {
    for (const member of ((node.body as AstNode)?.body as AstNode[]) ?? []) {
      if (member.type === 'TSPropertySignature' || member.type === 'TSMethodSignature') {
        walkTypeAnnotation(member.typeAnnotation as AstNode, surface, sameFileClasses, report);
      }
    }
  }
}

export const noNonCloneableBoundaryTypes = {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'Boundary types must be structured-cloneable (module exports) or Workers-RPC-safe (DO signatures)',
    },
    schema: [],
    messages: {
      hardNonCloneable: '{{typeName}} is not serializable on {{surface}} ({{contract}}).',
      classType:
        'Class type {{typeName}} loses its prototype when cloned; use a plain serializable shape on {{surface}} (ARCHITECTURE §3).',
    },
  },
  create(context: RuleContext) {
    const surface = boundarySurface(context.filename);
    if (!surface) return {};

    const sameFileClasses = collectClassNames(context.getSourceCode().ast.body);

    return {
      ExportNamedDeclaration(node: AstNode) {
        if (node.source) return;
        const declaration = node.declaration as AstNode | null | undefined;
        if (!declaration) return;
        if (declaration.type === 'TSTypeAliasDeclaration' || declaration.type === 'TSInterfaceDeclaration') {
          inspectExportedTypeDeclaration(declaration, surface, sameFileClasses, context.report);
        }
      },
      MethodDefinition(node: AstNode) {
        if (surface !== 'DO RPC signature') return;
        inspectMethodSignature(node, surface, sameFileClasses, context.report);
      },
    };
  },
};
