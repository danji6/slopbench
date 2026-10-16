import type { Token } from 'acorn'

import {
  type JavaScriptSyntax,
  type SyntaxNode,
  visitSyntax,
} from './javascript-syntax'
import type { CompletionRange } from './types'

export type CallContext = {
  name: string
  from: number
  argument: number
  range: CompletionRange
}

/** Finds the innermost call and counts only commas belonging to that call. */
export function callContext(
  syntax: JavaScriptSyntax,
  offset: number,
): CallContext | undefined {
  let call: CallContext | undefined
  visitSyntax(syntax.root, (node) => {
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return
    const open = syntax.tokens.find(
      (token) =>
        token.start >= node.callee.end &&
        token.start < node.end &&
        token.type.label === '(',
    )
    if (!open || open.end > offset) return
    const context = scanCall(syntax.tokens, open, offset)
    if (!context || (call && call.from >= open.start)) return
    call = {
      ...context,
      name: node.callee.type === 'Identifier' ? node.callee.name : '',
    }
  })
  return call
}

function scanCall(
  tokens: Token[],
  open: Token,
  offset: number,
): Omit<CallContext, 'name'> | undefined {
  let depth = 0
  let argument = 0
  let from = open.end
  let to = Infinity
  for (const token of tokens) {
    if (token.start < open.end || token.end === token.start) continue
    const label = token.type.label
    if (depth === 0 && (label === ',' || label === ')')) {
      if (token.start < offset) {
        if (label === ')') return
        argument++
        from = token.end
      } else {
        to = token.start
        break
      }
    }
    if (['(', '[', '{', '${'].includes(label)) depth++
    else if ([')', ']', '}'].includes(label)) depth--
  }
  return { from: open.start, argument, range: { from, to } }
}

/** Excludes non-code text, declaration names, and non-computed property names. */
export function suppressIdentifiers(
  syntax: JavaScriptSyntax,
  declarations: Set<SyntaxNode>,
  offset: number,
): boolean {
  if (
    syntax.comments.some(
      (comment) => comment.start < offset && offset <= comment.end,
    )
  )
    return true
  let suppressed = false
  visitSyntax(syntax.root, (node) => {
    if (!atNode(node, offset)) return
    if (declarations.has(node)) suppressed = true
    if (node.type === 'Literal') suppressed = true
    if (node.type === 'TemplateElement') suppressed = true
    if (
      node.type === 'MemberExpression' &&
      !node.computed &&
      atNode(node.property, offset)
    ) {
      suppressed = true
    }
    if (
      node.type === 'Property' &&
      !node.computed &&
      !node.shorthand &&
      atNode(node.key, offset)
    ) {
      suppressed = true
    }
    if (
      (node.type === 'MethodDefinition' ||
        node.type === 'PropertyDefinition') &&
      !node.computed &&
      atNode(node.key, offset)
    ) {
      suppressed = true
    }
  })
  return suppressed
}

function atNode(node: SyntaxNode, offset: number): boolean {
  return node.start < offset && offset <= node.end
}
