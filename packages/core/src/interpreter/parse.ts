import type { Condition, Segment } from './types'

// The order here matters
const TOKEN_PATTERN =
  /\$```(?<block>[\s\S]*?)```|```[\s\S]*?```|\{\{(?<inline>[^\n]*?)\}\}|`[^`\n]*`|^[ \t]*#if[ \t]+\$```(?<ifBlock>[\s\S]*?)```[ \t]*$|^[ \t]*#elif[ \t]+\$```(?<elifBlock>[\s\S]*?)```[ \t]*$|^[ \t]*#if[ \t]+(?<ifExpr>.*)$|^[ \t]*#elif[ \t]+(?<elifExpr>.*)$|^[ \t]*#else[ \t]*$|^[ \t]*#endif[ \t]*$/gm

const DIRECTIVE_PATTERN = /^[ \t]*#(?:if|elif|else|endif)\b/m

export function parse(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  TOKEN_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      appendLiteral(segments, text.slice(lastIndex, match.index))
    }

    const groups = match.groups ?? {}
    const exprCond = (expr: string): Condition => ({ kind: 'expr', expr })
    const blockCond = (code: string): Condition => ({ kind: 'block', code })

    if (groups.block !== undefined) {
      segments.push({ type: 'block', code: groups.block })
    } else if (groups.inline !== undefined) {
      segments.push({ type: 'inline', expr: groups.inline })
    } else if (groups.ifBlock !== undefined) {
      segments.push({ type: 'if', cond: blockCond(groups.ifBlock) })
    } else if (groups.elifBlock !== undefined) {
      segments.push({ type: 'elif', cond: blockCond(groups.elifBlock) })
    } else if (groups.ifExpr !== undefined) {
      segments.push({ type: 'if', cond: exprCond(groups.ifExpr) })
    } else if (groups.elifExpr !== undefined) {
      segments.push({ type: 'elif', cond: exprCond(groups.elifExpr) })
    } else if (/^[ \t]*#else\b/.test(match[0])) {
      segments.push({ type: 'else' })
    } else if (/^[ \t]*#endif\b/.test(match[0])) {
      segments.push({ type: 'endif' })
    } else {
      appendLiteral(segments, match[0])
    }

    lastIndex = TOKEN_PATTERN.lastIndex
  }

  if (lastIndex < text.length) {
    appendLiteral(segments, text.slice(lastIndex))
  }

  return segments
}

function appendLiteral(segments: Segment[], text: string): void {
  const last = segments[segments.length - 1]
  if (last?.type === 'literal') {
    last.text += text
  } else {
    segments.push({ type: 'literal', text })
  }
}

export function hasInterpolation(text: string): boolean {
  return (
    text.includes('$```') || text.includes('{{') || DIRECTIVE_PATTERN.test(text)
  )
}
