/** Returns the retry window supplied by the auth server, in seconds. */
export function retryAfterSeconds(response: Response): number {
  const seconds = Number(response.headers.get('X-Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}
