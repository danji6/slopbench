'use node'

import type { McpRuntimeScope } from '@sb/core/types'
import {
  MCP_DEFINITION_CONTENT_TYPE,
  type McpCatalogSnapshot,
  type McpDefinition,
  mcpDefinitionSchema,
} from '@sb/core/types/mcp-catalog'

import { api, internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import type { McpCatalogAppendArgs, McpCatalogIdArgs } from '../types'
import type { StreamExecutionArgs } from '../types'
import { sidecarUrl } from './sidecar'
import { sidecarRequest } from './sidecarTransport'

type ActiveRefresh = {
  scope: McpRuntimeScope
  bootId: string
  generation: string
  expiresAt: number
}

/** Bounds all refresh HTTP requests independently of the toolkit operation watcher. */
export async function catalogRequest<T>(
  route: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(
    new URL(`/mcp-ext/catalog/${route}`, sidecarUrl()),
    sidecarRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    }),
  )

  const result = (await response.json()) as T & { error?: string }
  if (!response.ok || result.error)
    throw new Error(result.error ?? `MCP catalog HTTP ${response.status}`)

  return result
}

/** Stages complete definitions, then changes the published pointer in one transaction. */
export async function refreshCatalog(
  ctx: ActionCtx,
  catalogId: Id<'mcpCatalogs'>,
  active?: ActiveRefresh,
) {
  let snapshot: McpCatalogSnapshot | undefined
  let secrets: string[] = []

  try {
    const connection = await ctx.runQuery(internal.mcpCatalogs._launch, {
      catalogId,
    })
    secrets = [
      connection.apiKey,
      ...Object.values(connection.secretEnv ?? {}),
    ].filter((value): value is string => !!value)

    snapshot = active
      ? await catalogRequest<McpCatalogSnapshot>('active', active)
      : await catalogRequest<McpCatalogSnapshot>('probe', connection)

    await copySnapshot(ctx, catalogId, snapshot)

    const publishedId = await ctx.runMutation(internal.mcpCatalogs._publish, {
      catalogId,
      count: snapshot.count,
      fingerprint: snapshot.fingerprint,
    })

    if (active && snapshot.changeToken !== undefined) {
      await catalogRequest('acknowledge', {
        ...active,
        expiresAt: Date.now() + 30_000,
        changeToken: snapshot.changeToken,
      }).catch(() => {})
    }

    return {
      catalogId: publishedId,
      count: snapshot.count,
      transport: snapshot.transport,
    }
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    for (const secret of secrets)
      message = message.split(secret).join('[redacted]')
    await ctx.runMutation(internal.mcpCatalogs._fail, {
      catalogId,
      error: message,
    })
    // eslint-disable-next-line preserve-caught-error
    throw new Error(message)
  } finally {
    if (snapshot)
      await catalogRequest('release', { id: snapshot.id }).catch(() => {})
  }
}

async function copySnapshot(
  ctx: ActionCtx,
  catalogId: Id<'mcpCatalogs'>,
  snapshot: McpCatalogSnapshot,
) {
  let cursor: number | null = 0
  let count = 0

  while (cursor !== null) {
    const page: { tools: McpDefinition[]; nextCursor: number | null } =
      await catalogRequest('page', { id: snapshot.id, cursor })
    if (page.nextCursor !== null && page.nextCursor <= cursor)
      throw new Error('Invalid MCP snapshot cursor')

    const rows: McpCatalogAppendArgs['tools'] = []
    try {
      for (const raw of page.tools) {
        const definition = mcpDefinitionSchema.parse(raw)
        const blob = new Blob([JSON.stringify(definition)], {
          type: MCP_DEFINITION_CONTENT_TYPE,
        })
        const definitionRef = await ctx.storage.store(blob)

        rows.push({
          name: definition.name,
          description: definition.description?.slice(0, 256),
          descriptionTruncated: (definition.description?.length ?? 0) > 256,
          diagnostic: definition.diagnostic,
          definitionRef,
          order: count++,
          bytes: blob.size,
        })
      }

      await ctx.runMutation(internal.mcpCatalogs._append, {
        catalogId,
        tools: rows,
      })
    } catch (error) {
      // Published/staged rows own their references even if a mutation response was lost.
      const owned: string[] = await ctx.runQuery(
        internal.mcpCatalogs._references,
        { catalogId },
      )
      for (const row of rows) {
        if (!owned.includes(row.definitionRef))
          await ctx.storage.delete(row.definitionRef)
      }
      throw error
    }
    cursor = page.nextCursor
  }
  if (count !== snapshot.count)
    throw new Error('Incomplete MCP discovery snapshot')
}

export async function expireCatalog(
  ctx: ActionCtx,
  args: McpCatalogIdArgs,
): Promise<void> {
  const more = await ctx.runMutation(internal.mcpCatalogs._expire, args)
  if (more)
    await ctx.scheduler.runAfter(0, internal.actions.mcpCatalogs._expire, args)
}

/** Starts settings discovery only after the existing saved configuration is accepted. */
export async function refreshSavedCatalog(
  ctx: ActionCtx,
  serverId: Id<'mcpServers'>,
) {
  const catalogId = await ctx.runMutation(api.mcpCatalogs.begin, { serverId })
  return refreshCatalog(ctx, catalogId)
}

/** Reads notifications without touching a busy tool; actual refresh runs independently. */
export async function refreshStaleCatalogs(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
) {
  const runtimes = await ctx.runQuery(
    internal.mcpCatalogs._activeRuntimes,
    execution,
  )
  for (const runtime of runtimes) {
    if (!runtime.serverId) continue
    try {
      const response = await fetch(
        new URL('/mcp-ext/status', sidecarUrl()),
        sidecarRequest({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: runtime.scope }),
          signal: AbortSignal.timeout(2_000),
        }),
      )
      const status = (await response.json()) as { catalogStale?: boolean }
      if (response.ok && status?.catalogStale) {
        await ctx.runMutation(internal.mcpCatalogs._beginActive, {
          ...execution,
          serverId: runtime.serverId as Id<'mcpServers'>,
        })
      }
    } catch (error) {
      await ctx
        .runMutation(internal.mcpCatalogs._activeFailure, {
          ...execution,
          serverId: runtime.serverId as Id<'mcpServers'>,
          error:
            error instanceof Error
              ? error.message
              : 'MCP catalog refresh unavailable',
        })
        .catch(() => {})
    }
  }
}

export async function refreshActiveCatalog(
  ctx: ActionCtx,
  args: McpCatalogIdArgs & { runtimeId: Id<'mcpRuntimes'>; key: string },
) {
  const runtime = await ctx.runQuery(internal.mcp._catalogRuntime, {
    runtimeId: args.runtimeId,
    key: args.key,
  })
  if (!runtime?.bootId || !runtime.generation) {
    await ctx.runMutation(internal.mcpCatalogs._fail, {
      catalogId: args.catalogId,
      error: 'MCP catalog runtime was revoked',
    })
    return
  }
  await refreshCatalog(ctx, args.catalogId, {
    scope: runtime.scope,
    bootId: runtime.bootId,
    generation: runtime.generation,
    expiresAt: Date.now() + 30_000,
  })
}
