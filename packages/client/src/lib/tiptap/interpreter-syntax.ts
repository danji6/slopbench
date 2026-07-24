/**
 * Recognizes the prompt interpreter's directive syntax within a block of text,
 * i.e. a single editor paragraph.
 *
 * Grammar (mirrors `@sb/core/interpreter/parse`):
 * - `#eval`..`#end`         block of JS whose return value is injected
 * - `#if`/`#elif`..`#then`  multiline condition, followed by the branch body
 * - `#if`/`#elif <expr>`    inline condition
 * - `#else` / `#endif`      branch/close directives
 * - `{{<expr>}}`            inline expression
 */

/** A highlighted span. */
export type SyntaxToken = {
  kind: 'keyword' | 'code'
  from: number
  to: number
}

type Line = { text: string; start: number }

const RE_EVAL = /^([ \t]*)(#eval)[ \t]*$/
const RE_END = /^([ \t]*)(#end)[ \t]*$/
const RE_THEN = /^([ \t]*)(#then)[ \t]*$/
const RE_IF_BARE = /^([ \t]*)(#(?:if|elif))[ \t]*$/
const RE_IF_EXPR = /^([ \t]*)(#(?:if|elif))([ \t]+)(.*)$/
const RE_ELSE_ENDIF = /^([ \t]*)(#(?:else|endif))[ \t]*$/
const RE_INLINE = /\{\{([^\n]*?)\}\}/g

/** Splits text into lines, tracking each line's start offset. */
function splitLines(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      lines.push({ text: text.slice(start, i), start })
      start = i + 1
    }
  }
  return lines
}

/** Index of the first line at or after `from` matching `re`, else -1. */
function findCloser(lines: Line[], from: number, re: RegExp): number {
  for (let i = from; i < lines.length; i++) {
    if (re.test(lines[i].text)) return i
  }
  return -1
}

/** Pushes a keyword span located at `indent` on `line`. */
function pushKeyword(
  tokens: SyntaxToken[],
  line: Line,
  indent: string,
  keyword: string,
): void {
  const from = line.start + indent.length
  tokens.push({ kind: 'keyword', from, to: from + keyword.length })
}

/** Pushes the keyword of a closer line matched by `re` (`[1]`=indent). */
function pushCloser(tokens: SyntaxToken[], line: Line, re: RegExp): void {
  const match = re.exec(line.text)!
  pushKeyword(tokens, line, match[1], match[2])
}

/** Pushes the body of a block spanning `[from, to)` lines as one code span. */
function pushBody(
  tokens: SyntaxToken[],
  lines: Line[],
  from: number,
  to: number,
): void {
  if (from >= to) return
  const first = lines[from]
  const last = lines[to - 1]
  tokens.push({
    kind: 'code',
    from: first.start,
    to: last.start + last.text.length,
  })
}

/** Emits `{{`/`}}` keyword spans and their inner code for one line. */
function scanInline(tokens: SyntaxToken[], line: Line): void {
  RE_INLINE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = RE_INLINE.exec(line.text)) !== null) {
    const open = line.start + match.index
    const close = open + match[0].length
    tokens.push({ kind: 'keyword', from: open, to: open + 2 })
    if (match[1].length > 0) {
      tokens.push({ kind: 'code', from: open + 2, to: close - 2 })
    }
    tokens.push({ kind: 'keyword', from: close - 2, to: close })
  }
}

/** Finds every highlightable directive span within `text`. */
export function scanInterpreterSyntax(text: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = []
  const lines = splitLines(text)

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    const evalM = RE_EVAL.exec(line.text)
    if (evalM) {
      const close = findCloser(lines, i + 1, RE_END)
      if (close !== -1) {
        pushKeyword(tokens, line, evalM[1], evalM[2])
        pushBody(tokens, lines, i + 1, close)
        pushCloser(tokens, lines[close], RE_END)
        i = close + 1
        continue
      }
    }

    const bareM = RE_IF_BARE.exec(line.text)
    if (bareM) {
      pushKeyword(tokens, line, bareM[1], bareM[2])
      const close = findCloser(lines, i + 1, RE_THEN)
      if (close !== -1) {
        pushBody(tokens, lines, i + 1, close)
        pushCloser(tokens, lines[close], RE_THEN)
        i = close + 1
        continue
      }
      i += 1
      continue
    }

    const exprM = RE_IF_EXPR.exec(line.text)
    if (exprM) {
      pushKeyword(tokens, line, exprM[1], exprM[2])
      const exprStart =
        line.start + exprM[1].length + exprM[2].length + exprM[3].length
      const expr = exprM[4].trimEnd()
      if (expr.length > 0) {
        tokens.push({
          kind: 'code',
          from: exprStart,
          to: exprStart + expr.length,
        })
      }
      i += 1
      continue
    }

    const elseM = RE_ELSE_ENDIF.exec(line.text)
    if (elseM) {
      pushKeyword(tokens, line, elseM[1], elseM[2])
      i += 1
      continue
    }

    scanInline(tokens, line)
    i += 1
  }

  return tokens
}

/**
 * Whether `offset` sits in a JS code context. Lenient about missing closers to
 * allow completions to appear while the block is still being typed.
 */
export function isInCodeContext(text: string, offset: number): boolean {
  const lines = splitLines(text)
  let mode: 'normal' | 'eval' | 'cond' = 'normal'

  for (const line of lines) {
    const lineEnd = line.start + line.text.length
    const onThisLine = offset >= line.start && offset <= lineEnd

    if (mode !== 'normal') {
      const closer = mode === 'eval' ? RE_END : RE_THEN
      if (closer.test(line.text)) {
        mode = 'normal'
        continue
      }
      if (onThisLine) return true
      continue
    }

    if (RE_EVAL.test(line.text)) {
      mode = 'eval'
      continue
    }
    if (RE_IF_BARE.test(line.text)) {
      mode = 'cond'
      continue
    }

    const exprM = RE_IF_EXPR.exec(line.text)
    if (exprM && onThisLine) {
      const exprStart =
        line.start + exprM[1].length + exprM[2].length + exprM[3].length
      return offset >= exprStart
    }

    if (onThisLine) return inInlineBraces(line, offset)
  }

  return false
}

/** Whether `offset` falls inside a `{{..}}` on `line`. */
function inInlineBraces(line: Line, offset: number): boolean {
  RE_INLINE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = RE_INLINE.exec(line.text)) !== null) {
    const open = line.start + match.index + 2
    const close = line.start + match.index + match[0].length - 2
    if (offset >= open && offset <= close) return true
  }
  return false
}
