import { _getExecution } from '@sb/convex/model/mcp'
import { connected } from '@sb/convex/model/mcpRuntime'
import { createExternalMcpTool } from '@sb/convex/model/tool/mcp'
import { mcpOperationRoutes } from '@sb/sidecar/mcp/external/operation-routes'
import { afterEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { mcpBackendFixture } from '../helpers/mcp-backend'
import { mcpText } from '../helpers/mcp-result'

const originalFetch = globalThis.fetch
let current: Awaited<ReturnType<typeof mcpBackendFixture>> | undefined
afterEach(async () => {
  globalThis.fetch = originalFetch
  await current?.sidecar.close()
  current = undefined
})

async function fixture() {
  const f = (current = await mcpBackendFixture())
  const authorized = await _getExecution(f.ctx, {
    ...f.execution,
    agentId: f.agentId,
    sessionId: f.sessionId,
    serverKey: 'local',
    toolName: 'work',
  })
  if (!authorized) throw new Error('Missing authorization')
  let live: typeof authorized | null = authorized
  const app = new Hono()
  app.post('/mcp-ext/connect', (c) => c.json(f.status))
  app.route(
    '/mcp-ext/operations',
    mcpOperationRoutes(() => f.sidecar.operations),
  )
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      app.fetch(new Request(input, init)),
    { preconnect: originalFetch.preconnect },
  )
  const tool = await createExternalMcpTool(
    {
      name: 'local_work',
      serverId: 'local',
      toolName: 'work',
      inputSchema: '{"type":"object"}',
    },
    [],
    async () => live,
    (runtimeId, key, bootId, generation) =>
      connected(f.ctx, { runtimeId, key, bootId, generation }),
    undefined,
    undefined,
    { ctx: f.action, execution: f.execution, messageId: f.messageId },
  )
  let call = 0
  return {
    f,
    authorized,
    execute: () =>
      tool.execute!(
        {},
        { toolCallId: `call-${++call}`, messages: [], context: {} },
      ),
    set: (value: typeof live) => {
      live = value
    },
  }
}

test('read-only mode allows tools without an explicit permission setting', async () => {
  const { execute, set, authorized, f } = await fixture()
  set({ ...authorized, readOnly: true })
  expect(JSON.parse(mcpText(await execute())).count).toBe(1)
  expect(f.rows('mcpOperations')).toHaveLength(1)
})

test('normal mode permits opted-out tools; a live mode change denies them', async () => {
  const { execute, set, authorized, f } = await fixture()
  const server = {
    ...authorized.server,
    tools: [{ name: 'work', allowInReadOnly: false }],
  }
  set({ ...authorized, server, readOnly: false })
  expect(JSON.parse(mcpText(await execute())).count).toBe(1)
  set({ ...authorized, server, readOnly: true })
  await expect(execute()).rejects.toThrow('not allowed in read-only mode')
  expect(f.rows('mcpOperations')).toHaveLength(1)
})

test('read-only permission is checked again on every invocation', async () => {
  const { execute, set, authorized, f } = await fixture()
  set({
    ...authorized,
    server: {
      ...authorized.server,
      tools: [{ name: 'work', allowInReadOnly: true }],
    },
    readOnly: true,
  })
  expect(JSON.parse(mcpText(await execute())).count).toBe(1)
  set({
    ...authorized,
    server: {
      ...authorized.server,
      tools: [{ name: 'work', allowInReadOnly: false }],
    },
    readOnly: true,
  })
  await expect(execute()).rejects.toThrow('not allowed in read-only mode')
  expect(f.rows('mcpOperations')).toHaveLength(1)
})

test('removed servers and tools cannot execute through a cached manifest', async () => {
  const { execute, set, authorized, f } = await fixture()
  set(null)
  await expect(execute()).rejects.toThrow('no longer configured')
  set({ ...authorized, server: { ...authorized.server, tools: [] } })
  await expect(execute()).rejects.toThrow('no longer configured')
  expect(f.rows('mcpOperations')).toHaveLength(0)
})
