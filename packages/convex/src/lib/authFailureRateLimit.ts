import { RETRY_AFTER_HEADER, rateLimitKey } from './rateLimits'

const AUTH_FAILURE_SCOPES: Record<string, string> = {
  '/api/auth/sign-in/username': 'auth:sign-in',
  '/api/auth/sign-up/email': 'auth:sign-up',
}

export const AUTH_FAILURE_RATE_LIMIT = { limit: 1, windowMs: 3_000 }

/** Build an IP rule for credential submission endpoints. */
export function authFailureRateLimit(pathname: string, ip: string | null) {
  const scope = AUTH_FAILURE_SCOPES[pathname]
  if (!scope) return null

  return {
    key: rateLimitKey(scope, ip ?? 'unknown'),
    ...AUTH_FAILURE_RATE_LIMIT,
  }
}

export function isAuthFailure(response: Response) {
  // Only caller failures count; infrastructure failures should remain retryable
  return response.status >= 400 && response.status < 500
}

export function withRetryAfter(response: Response, seconds: number) {
  const headers = new Headers(response.headers)
  headers.set(RETRY_AFTER_HEADER, String(Math.max(1, Math.ceil(seconds))))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
