import { extractErrorMessage } from '@/lib/errors'

export const GENERIC_ERROR =
  'An error occurred while processing your request. Please try again later.'

const RATE_LIMIT_PATTERNS = [/429/i, /rate\s*limit/i]

export class ChatError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly key?: string,
  ) {
    super(message)
    this.name = 'ChatError'
  }

  static from(error: unknown): ChatError {
    if (error instanceof ChatError) return error
    return new ChatError(extractErrorMessage(error))
  }
}

export class RateLimitError extends ChatError {
  constructor(
    public readonly retryAfter: number,
    public readonly attempt: number,
    public readonly nextRetryDelay: number,
    public readonly retryAt?: number,
  ) {
    super('Rate limited, retrying...')
    this.name = 'RateLimitError'
  }
}

export class ChatWarning extends Error {
  constructor(
    message: string,
    public readonly key: string,
  ) {
    super(message)
    this.name = 'ChatWarning'
  }
}

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true
  if (error instanceof Error) {
    return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(error.message))
  }
  if (typeof error === 'string') {
    return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(error))
  }
  return false
}

export function parseRetryAfter(error: unknown): number | undefined {
  if (error instanceof Error) {
    const match = error.message.match(/retry[- ]?after[:\s]*(\d+)/i)
    if (match) {
      return parseInt(match[1], 10) * 1000
    }
  }
  return undefined
}
