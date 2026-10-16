import {
  type AnyNode,
  type Comment,
  type Options,
  type Token,
  parse,
} from 'acorn'
import { parse as parseLoose } from 'acorn-loose'

export type SyntaxNode = AnyNode
export type JavaScriptSyntax = {
  root: SyntaxNode
  tokens: Token[]
  comments: Comment[]
}

/** Parses complete JavaScript first, recovering syntax while code is unfinished. */
export function parseJavaScript(text: string): JavaScriptSyntax {
  const tokens: Token[] = []
  const comments: Comment[] = []
  const options: Options = {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    onToken: tokens,
    onComment: comments,
  }

  try {
    return { root: parse(text, options), tokens, comments }
  } catch {
    tokens.length = 0
    comments.length = 0
    return { root: parseLoose(text, options), tokens, comments }
  }
}

/** Enumerates child nodes without treating metadata as syntax. */
export function childNodes(node: SyntaxNode): SyntaxNode[] {
  return Object.values(node).flatMap((value: unknown) => {
    if (Array.isArray(value)) return value.filter(isSyntaxNode)
    return isSyntaxNode(value) ? [value] : []
  })
}

function isSyntaxNode(value: unknown): value is SyntaxNode {
  if (!value || typeof value !== 'object') return false
  return 'type' in value && 'start' in value && 'end' in value
}

export function visitSyntax(
  node: SyntaxNode,
  visit: (node: SyntaxNode) => void,
): void {
  visit(node)
  for (const child of childNodes(node)) visitSyntax(child, visit)
}
