import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { streamExecutionArgsValidator } from './streams'

export const mcpCatalogSchema = v.object({
  ownerId: v.id('users'),
  serverId: v.id('mcpServers'),
  configRevision: v.number(),
  previousId: v.optional(v.id('mcpCatalogs')),
  state: v.string(),
  count: v.number(),
  bytes: v.number(),
  error: v.optional(v.string()),
  fingerprint: v.optional(v.string()),
  createdAt: v.number(),
  runtimeId: v.optional(v.id('mcpRuntimes')),
  runtimeKey: v.optional(v.string()),
})

export const mcpCatalogToolSchema = v.object({
  catalogId: v.id('mcpCatalogs'),
  serverId: v.id('mcpServers'),
  name: v.string(),
  description: v.optional(v.string()),
  descriptionTruncated: v.optional(v.boolean()),
  diagnostic: v.optional(v.string()),
  definitionRef: v.id('_storage'),
  order: v.number(),
  bytes: v.number(),
})

export const mcpCatalogPinSchema = v.object({
  catalogId: v.id('mcpCatalogs'),
  cacheId: v.id('sessionCache'),
})

export const catalogIdValidator = v.object({
  catalogId: v.id('mcpCatalogs'),
})

export const catalogRefreshActiveValidator = v.object({
  ...catalogIdValidator.fields,
  runtimeId: v.id('mcpRuntimes'),
  key: v.string(),
})

export const catalogBeginValidator = v.object({
  serverId: v.id('mcpServers'),
})

export const catalogActiveValidator = v.object({
  immediate: v.optional(v.boolean()),
  ...streamExecutionArgsValidator.fields,
  ...catalogBeginValidator.fields,
})

export const catalogAppendValidator = v.object({
  ...catalogIdValidator.fields,
  tools: v.array(
    v.object({
      name: v.string(),
      description: v.optional(v.string()),
      descriptionTruncated: v.optional(v.boolean()),
      diagnostic: v.optional(v.string()),
      definitionRef: v.id('_storage'),
      order: v.number(),
      bytes: v.number(),
    }),
  ),
})

export const catalogPublishValidator = v.object({
  ...catalogIdValidator.fields,
  count: v.number(),
  fingerprint: v.string(),
})

export const catalogFailureValidator = v.object({
  ...catalogIdValidator.fields,
  error: v.string(),
})

export const catalogPageValidator = v.object({
  ...catalogBeginValidator.fields,
  catalogId: v.optional(v.id('mcpCatalogs')),
  paginationOpts: paginationOptsValidator,
})

export const catalogTargetValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  serverId: v.id('mcpServers'),
  toolId: v.id('mcpCatalogTools'),
  forDefinition: v.optional(v.boolean()),
})

export const catalogSearchValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  serverId: v.optional(v.id('mcpServers')),
  query: v.string(),
  cursor: v.optional(v.string()),
  limit: v.number(),
})

export const catalogDefinitionAccessValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  definitionRef: v.id('_storage'),
})

export const catalogActiveFailureValidator = v.object({
  ...catalogActiveValidator.fields,
  error: v.string(),
})

export const catalogSweepValidator = v.object({
  cursor: v.optional(v.string()),
  before: v.optional(v.number()),
})
