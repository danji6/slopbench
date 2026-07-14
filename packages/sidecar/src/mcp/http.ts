const BASE_RETRY_DELAY_MS = 750
const MAX_RETRY_DELAY_MS = 2_500

export type RequestContext = {
  signal?: AbortSignal
  deadline: number
}

export function withTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export function boundedDelay(delay: number, deadline: number): number {
  return Math.min(delay, Math.max(0, deadline - Date.now()))
}

export function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRetryableStatus(status: number): boolean {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  )
}

export function retryDelayMs(
  response: Response | undefined,
  attempt: number,
): number {
  const retryAfter = response?.headers.get('retry-after')
  const retryAfterMs = parseRetryAfterMs(retryAfter)
  if (retryAfterMs !== undefined) return retryAfterMs
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
}

function parseRetryAfterMs(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.min(seconds * 1000, MAX_RETRY_DELAY_MS))
  }
  const dateMs = Date.parse(value)
  if (!Number.isFinite(dateMs)) return undefined
  return Math.max(0, Math.min(dateMs - Date.now(), MAX_RETRY_DELAY_MS))
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'request failed'
}
