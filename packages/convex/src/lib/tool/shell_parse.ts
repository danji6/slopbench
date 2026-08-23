export interface ChainSegment {
  text: string
  hasSubstitution: boolean
  hasRiskyRedirect: boolean
}

export interface ShellToken {
  value: string
  quoted: boolean
}

/** Split a command into chain segments, tracking unsafe constructs. */
export function splitShellChain(command: string): ChainSegment[] {
  const segments: ChainSegment[] = []
  let text = ''
  let hasSubstitution = false
  let hasRiskyRedirect = false

  const flush = () => {
    const trimmed = text.trim()
    if (trimmed || hasSubstitution || hasRiskyRedirect)
      segments.push({ text: trimmed, hasSubstitution, hasRiskyRedirect })
    text = ''
    hasSubstitution = false
    hasRiskyRedirect = false
  }

  let i = 0
  while (i < command.length) {
    const ch = command[i]!
    const next = command[i + 1]

    if (ch === "'") {
      const end = command.indexOf("'", i + 1)
      text += command.slice(i, end === -1 ? undefined : end + 1)
      i = end === -1 ? command.length : end + 1
    } else if (ch === '\\') {
      text += command.slice(i, i + 2)
      i += 2
    } else if (ch === '"') {
      const scanned = scanDoubleQuoted(command, i)
      text += scanned.text
      hasSubstitution ||= scanned.hasSubstitution
      i = scanned.next
    } else if (
      ch === '`' ||
      (ch === '$' && next === '(') ||
      ((ch === '<' || ch === '>') && next === '(') ||
      ch === '(' ||
      ch === ')'
    ) {
      hasSubstitution = true
      text += ch
      i++
    } else if (ch === '<' && next === '<') {
      const heredoc = consumeHeredoc(command, i)
      if (heredoc.consumed) {
        i = heredoc.next
        flush()
      } else {
        text += command.slice(i, heredoc.next)
        i = heredoc.next
      }
    } else if (ch === '\n' || ch === ';') {
      flush()
      i++
    } else if (ch === '|') {
      flush()
      i += next === '|' ? 2 : 1
    } else if (ch === '&' && next === '>') {
      const redirect = consumeRedirect(command, i + 1)
      hasRiskyRedirect ||= redirect.risky
      i = redirect.next
    } else if (ch === '&') {
      flush()
      i += next === '&' ? 2 : 1
    } else if (ch === '>') {
      text = text.replace(/(^|\s)\d+$/, '$1')
      const redirect = consumeRedirect(command, i)
      hasRiskyRedirect ||= redirect.risky
      i = redirect.next
    } else {
      text += ch
      i++
    }
  }
  flush()

  return segments
}

function scanDoubleQuoted(command: string, start: number) {
  let hasSubstitution = false
  let i = start + 1
  while (i < command.length && command[i] !== '"') {
    if (command[i] === '\\') i += 2
    else {
      if (command[i] === '`' || (command[i] === '$' && command[i + 1] === '('))
        hasSubstitution = true
      i++
    }
  }
  const next = Math.min(i + 1, command.length)
  return { text: command.slice(start, next), hasSubstitution, next }
}

function consumeRedirect(command: string, i: number) {
  let j = i + 1
  if (command[j] === '>') j++

  if (command[j] === '&') {
    j++
    let digits = ''
    while (/\d/.test(command[j] ?? '')) digits += command[j++]
    if (digits) return { next: j, risky: false }
  }

  while (command[j] === ' ' || command[j] === '\t') j++
  let target = ''
  while (j < command.length && !/[\s|&;<>]/.test(command[j]!))
    target += command[j++]

  return { next: j, risky: target !== '/dev/null' }
}

function consumeHeredoc(command: string, i: number) {
  let j = i + 2
  const stripLeadingTabs = command[j] === '-'
  if (stripLeadingTabs) j++

  while (command[j] === ' ' || command[j] === '\t') j++

  let delimiter = ''
  if (command[j] === "'" || command[j] === '"') {
    const quote = command[j]
    const end = command.indexOf(quote, j + 1)
    delimiter = command.slice(j + 1, end === -1 ? undefined : end)
    j = end === -1 ? command.length : end + 1
  } else {
    while (j < command.length && !/[\s|&;<>]/.test(command[j]!)) {
      if (command[j] === '\\' && j + 1 < command.length) {
        delimiter += command[j + 1]
        j += 2
      } else {
        delimiter += command[j]
        j++
      }
    }
  }

  if (!delimiter) return { next: j, consumed: false }

  const bodyStart = command.indexOf('\n', j)
  if (bodyStart === -1) return { next: command.length, consumed: true }

  const terminator = new RegExp(
    `^${stripLeadingTabs ? '\\t*' : ''}${escapeRegExp(delimiter)}$`,
  )

  let pos = bodyStart + 1
  while (pos <= command.length) {
    const lineEnd = command.indexOf('\n', pos)
    const end = lineEnd === -1 ? command.length : lineEnd
    if (terminator.test(command.slice(pos, end))) {
      return { next: Math.min(end + 1, command.length), consumed: true }
    }
    if (lineEnd === -1) break
    pos = lineEnd + 1
  }

  return { next: command.length, consumed: true }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Split a segment into words while retaining quote provenance. */
export function tokenizeShell(text: string): ShellToken[] {
  const tokens: ShellToken[] = []
  let current: string | null = null
  let quoted = false
  const append = (chunk: string) => (current = (current ?? '') + chunk)
  const flush = () => {
    if (current !== null) tokens.push({ value: current, quoted })
    current = null
    quoted = false
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === "'") {
      const end = text.indexOf("'", i + 1)
      quoted = true
      append(text.slice(i + 1, end === -1 ? undefined : end))
      i = end === -1 ? text.length : end + 1
    } else if (ch === '"') {
      let j = i + 1
      let chunk = ''
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length) {
          chunk += text[j + 1]!
          j += 2
        } else chunk += text[j++]!
      }
      quoted = true
      append(chunk)
      i = j + 1
    } else if (ch === '\\') {
      append(text[i + 1] ?? '')
      i += 2
    } else if (/\s/.test(ch)) {
      flush()
      i++
    } else {
      append(ch)
      i++
    }
  }
  flush()

  return tokens
}
