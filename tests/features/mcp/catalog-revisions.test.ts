import type { Id } from '@sb/convex/_generated/dataModel'
import * as Access from '@sb/convex/model/mcpCatalogAccess'
import { refreshCatalog } from '@sb/convex/model/mcpCatalogActions'
import { pinManifest, releasePins } from '@sb/convex/model/mcpCatalogPins'
import * as Catalogs from '@sb/convex/model/mcpCatalogs'
import { createExternalMcpTool } from '@sb/convex/model/tool/mcp'
import { expect, test } from 'bun:test'
import { mcpCatalogBackend as fixture } from '~/tests/helpers/mcp-catalog-backend'

test('failed and superseded refreshes retain the previous revision and reject stale handles', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const old = await f.target()
    const failed = await Catalogs.begin(f.ctx, { serverId: f.serverId })
    await Catalogs.fail(f.ctx, {
      catalogId: failed,
      error: 'A continuation page failed',
    })
    expect((await f.db.get(f.serverId))?.catalogId).toBe(f.catalogId)
    expect((await f.db.get(f.serverId))?.catalogError).toContain('continuation')
    const next = await Catalogs.begin(f.ctx, { serverId: f.serverId })
    await expect(
      Catalogs.publish(f.ctx, {
        catalogId: next,
        count: 250,
        fingerprint: 'changed',
      }),
    ).rejects.toThrow('incomplete')
    const newer = await Catalogs.begin(f.ctx, { serverId: f.serverId })
    await expect(
      Catalogs.publish(f.ctx, {
        catalogId: next,
        count: 0,
        fingerprint: 'changed',
      }),
    ).rejects.toThrow('superseded')
    await f.sidecar.registry.call(
      f.status.scope,
      'tool_000',
      { changeCatalog: true },
      f.status,
    )
    await refreshCatalog(f.action, newer, {
      scope: f.status.scope,
      bootId: f.status.bootId,
      generation: f.status.generation,
      expiresAt: Date.now() + 30_000,
    })
    await expect(
      f.broker.call_mcp_tool.execute!(old, f.options()),
    ).rejects.toThrow('stale')
    expect(f.rows('mcpOperations')).toHaveLength(0)
  } finally {
    await f.close()
  }
}, 20_000)

test('every catalog page is searchable and unchanged refreshes keep opaque identities', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const names: string[] = []
    let cursor: string | undefined
    do {
      const result = await Access.search(f.ctx, {
        ...f.execution,
        serverId: f.serverId,
        query: '',
        limit: 25,
        cursor,
      })
      if (!('tools' in result)) throw new Error('Expected tool page')
      names.push(...(result.tools ?? []).map((tool) => tool.name))
      cursor = result.nextCursor ?? undefined
    } while (cursor)
    expect(new Set(names).size).toBe(250)
    const previous = await f.target()
    const next = await Catalogs.begin(f.ctx, { serverId: f.serverId })
    const refreshed = await refreshCatalog(f.action, next)
    expect(refreshed.catalogId).toBe(f.catalogId)
    expect(await f.target()).toEqual(previous)
    while (await Catalogs.expire(f.ctx, { catalogId: next })) {
      /* bounded cleanup pages */
    }
    expect(f.blobs.size).toBe(250)
  } finally {
    await f.close()
  }
}, 20_000)

test('published schemas stay pinned by frozen sessions and are reclaimed after cache release', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const input = await f.target()
    const row = (await f.db.get((await f.identity(input)).toolId))!
    const definitionRef = row.definitionRef as string
    const frozen = {
      names: ['local_tool_249'],
      mcp: [
        {
          name: 'local_tool_249',
          serverId: 'local',
          toolName: 'tool_249',
          definitionRef,
        },
      ],
    }
    const cacheId = await f.db.insert('sessionCache', {
      sessionId: f.sessionId,
      agentId: f.agentId,
      tools: frozen,
    })
    await pinManifest(f.ctx, cacheId as Id<'sessionCache'>, frozen)
    await f.sidecar.registry.call(
      f.status.scope,
      'tool_000',
      { changeCatalog: true },
      f.status,
    )
    const next = await Catalogs.begin(f.ctx, { serverId: f.serverId })
    await refreshCatalog(f.action, next, {
      scope: f.status.scope,
      bootId: f.status.bootId,
      generation: f.status.generation,
      expiresAt: Date.now() + 30_000,
    })
    expect(await Catalogs.expire(f.ctx, { catalogId: f.catalogId })).toBe(false)
    expect(f.blobs.has(definitionRef)).toBe(true)
    const direct = await createExternalMcpTool(
      frozen.mcp[0],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      { ctx: f.action, execution: f.execution, messageId: f.messageId },
    )
    expect(direct.inputSchema).toBeDefined()
    await releasePins(f.ctx, cacheId as Id<'sessionCache'>)
    await f.db.delete(cacheId)
    while (await Catalogs.expire(f.ctx, { catalogId: f.catalogId })) {
      /* bounded cleanup pages */
    }
    expect(f.blobs.has(definitionRef)).toBe(false)
    expect(await f.db.get(f.catalogId)).toBeNull()
    expect(f.blobs.size).toBe(251)
  } finally {
    await f.close()
  }
}, 20_000)

test('refresh/configuration races and pagination revisions cannot publish or reuse stale state', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const first = await Catalogs.page(f.ctx, {
      serverId: f.serverId,
      paginationOpts: { numItems: 20, cursor: null },
    })
    const pending = await Catalogs.begin(f.ctx, { serverId: f.serverId })
    await f.db.patch(f.serverId, { revision: 2 })
    await expect(
      Catalogs.publish(f.ctx, {
        catalogId: pending,
        count: 0,
        fingerprint: 'replacement',
      }),
    ).rejects.toThrow('configuration changed')
    await f.db.patch(f.serverId, { revision: 1, catalogId: pending })
    const changed = await Catalogs.page(f.ctx, {
      serverId: f.serverId,
      catalogId: f.catalogId,
      paginationOpts: { numItems: 20, cursor: first.continueCursor },
    })
    expect(changed.page).toEqual([])
    expect(changed.catalogId).toBe(pending)
    await f.db.patch(f.sessionId, {
      contextLock: `${Date.now() + 60_000}:transition`,
    })
    await expect(
      Access.search(f.ctx, { ...f.execution, query: '', limit: 10 }),
    ).rejects.toThrow('revoked')
  } finally {
    await f.close()
  }
}, 20_000)
