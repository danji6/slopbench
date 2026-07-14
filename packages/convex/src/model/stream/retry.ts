// TODO make these user-configurable
const RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 600000

const RATE_LIMIT_PATTERNS = [
  /429/i,
  /rate[-\s_]?limit/i,
  /too\s*many\s*requests/i,
  /quota/i,
]

export function getRateLimitRetryDelay(error: unknown, retryAttempt: number) {
  const values = getErrorChain(error)
  if (!values.some(isRateLimitValue)) return null

  const retryAfter =
    values.map(parseRetryAfter).find((delay) => delay !== undefined) ??
    RETRY_DELAY_MS
  const exponentialDelay = Math.min(
    RETRY_DELAY_MS * 1.25 ** Math.max(0, retryAttempt - 1),
    MAX_RETRY_DELAY_MS,
  )
  return Math.max(exponentialDelay, retryAfter)
}

export type ProviderRetryOptions = {
  error: unknown
  retryAttempt: number
  hasOutput: boolean
}

export function getProviderRateLimitRetryDelay({
  error,
  retryAttempt,
}: ProviderRetryOptions) {
  return getRateLimitRetryDelay(error, retryAttempt)
}

export function hasReplayableToolOutputSince(
  parts: unknown[],
  startIndex: number,
): boolean {
  const newParts = parts.slice(startIndex)
  if (newParts.length === 0) return false

  const lastSignificantPart = findLast(
    newParts,
    (part) => !isStepStartPart(part),
  )
  return isCompletedToolPart(lastSignificantPart)
}

function getErrorChain(error: unknown): unknown[] {
  const values: unknown[] = []
  const queue = [error]
  const visited = new Set<object>()

  while (queue.length > 0) {
    const value = queue.shift()

    values.push(value)

    if (value == null || typeof value !== 'object' || visited.has(value)) {
      continue
    }

    visited.add(value)

    const nested = value as {
      cause?: unknown
      data?: unknown
      error?: unknown
      errors?: unknown[]
      responseBody?: unknown
    }

    if (nested.cause !== undefined) queue.push(nested.cause)
    if (nested.data !== undefined) queue.push(nested.data)
    if (nested.error !== undefined) queue.push(nested.error)
    if (nested.responseBody !== undefined) queue.push(nested.responseBody)
    if (Array.isArray(nested.errors)) queue.push(...nested.errors)
  }

  return values
}

function isRateLimitValue(value: unknown): boolean {
  if (value != null && typeof value === 'object') {
    const { status, statusCode } = value as {
      status?: unknown
      statusCode?: unknown
    }
    if (status === 429 || statusCode === 429) return true
  }

  const message = stringifyRateLimitCandidate(value)
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
}

function parseRetryAfter(value: unknown): number | undefined {
  if (value != null && typeof value === 'object') {
    const { headers, responseHeaders } = value as {
      headers?: unknown
      responseHeaders?: unknown
    }
    const delay =
      parseRetryAfterHeaders(responseHeaders) ?? parseRetryAfterHeaders(headers)
    if (delay !== undefined) return delay
  }

  const message = value instanceof Error ? value.message : ''
  const match = message.match(/retry[- ]?after[:\s]*(\d+)/i)
  return match ? Number.parseInt(match[1], 10) * 1000 : undefined
}

function parseRetryAfterHeaders(headers: unknown): number | undefined {
  const normalized = normalizeHeaders(headers)
  if (!normalized) return undefined

  const milliseconds = parseDelayValue(normalized['retry-after-ms'])
  if (milliseconds !== undefined) return milliseconds

  const seconds = parseDelayValue(normalized['retry-after'])
  return seconds === undefined ? undefined : seconds * 1000
}

function parseDelayValue(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function normalizeHeaders(headers: unknown): Record<string, unknown> | null {
  if (headers == null || typeof headers !== 'object') return null

  if (headers instanceof Headers) {
    return Object.fromEntries(
      [...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
    )
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  )
}

function stringifyRateLimitCandidate(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (value == null || typeof value !== 'object') return ''

  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function findLast(
  values: unknown[],
  predicate: (value: unknown) => boolean,
): unknown {
  for (let index = values.length - 1; index >= 0; index--) {
    if (predicate(values[index])) return values[index]
  }
  return undefined
}

function isStepStartPart(value: unknown) {
  return (
    value != null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'step-start'
  )
}

function isCompletedToolPart(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false

  const part = value as {
    type?: unknown
    state?: unknown
    preliminary?: unknown
  }

  return (
    typeof part.type === 'string' &&
    part.type.startsWith('tool-') &&
    ((part.state === 'output-available' && part.preliminary !== true) ||
      part.state === 'output-error')
  )
}
