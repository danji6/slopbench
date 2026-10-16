import type { Pattern } from 'acorn'

import { type SyntaxNode, childNodes } from './javascript-syntax'
import type { Completion } from './types'

type Scope = {
  from: number
  to: number
  functionScope: boolean
  parent?: Scope
  bindings: Map<string, Completion>
}

export type JavaScriptScopes = {
  scopes: Scope[]
  declarations: Set<SyntaxNode>
}

type ScopeContext = JavaScriptScopes & { text: string }

/** Builds lexical scopes and records declaration names to suppress suggestions. */
export function analyzeScopes(
  root: SyntaxNode,
  text: string,
): JavaScriptScopes {
  const rootScope: Scope = {
    from: 0,
    to: text.length + 1,
    functionScope: true,
    bindings: new Map(),
  }
  const context: ScopeContext = {
    text,
    scopes: [rootScope],
    declarations: new Set(),
  }
  walk(root, rootScope, context)
  return context
}

/** Returns visible names, with inner declarations shadowing outer bindings. */
export function visibleBindings(analysis: JavaScriptScopes, offset: number) {
  const bindings = new Map<string, Completion>()
  const containing = analysis.scopes.filter(
    (scope) => scope.from <= offset && offset < scope.to,
  )
  for (const scope of containing) {
    for (const [name, entry] of scope.bindings) bindings.set(name, entry)
  }
  return bindings
}

function enterScope(
  node: SyntaxNode,
  parent: Scope,
  context: ScopeContext,
  functionScope = false,
): Scope {
  const scope: Scope = {
    from: node.start,
    to: scopeEnd(node, parent, context.text),
    functionScope,
    parent,
    bindings: new Map(),
  }
  context.scopes.push(scope)
  return scope
}

function scopeEnd(node: SyntaxNode, parent: Scope, text: string): number {
  if (
    node.type === 'ArrowFunctionExpression' &&
    node.body.type !== 'BlockStatement'
  ) {
    return node.end + 1
  }
  if ('body' in node && node.body && !Array.isArray(node.body)) {
    return scopeEnd(node.body, parent, text)
  }

  const unfinishedBlock =
    text[node.end - 1] !== '}' && !text.slice(node.end).trim()
  const block = [
    'BlockStatement',
    'StaticBlock',
    'SwitchStatement',
    'ClassBody',
  ].includes(node.type)

  return block && unfinishedBlock ? parent.to : node.end
}

function bindPattern(
  node: Pattern | null | undefined,
  scope: Scope,
  context: ScopeContext,
  kind: Completion['kind'] = 'variable',
): void {
  if (!node) return
  switch (node.type) {
    case 'Identifier':
      if (node.name === '✖') return
      context.declarations.add(node)
      scope.bindings.set(node.name, { label: node.name, kind, detail: kind })
      break
    case 'AssignmentPattern':
      bindPattern(node.left, scope, context, kind)
      break
    case 'RestElement':
      bindPattern(node.argument, scope, context, kind)
      break
    case 'ArrayPattern':
      for (const item of node.elements) bindPattern(item, scope, context, kind)
      break
    case 'ObjectPattern':
      for (const property of node.properties) {
        const value =
          property.type === 'RestElement' ? property.argument : property.value
        bindPattern(value, scope, context, kind)
      }
  }
}

function varScope(scope: Scope): Scope {
  while (!scope.functionScope && scope.parent) scope = scope.parent
  return scope
}

type FunctionNode = Extract<
  SyntaxNode,
  {
    type:
      'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression'
  }
>

function walkFunction(
  node: FunctionNode,
  parent: Scope,
  context: ScopeContext,
): void {
  if (node.type === 'FunctionDeclaration') {
    bindPattern(node.id, parent, context, 'function')
  }
  const scope = enterScope(node, parent, context, true)
  if (node.type === 'FunctionExpression') {
    bindPattern(node.id, scope, context, 'function')
  }
  for (const param of node.params) {
    bindPattern(param, scope, context, 'parameter')
  }
  for (const param of node.params) walk(param, scope, context)
  walk(node.body, scope, context)
}

function walk(node: SyntaxNode, parent: Scope, context: ScopeContext): void {
  if (isFunction(node)) return walkFunction(node, parent, context)
  let scope = parent
  if (createsBlockScope(node)) {
    scope = enterScope(node, parent, context, node.type === 'StaticBlock')
  }
  if (node.type === 'VariableDeclaration') {
    const target = node.kind === 'var' ? varScope(scope) : scope
    for (const decl of node.declarations) bindPattern(decl.id, target, context)
  }
  if (node.type === 'CatchClause') bindPattern(node.param, scope, context)
  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
    if (node.type === 'ClassDeclaration') {
      bindPattern(node.id, parent, context, 'class')
    }
    scope = enterScope(node, parent, context)
    bindPattern(node.id, scope, context, 'class')
  }
  for (const child of childNodes(node)) walk(child, scope, context)
}

function isFunction(node: SyntaxNode): node is FunctionNode {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  )
}

function createsBlockScope(node: SyntaxNode): boolean {
  return [
    'BlockStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'CatchClause',
    'SwitchStatement',
    'StaticBlock',
  ].includes(node.type)
}
