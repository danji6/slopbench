import { v } from 'convex/values'

export const sessionModeValidator = v.union(
  v.literal('normal'),
  v.literal('plan'),
  v.literal('ask'),
)
