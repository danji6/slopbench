import type { Segment } from './types'

const TOKEN_PATTERN =
  /\$```([\s\S]*?)```|```[\s\S]*?```|\{\{([^\n]*?)\}\}|`[^`\n]*`/g

export function parse(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  TOKEN_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      appendLiteral(segments, text.slice(lastIndex, match.index))
    }

    if (match[1] !== undefined) {
      segments.push({ type: 'block', code: match[1] })
    } else if (match[2] !== undefined) {
      segments.push({ type: 'inline', expr: match[2] })
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
  return text.includes('$```') || text.includes('{{')
}
