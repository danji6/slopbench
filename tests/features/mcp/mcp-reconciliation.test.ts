import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { runtimeScope } from '@sb/convex/model/mcpRuntime'
import { reconcile } from '@sb/convex/model/mcpRuntimeActions'
import type { McpRuntimeStatus } from '@sb/core/types'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'

type Reference = Parameters<typeof getFunctionName>[0]
type Call = { name: string; args: Record<string, unknown> }
const originalFetch = globalThis.fetch
const originalSecret = process.env.SIDECAR_SECRET

beforeEach(() => {
  process.env.SIDECAR_SECRET = 'mcp-reconciliation-test'
})
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalSecret === undefined) delete process.env.SIDECAR_SECRET
  else process.env.SIDECAR_SECRET = originalSecret
})

function runtime(
  key: string,
  patch: Partial<Doc<'mcpRuntimes'>> = {},
): Doc<'mcpRuntimes'> {
  return {
    _id: key as Id<'mcpRuntimes'>,
    _creationTime: 0,
    ownerId: 'owner' as Id<'users'>,
    invokedBy: 'owner' as Id<'users'>,
    sessionId: 'session' as Id<'sessions'>,
    agentId: 'agent' as Id<'agents'>,
    serverKey: 'server',
    key,
    revision: '1',
    workspaceKey: '[]',
    state: 'connected',
    bootId: 'boot',
    updatedAt: 0,
    ...patch,
  }
}

function fixture(
  rows: Doc<'mcpRuntimes'>[],
  statuses: McpRuntimeStatus[],
  denied = new Set<string>(),
) {
  const mutations: Call[] = []
  const disconnected: string[] = []
  const queries: string[] = []
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/mcp-ext/runtimes')
      return Response.json({ bootId: 'boot', runtimes: statuses })
    if (path !== '/mcp-ext/disconnect')
      throw new Error(`Unexpected route ${path}`)
    disconnected.push(JSON.parse(String(init?.body)).scope.key)
    return Response.json({ ok: true })
  }) as typeof fetch
  const ctx = {
    runQuery: async (reference: Reference, args: Record<string, unknown>) => {
      const name = getFunctionName(reference)
      queries.push(name)
      if (name === 'mcp:_pendingCleanups') return []
      if (name === 'mcp:_runtimePage') {
        return {
          page: rows.filter((row) => row.state === args.state),
          isDone: true,
          continueCursor: '',
        }
      }
      if (name !== 'mcp:_inspectRuntime')
        throw new Error(`Unexpected query ${name}`)
      const key = (args.scope as { key: string }).key
      return denied.has(key) ? null : rows.find((row) => row.key === key)
    },
    runMutation: async (
      reference: Reference,
      args: Record<string, unknown>,
    ) => {
      mutations.push({ name: getFunctionName(reference), args })
    },
  } as unknown as ActionCtx
  return { ctx, mutations, disconnected, queries }
}

test('a missing snapshot entry leaves unstarted and newly acknowledged connections alone', async () => {
  const rows = [
    runtime('unstarted', { state: 'connecting', bootId: undefined }),
    runtime('new-ack', { updatedAt: Date.now() + 60_000 }),
    runtime('missing'),
  ]
  const { ctx, mutations } = fixture(rows, [])
  await reconcile(ctx)
  expect(mutations.map((call) => call.args.key)).toEqual(['missing'])
  expect(mutations[0].args.state).toBe('lost')
})

test('authorization revocation takes precedence over a stale snapshot exemption', async () => {
  const rows = [runtime('revoked', { bootId: undefined })]
  const { ctx, mutations } = fixture(rows, [], new Set(['revoked']))
  await reconcile(ctx)
  expect(mutations).toEqual([
    {
      name: 'mcp:_retireRuntime',
      args: {
        runtimeId: 'revoked',
        key: 'revoked',
        reason: 'MCP access or configuration changed',
      },
    },
  ])
})

test('sidecar replacement reports loss and orphan cleanup preserves known connections', async () => {
  const rows = [
    runtime('known'),
    runtime('old-boot', { bootId: 'previous-boot' }),
  ]
  const statuses = [...rows, runtime('orphan')].map(
    (row): McpRuntimeStatus => ({
      scope: runtimeScope(row),
      bootId: 'boot',
      generation: 'generation',
      state: 'connected',
      stderr: '',
    }),
  )
  const { ctx, mutations, disconnected } = fixture(rows, statuses)
  await reconcile(ctx)
  expect(mutations.map((call) => [call.args.key, call.args.state])).toEqual([
    ['known', 'connected'],
    ['old-boot', 'lost'],
  ])
  expect(disconnected).toEqual(['orphan'])
})
