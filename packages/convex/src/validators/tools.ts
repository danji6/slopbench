import { v } from 'convex/values'

import { mcpManifestEntryValidator } from './mcp'

/** Cached shape of a session's tool set. */
export const toolManifestValidator = v.object({
  names: v.array(v.string()),
  hasAgentHome: v.optional(v.boolean()),
  taskRoster: v.optional(v.string()),
  shell: v.optional(v.string()),
  mcp: v.optional(v.array(mcpManifestEntryValidator)),
})
