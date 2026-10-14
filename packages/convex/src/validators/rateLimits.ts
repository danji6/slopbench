import { v } from 'convex/values'

export const rateLimitRuleArgsValidator = v.object({
  key: v.string(),
  limit: v.number(),
  windowMs: v.number(),
})

/** A rate limit counter for one time window. */
export const rateLimitSchema = v.object({
  key: v.string(),
  count: v.number(),
  limit: v.number(),
  windowMs: v.number(),
  startedAt: v.number(),
  expiresAt: v.number(),
})
