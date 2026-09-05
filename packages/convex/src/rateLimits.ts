import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import * as RateLimits from './model/rateLimits'
import { rateLimitRuleArgsValidator } from './validators'

const statusValidator = v.object({
  limited: v.boolean(),
  retryAfter: v.number(),
  resetAt: v.union(v.null(), v.number()),
})

export const _check = internalQuery({
  args: { key: v.string(), now: v.number() },
  returns: statusValidator,
  handler: (ctx, { key, now }) => RateLimits.check(ctx, key, now),
})

export const _record = internalMutation({
  args: rateLimitRuleArgsValidator.fields,
  returns: statusValidator,
  handler: RateLimits.record,
})

export const _consume = internalMutation({
  args: rateLimitRuleArgsValidator.fields,
  returns: v.object({
    allowed: v.boolean(),
    remaining: v.number(),
    retryAfter: v.number(),
    resetAt: v.number(),
  }),
  handler: RateLimits.consume,
})

export const _clear = internalMutation({
  args: { key: v.string() },
  handler: (ctx, { key }) => RateLimits.clear(ctx, key),
})
