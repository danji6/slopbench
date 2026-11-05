import { v } from 'convex/values'

import { mcpManifestEntryValidator } from './mcp'

export const toolkitContextValidator = v.object({
  id: v.string(),
  name: v.string(),
  fingerprint: v.string(),
})

export const toolDefinitionValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.string(),
  definitionRef: v.optional(v.string()),
})

/** Cached shape of a session's tool set. */
export const toolManifestValidator = v.object({
  version: v.optional(v.number()),
  contextId: v.optional(v.string()),
  toolkits: v.optional(v.array(toolkitContextValidator)),
  definitions: v.optional(v.array(toolDefinitionValidator)),
  names: v.array(v.string()),
  hasAgentHome: v.optional(v.boolean()),
  taskRoster: v.optional(v.string()),
  shell: v.optional(v.string()),
  mcp: v.optional(v.array(mcpManifestEntryValidator)),
})
