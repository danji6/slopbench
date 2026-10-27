import type { Id } from '@sb/convex/_generated/dataModel'
import { _getExecution } from '@sb/convex/model/mcp'
import * as Named from '@sb/convex/model/mcpBrokerAccess'
import { approvalTarget } from '@sb/convex/model/mcpBrokerNames'
import { refreshCatalog } from '@sb/convex/model/mcpCatalogActions'
import * as Catalogs from '@sb/convex/model/mcpCatalogs'
import { connected } from '@sb/convex/model/mcpRuntime'
import { createMcpBrokerTools } from '@sb/convex/model/tool/mcpBroker'
import { mcpCatalogRoutes } from '@sb/sidecar/mcp/external/catalog-routes'
import { CatalogSnapshots } from '@sb/sidecar/mcp/external/catalog-snapshots'
import { mcpOperationRoutes } from '@sb/sidecar/mcp/external/operation-routes'
import { mock } from 'bun:test'
import { Hono } from 'hono'

import { mcpBackendFixture } from './mcp-backend'

export async function mcpCatalogBackend() {
  const f = await mcpBackendFixture(
    new URL('../mcp/fixtures/catalog.mjs', import.meta.url),
  )
  const serverId = f.rows('mcpServers')[0]._id as Id<'mcpServers'>
  await f.db.patch(serverId, { brokerEnabled: true })
  await f.db.patch(f.agentId, { tools: ['mcp_server:local'] })
  const app = new Hono()
  app.route(
    '/mcp-ext/catalog',
    mcpCatalogRoutes(f.sidecar.registry, new CatalogSnapshots()),
  )
  app.route(
    '/mcp-ext/operations',
    mcpOperationRoutes(() => f.sidecar.operations),
  )
  app.post('/mcp-ext/connect', async (c) => {
    const input = await c.req.json()
    return c.json(
      await f.sidecar.registry.connect(input.scope, input.connection, input),
    )
  })
  const original = globalThis.fetch
  globalThis.fetch = mock((input, init) =>
    app.fetch(new Request(input, init)),
  ) as unknown as typeof fetch
  const catalogId = await Catalogs.begin(f.ctx, { serverId })
  async function publish() {
    return refreshCatalog(f.action, catalogId)
  }
  const approvals: { tools: string[] } = { tools: [] }
  const broker = await createMcpBrokerTools({
    operation: {
      ctx: f.action,
      execution: f.execution,
      messageId: f.messageId,
    },
    current: (serverKey, toolName) =>
      _getExecution(f.ctx, {
        ...f.execution,
        agentId: f.agentId,
        sessionId: f.sessionId,
        serverKey,
        toolName,
      }),
    connected: (runtimeId, key, bootId, generation) =>
      connected(f.ctx, { runtimeId, key, bootId, generation }),
    approvals: async () => approvals,
  })
  const options = (toolCallId = 'broker-call') => ({
    toolCallId,
    messages: [],
    context: {},
  })
  async function target(name = 'tool_249') {
    await Named.servers(f.ctx, f.execution)
    const result = await Named.search(f.ctx, {
      ...f.execution,
      server: 'Local',
      query: name,
      limit: 10,
    })
    const row = 'tools' in result ? result.tools?.[0] : undefined
    if (!row) throw new Error('Missing target')
    return { tool: row.name, arguments: {} }
  }
  async function identity(input: unknown) {
    const result = await approvalTarget(f.ctx, f.sessionId, input)
    if (!result) throw new Error('Missing identity')
    return result
  }
  async function close() {
    globalThis.fetch = original
    await f.sidecar.close()
  }
  return {
    ...f,
    serverId,
    catalogId,
    publish,
    broker,
    approvals,
    target,
    identity,
    options,
    close,
  }
}
