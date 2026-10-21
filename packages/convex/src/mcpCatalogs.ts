import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Access from './model/mcpCatalogAccess'
import { sweepOrphanDefinitions } from './model/mcpCatalogCleanup'
import * as Catalogs from './model/mcpCatalogs'
import * as V from './validators/mcpCatalogs'
import { streamExecutionArgsValidator } from './validators/streams'

export const begin = authMutation({
  args: V.catalogBeginValidator.fields,
  handler: Catalogs.begin,
})

export const _sweepOrphans = internalMutation({
  args: V.catalogSweepValidator.fields,
  handler: sweepOrphanDefinitions,
})

export const _activeFailure = internalMutation({
  args: V.catalogActiveFailureValidator.fields,
  handler: Catalogs.activeFailure,
})

export const page = authQuery({
  args: V.catalogPageValidator.fields,
  handler: Catalogs.page,
})

export const _launch = internalQuery({
  args: V.catalogIdValidator.fields,
  handler: Catalogs.launch,
})

export const _append = internalMutation({
  args: V.catalogAppendValidator.fields,
  handler: Catalogs.append,
})

export const _publish = internalMutation({
  args: V.catalogPublishValidator.fields,
  handler: Catalogs.publish,
})

export const _fail = internalMutation({
  args: V.catalogFailureValidator.fields,
  handler: Catalogs.fail,
})

export const _expire = internalMutation({
  args: V.catalogIdValidator.fields,
  handler: Catalogs.expire,
})

export const _references = internalQuery({
  args: V.catalogIdValidator.fields,
  handler: Catalogs.references,
})

export const _target = internalQuery({
  args: V.catalogTargetValidator.fields,
  handler: Access.target,
})

export const _search = internalQuery({
  args: V.catalogSearchValidator.fields,
  handler: Access.search,
})

export const _available = internalQuery({
  args: streamExecutionArgsValidator.fields,
  handler: Access.available,
})

export const _definitionAccess = internalQuery({
  args: V.catalogDefinitionAccessValidator.fields,
  handler: Access.definitionAccess,
})

export const _activeRuntimes = internalQuery({
  args: streamExecutionArgsValidator.fields,
  handler: Catalogs.activeRuntimes,
})

export const _beginActive = internalMutation({
  args: V.catalogActiveValidator.fields,
  handler: Catalogs.beginActive,
})

export const definitionUrl = authQuery({
  args: { serverId: v.id('mcpServers'), toolId: v.id('mcpCatalogTools') },
  handler: Catalogs.definitionUrl,
})
