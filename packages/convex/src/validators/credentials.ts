import { v } from 'convex/values'

/** Which integration a stored API key belongs to. */
export const credentialScopeValidator = v.union(
  v.literal('provider'),
  v.literal('mcp'),
)

/** An API key, never exposed to clients. */
export const credentialSchema = v.object({
  ownerId: v.id('users'),
  scope: credentialScopeValidator,
  /** The provider/server `key` it belongs to. */
  ref: v.string(),
  apiKey: v.string(),
})
