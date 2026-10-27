import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { discoverMcpTools } from '@sb/convex/model/mcpDiscoveryAction'
import { afterEach, expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'

type Reference = Parameters<typeof getFunctionName>[0]
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const connection = {
  url: '',
  transport: 'stdio' as const,
  command: 'node',
  serverId: 'saved-server' as Id<'mcpServers'>,
}

function fixture(identity: boolean, role = 'admin', ownsServer = true) {
  const queries: string[] = []
  let fetched = false
  globalThis.fetch = Object.assign(
    async () => {
      fetched = true
      throw new Error('Unexpected sidecar request')
    },
    { preconnect: originalFetch.preconnect },
  )
  const ctx = {
    auth: {
      getUserIdentity: async () => (identity ? { subject: 'owner' } : null),
    },
    runQuery: async (reference: Reference) => {
      const name = getFunctionName(reference)
      queries.push(name)
      if (name === 'users:_getRoleBySubject') return role
      if (name === 'mcp:get' && !ownsServer) throw new Error('Not found')
      throw new Error(`Unexpected query ${name}`)
    },
  } as unknown as ActionCtx
  return { ctx, queries, fetched: () => fetched }
}

test('discovery rejects unauthenticated callers before querying or launching', async () => {
  const { ctx, queries, fetched } = fixture(false)
  await expect(discoverMcpTools(ctx, connection)).rejects.toThrow(
    'Unauthorized',
  )
  expect(queries).toEqual([])
  expect(fetched()).toBe(false)
})

test('local probes require admin authority before reading stored configuration', async () => {
  const { ctx, queries, fetched } = fixture(true, 'user')
  await expect(discoverMcpTools(ctx, connection)).rejects.toThrow('Forbidden')
  expect(queries).toEqual(['users:_getRoleBySubject'])
  expect(fetched()).toBe(false)
})

test('saved server ownership is checked before resolving credentials', async () => {
  const { ctx, queries, fetched } = fixture(true, 'admin', false)
  await expect(discoverMcpTools(ctx, connection)).rejects.toThrow('Not found')
  expect(queries).toEqual(['users:_getRoleBySubject', 'mcp:get'])
  expect(fetched()).toBe(false)
})
