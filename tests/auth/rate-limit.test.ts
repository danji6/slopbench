/// <reference types="bun-types" />
import {
  AUTH_FAILURE_RATE_LIMIT,
  authFailureRateLimit,
  isAuthFailure,
  withRetryAfter,
} from '@sb/convex/lib/authFailureRateLimit'
import { rateLimitKey } from '@sb/convex/lib/rateLimits'
import * as RateLimits from '@sb/convex/model/rateLimits'
import { describe, expect, test } from 'bun:test'

function rateLimitState() {
  const rows = new Map<string, Record<string, unknown>>()
  let nextId = 0

  const ctx = {
    db: {
      query: (table: string) => {
        expect(table).toBe('rateLimits')
        return {
          withIndex: (
            index: string,
            build: (q: {
              eq: (field: string, value: unknown) => unknown
              lt: (field: string, value: number) => unknown
            }) => unknown,
          ) => {
            let value: unknown
            const q = {
              eq: (_field: string, input: unknown) => {
                value = input
                return q
              },
              lt: (_field: string, input: number) => {
                value = input
                return q
              },
            }
            build(q)
            return {
              unique: async () =>
                [...rows.values()].find((row) => row.key === value) ?? null,
              take: async (limit: number) =>
                [...rows.values()]
                  .filter((row) =>
                    index === 'by_expiresAt'
                      ? Number(row.expiresAt) < Number(value)
                      : true,
                  )
                  .slice(0, limit),
            }
          },
        }
      },
      insert: async (_table: string, value: Record<string, unknown>) => {
        const id = `rateLimit-${++nextId}`
        rows.set(id, { ...value, _id: id, _creationTime: Date.now() })
        return id
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        rows.set(id, { ...rows.get(id), ...value })
      },
      delete: async (id: string) => {
        rows.delete(id)
      },
    },
  }

  return { ctx: ctx as never }
}

describe('rate-limit keys', () => {
  test('do not collide across scopes or subjects', () => {
    expect(rateLimitKey('ab', 'c')).not.toBe(rateLimitKey('a', 'bc'))
    expect(rateLimitKey('auth', '203.0.113.4')).toBe(
      rateLimitKey('auth', '203.0.113.4'),
    )
  })
})

describe('rate limiter', () => {
  test('recording the threshold limits subsequent events', async () => {
    const { ctx } = rateLimitState()
    const rule = { key: 'login', limit: 1, windowMs: 3_000 }

    const recorded = await RateLimits.record(ctx, rule)
    const checked = await RateLimits.check(ctx, rule.key, Date.now())

    expect(recorded.limited).toBe(true)
    expect(checked.limited).toBe(true)
    expect(checked.retryAfter).toBeGreaterThan(0)
    expect(
      await RateLimits.check(ctx, rule.key, recorded.resetAt! + 1),
    ).toEqual({
      limited: false,
      retryAfter: 0,
      resetAt: null,
    })
  })

  test('consume atomically allows the configured number of events', async () => {
    const { ctx } = rateLimitState()
    const rule = { key: 'messages', limit: 2, windowMs: 60_000 }

    expect(await RateLimits.consume(ctx, rule)).toMatchObject({
      allowed: true,
      remaining: 1,
    })
    expect(await RateLimits.consume(ctx, rule)).toMatchObject({
      allowed: true,
      remaining: 0,
    })
    expect(await RateLimits.consume(ctx, rule)).toMatchObject({
      allowed: false,
      remaining: 0,
    })
  })
})

describe('auth failure rate limit', () => {
  test('limits credential endpoints by IP', () => {
    expect(
      authFailureRateLimit('/api/auth/sign-in/username', '203.0.113.4'),
    ).toEqual({
      key: rateLimitKey('auth:sign-in', '203.0.113.4'),
      ...AUTH_FAILURE_RATE_LIMIT,
    })
    expect(authFailureRateLimit('/api/auth/convex/token', '203.0.113.4')).toBe(
      null,
    )
  })

  test('counts caller failures but not server failures', () => {
    expect(isAuthFailure(new Response(null, { status: 401 }))).toBe(true)
    expect(isAuthFailure(new Response(null, { status: 422 }))).toBe(true)
    expect(isAuthFailure(new Response(null, { status: 500 }))).toBe(false)
  })

  test('adds a whole-second retry window without replacing the response', () => {
    const response = withRetryAfter(
      new Response('Invalid credentials', { status: 401 }),
      2.1,
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('X-Retry-After')).toBe('3')
  })
})
