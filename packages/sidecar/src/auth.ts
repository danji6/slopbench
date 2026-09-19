import type { MiddlewareHandler } from 'hono'
import { timingSafeEqual } from 'node:crypto'

/** Rejects operational requests unless they carry the backend credential. */
export function sidecarAuthentication(
  secret: string | undefined,
): MiddlewareHandler {
  if (!secret?.trim()) throw new Error('SIDECAR_SECRET must be configured')
  const expected = Buffer.from(`Bearer ${secret}`)
  return async (c, next) => {
    const received = Buffer.from(c.req.header('Authorization') ?? '')
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  }
}
