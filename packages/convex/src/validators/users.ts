import { v } from 'convex/values'

export const userRoleValidator = v.union(
  v.literal('user'),
  v.literal('moderator'),
  v.literal('admin'),
)

/** An authenticated account and its application role. */
export const userSchema = v.object({
  subject: v.string(),
  role: userRoleValidator,
})
