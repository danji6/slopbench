// TODO make these user-configurable
const RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 600000
const MAX_EMPTY_RESPONSE_RETRIES = 2

/** A provider stream that closed normally without producing model output. */
export class EmptyProviderResponseError extends Error {
  constructor(finishReason?: string) {
    super(
      'The provider returned an empty response' +
        (finishReason ? ` (finish reason: ${finishReason})` : ''),
    )
    this.name = 'EmptyProviderResponseError'
  }
}

export function assertProviderStepOutput(
  hasOutput: boolean,
  finishReason?: string,
) {
  if (!hasOutput) throw new EmptyProviderResponseError(finishReason)
}

const RATE_LIMIT_PATTERNS = [
  /429/i,
  /rate[-\s_]?limit/i,
  /too\s*many\s*requests/i,
  /quota/i,
]

const TRANSIENT_STATUS_CODES = new Set([408, 500, 502, 503, 504, 529])

const TRANSIENT_PATTERNS = [
  /\b(?:econnreset|econnrefused|etimedout|epipe|eai_again|ehostunreach|enetunreach)\b/i,
  /socket hang up/i,
  /fetch failed/i,
  /terminated$/i,
  /overloaded/i,
  /connection (?:closed|reset|refused)/i,
  /internal server error/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /request timeout/i,
]

function backoffDelay(retryAttempt: number) {
  return Math.min(
    RETRY_DELAY_MS * 1.25 ** Math.max(0, retryAttempt - 1),
    MAX_RETRY_DELAY_MS,
  )
}

export function getRateLimitRetryDelay(error: unknown, retryAttempt: number) {
  const values = getErrorChain(error)
  if (!values.some(isRateLimitValue)) return null

  const retryAfter =
    values.map(parseRetryAfter).find((delay) => delay !== undefined) ??
    RETRY_DELAY_MS
  return Math.max(backoffDelay(retryAttempt), retryAfter)
}

export function getTransientRetryDelay(error: unknown, retryAttempt: number) {
  const values = getErrorChain(error)
  if (!values.some(isTransientValue)) return null
  return backoffDelay(retryAttempt)
}

export type ProviderRetryOptions = {
  error: unknown
  retryAttempt: number
  hasOutput: boolean
  aborted?: boolean
}

export function getProviderRateLimitRetryDelay({
  error,
  retryAttempt,
}: ProviderRetryOptions) {
  return getRateLimitRetryDelay(error, retryAttempt)
}

export function getProviderRetryDelay({
  error,
  retryAttempt,
  aborted,
}: ProviderRetryOptions) {
  if (aborted) return null
  if (error instanceof EmptyProviderResponseError) {
    return retryAttempt <= MAX_EMPTY_RESPONSE_RETRIES
      ? backoffDelay(retryAttempt)
      : null
  }
  return (
    getRateLimitRetryDelay(error, retryAttempt) ??
    getTransientRetryDelay(error, retryAttempt)
  )
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

  const message = stringifyErrorCandidate(value)
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
}

function isTransientValue(value: unknown): boolean {
  if (value != null && typeof value === 'object') {
    const { status, statusCode, isRetryable } = value as {
      status?: unknown
      statusCode?: unknown
      isRetryable?: unknown
    }
    if (typeof status === 'number' && TRANSIENT_STATUS_CODES.has(status))
      return true
    if (
      typeof statusCode === 'number' &&
      TRANSIENT_STATUS_CODES.has(statusCode)
    )
      return true
    if (isRetryable === true) return true
  }

  const message = stringifyErrorCandidate(value)
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))
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

function stringifyErrorCandidate(value: unknown): string {
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
