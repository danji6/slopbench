import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { RateLimitRuleArgs } from '../types'

const RETENTION_MS = 24 * 60 * 60 * 1000
const PRUNE_BATCH_SIZE = 64

export type RateLimitStatus = {
  limited: boolean
  retryAfter: number
  resetAt: number | null
}

export type RateLimitDecision = {
  allowed: boolean
  remaining: number
  retryAfter: number
  resetAt: number
}

export async function check(
  ctx: QueryCtx,
  key: string,
  now: number,
): Promise<RateLimitStatus> {
  const row = await byKey(ctx, key)
  return status(row, now)
}

/** Record an event and return whether subsequent events are now limited. */
export async function record(
  ctx: MutationCtx,
  args: RateLimitRuleArgs,
): Promise<RateLimitStatus> {
  validateRule(args)
  const now = Date.now()
  const row = await writeEvent(ctx, args, now)
  await pruneExpired(ctx, now)
  return status(row, now)
}

/** Atomically allow up to `limit` events in a fixed window. */
export async function consume(
  ctx: MutationCtx,
  args: RateLimitRuleArgs,
): Promise<RateLimitDecision> {
  validateRule(args)
  const now = Date.now()
  const current = await byKey(ctx, args.key)
  const active = sameActiveRule(current, args, now) ? current : null

  if (active && active.count >= args.limit) {
    return decision(false, active, now)
  }

  const row = await writeEvent(ctx, args, now, current)
  await pruneExpired(ctx, now)
  return decision(true, row, now)
}

export async function clear(ctx: MutationCtx, key: string) {
  const row = await byKey(ctx, key)
  if (row) await ctx.db.delete(row._id)
}

async function writeEvent(
  ctx: MutationCtx,
  args: RateLimitRuleArgs,
  now: number,
  knownCurrent?: Doc<'rateLimits'> | null,
): Promise<Doc<'rateLimits'>> {
  const current =
    knownCurrent === undefined ? await byKey(ctx, args.key) : knownCurrent
  const active = sameActiveRule(current, args, now) ? current : null

  if (active) {
    const count = active.count + 1
    await ctx.db.patch(active._id, { count })
    return { ...active, count }
  }

  if (current) await ctx.db.delete(current._id)
  const value = {
    key: args.key,
    count: 1,
    limit: args.limit,
    windowMs: args.windowMs,
    startedAt: now,
    expiresAt: now + args.windowMs,
  }
  const id = await ctx.db.insert('rateLimits', value)
  return { ...value, _id: id, _creationTime: now }
}

function sameActiveRule(
  row: Doc<'rateLimits'> | null,
  args: RateLimitRuleArgs,
  now: number,
): row is Doc<'rateLimits'> {
  return Boolean(
    row &&
    row.expiresAt > now &&
    row.limit === args.limit &&
    row.windowMs === args.windowMs,
  )
}

function status(row: Doc<'rateLimits'> | null, now: number): RateLimitStatus {
  if (!row || row.expiresAt <= now || row.count < row.limit) {
    return { limited: false, retryAfter: 0, resetAt: null }
  }
  return {
    limited: true,
    retryAfter: retryAfter(row.expiresAt, now),
    resetAt: row.expiresAt,
  }
}

function decision(
  allowed: boolean,
  row: Doc<'rateLimits'>,
  now: number,
): RateLimitDecision {
  return {
    allowed,
    remaining: Math.max(0, row.limit - row.count),
    retryAfter: allowed ? 0 : retryAfter(row.expiresAt, now),
    resetAt: row.expiresAt,
  }
}

function retryAfter(expiresAt: number, now: number) {
  return Math.max(1, Math.ceil((expiresAt - now) / 1000))
}

function validateRule({ limit, windowMs }: RateLimitRuleArgs) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Rate limit must be a positive integer')
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('Rate limit window must be positive')
  }
}

async function byKey(ctx: QueryCtx, key: string) {
  return ctx.db
    .query('rateLimits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique()
}

async function pruneExpired(ctx: MutationCtx, now: number) {
  const expired = await ctx.db
    .query('rateLimits')
    .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now - RETENTION_MS))
    .take(PRUNE_BATCH_SIZE)

  for (const row of expired) await ctx.db.delete(row._id)
}
