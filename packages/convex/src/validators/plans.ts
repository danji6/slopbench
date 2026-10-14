import { v } from 'convex/values'

export const planStatusValidator = v.union(
  v.literal('draft'),
  v.literal('approved'),
)

/** A session’s editable plan and completion status. */
export const planSchema = v.object({
  sessionId: v.id('sessions'),
  content: v.string(),
  status: planStatusValidator,
  /** Marks the user's edits. */
  dirty: v.optional(v.boolean()),
  updatedAt: v.number(),
})
