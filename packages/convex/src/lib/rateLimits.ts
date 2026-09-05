import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import type { RateLimitRuleArgs } from '../types'

export const RETRY_AFTER_HEADER = 'X-Retry-After'

/** Collision-safe key shared by every rate limit use case. */
export function rateLimitKey(scope: string, subject: string) {
  return JSON.stringify([scope, subject])
}

export function checkRateLimit(ctx: ActionCtx, key: string) {
  return ctx.runQuery(internal.rateLimits._check, { key, now: Date.now() })
}

export function recordRateLimit(ctx: ActionCtx, rule: RateLimitRuleArgs) {
  return ctx.runMutation(internal.rateLimits._record, rule)
}

export function consumeRateLimit(ctx: ActionCtx, rule: RateLimitRuleArgs) {
  return ctx.runMutation(internal.rateLimits._consume, rule)
}

export async function clearRateLimit(ctx: ActionCtx, key: string) {
  await ctx.runMutation(internal.rateLimits._clear, { key })
}
