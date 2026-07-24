import type { Condition, Segment } from './types'

// The order here matters
const TOKEN_PATTERN =
  /```[\s\S]*?```|^[ \t]*#eval[ \t]*\n(?<eval>[\s\S]*?)\n[ \t]*#end[ \t]*$|\{\{(?<inline>[^\n]*?)\}\}|`[^`\n]*`|^[ \t]*#if[ \t]*\n(?<ifBlock>[\s\S]*?)\n[ \t]*#then[ \t]*$|^[ \t]*#elif[ \t]*\n(?<elifBlock>[\s\S]*?)\n[ \t]*#then[ \t]*$|^[ \t]*#if[ \t]+(?<ifExpr>.*)$|^[ \t]*#elif[ \t]+(?<elifExpr>.*)$|^[ \t]*#else[ \t]*$|^[ \t]*#endif[ \t]*$/gm

const DIRECTIVE_PATTERN = /^[ \t]*#(?:if|elif|else|endif|eval)\b/m

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
    const ifCond = condition(groups.ifBlock, groups.ifExpr)
    const elifCond = condition(groups.elifBlock, groups.elifExpr)

    if (groups.eval !== undefined) {
      segments.push({ type: 'block', code: groups.eval })
    } else if (groups.inline !== undefined) {
      segments.push({ type: 'inline', expr: groups.inline })
    } else if (ifCond) {
      segments.push({ type: 'if', cond: ifCond })
    } else if (elifCond) {
      segments.push({ type: 'elif', cond: elifCond })
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

/** The condition of an `#if`/`#elif`, from whichever form matched. */
function condition(code?: string, expr?: string): Condition | null {
  if (code !== undefined) return { kind: 'block', code }
  if (expr !== undefined) return { kind: 'expr', expr }
  return null
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
  return text.includes('{{') || DIRECTIVE_PATTERN.test(text)
}
