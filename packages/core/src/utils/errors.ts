// Keys carrying a message, in the order they should be preferred
const MESSAGE_KEYS = ['message', 'error', 'statusText'] as const

// Guards against cyclic or nested payloads
const MAX_DEPTH = 4

// The framing Convex puts around a server error
const TRANSPORT_PREFIX = /^(?:\s*\[(?:CONVEX|Request ID)[^\]]*\])+\s*/
const TRANSPORT_SUFFIX = /\s*Called by client\.?\s*$/
const SERVER_ERROR = /^Server Error:?\s*/
const UNCAUGHT = /^Uncaught\s+\w*Error:?\s*/
const STACK_FRAME = /\n\s*at\s|\s+at\s+(?:async\s+)?[\w.$<>]+\s*\(/

/** Attempts to extract the message from a thrown `value`. */
export function errorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > MAX_DEPTH) return undefined
  if (typeof value === 'string') return readText(value, depth)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const keys =
    'data' in record ? (['data', ...MESSAGE_KEYS] as const) : MESSAGE_KEYS

  for (const key of keys) {
    const message = errorMessage(record[key], depth + 1)
    if (message) return message
  }

  return undefined
}

/**
 * Joins an error with its `cause` chain, for provider errors whose outer
 * message is a generic wrapper.
 */
export function errorMessageChain(value: unknown): string | undefined {
  const messages: string[] = []
  let current: unknown = value

  for (let depth = 0; current && depth <= MAX_DEPTH; depth++) {
    const message = errorMessage(current)
    if (message && !messages.includes(message)) messages.push(message)
    current =
      current instanceof Error
        ? (current as Error & { cause?: unknown }).cause
        : undefined
  }

  return messages.length ? messages.join(' ') : undefined
}

function readText(text: string, depth: number): string | undefined {
  const stripped = stripTransport(text).trim()
  if (!stripped) return undefined

  const payload = parseJson(stripped)
  if (payload === undefined) {
    const frame = stripped.search(stripped !== text.trim() ? STACK_FRAME : /\n\s*at\s/)
    return frame === -1 ? stripped : stripped.slice(0, frame).trim()
  }

  return errorMessage(payload, depth + 1) ?? stripped
}

function stripTransport(text: string): string {
  const stripped = text
    .replace(TRANSPORT_PREFIX, '')
    .replace(TRANSPORT_SUFFIX, '')
    .replace(SERVER_ERROR, '')
    .replace(UNCAUGHT, '')

  return stripped
}

function parseJson(text: string): unknown {
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined
  try {
    return JSON.parse(jsonPrefix(text))
  } catch {
    return undefined
  }
}

/** Finds a serialized payload before stack frames, preserving braces and stack-like prose inside strings. */
function jsonPrefix(text: string): string {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') depth++
    else if ((char === '}' || char === ']') && --depth === 0)
      return text.slice(0, i + 1)
  }
  return text
}
