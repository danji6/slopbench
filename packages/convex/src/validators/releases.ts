import { v } from 'convex/values'

/** Boot state for migration and deploy phases. */
export const releaseStateSchema = v.object({
  key: v.literal('schema'),
  version: v.number(),
  targetVersion: v.number(),
  phase: v.union(v.literal('migrating'), v.literal('complete')),
  updatedAt: v.number(),
})
