import type { Id } from '@sb/convex/_generated/dataModel'
import { publish } from '@sb/convex/model/integrations/publication'
import { select } from '@sb/convex/model/integrations/selection'
import { _getExecution } from '@sb/convex/model/mcp'
import { connected } from '@sb/convex/model/mcpRuntime'
import { createMcpBrokerTools } from '@sb/convex/model/tool/mcpBroker'
import {
  inspectIntegration,
  integrationConnections,
} from '@sb/sidecar/integrations/manifest'
import { mcpCatalogRoutes } from '@sb/sidecar/mcp/external/catalog-routes'
import { CatalogSnapshots } from '@sb/sidecar/mcp/external/catalog-snapshots'
import { mcpOperationRoutes } from '@sb/sidecar/mcp/external/operation-routes'
import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { mcpBackendFixture } from '../helpers/mcp-backend'
import { mcpText } from '../helpers/mcp-result'

test('linked integration discovers 250 tools on its persistent workspace session and revokes dispatch on replacement', async () => {
  const f = await mcpBackendFixture(
    new URL('../mcp/fixtures/catalog.mjs', import.meta.url),
  )
  const original = globalThis.fetch
  const root = await mkdtemp(path.join(tmpdir(), 'sb-linked-runtime-'))
  const app = new Hono()
  app.onError((cause, c) => c.json({ error: cause.message }, 500))
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
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      app.fetch(new Request(input, init)),
    { preconnect: original.preconnect },
  )
  try {
    await f.db.patch('owner', { subject: 'owner' })
    await mkdir(path.join(root, '.agents'))
    const file = path.join(root, '.agents/integration.json')
    const fixture = fileURLToPath(
      new URL('../mcp/fixtures/catalog.mjs', import.meta.url),
    )
    await writeFile(
      file,
      JSON.stringify({
        name: 'Toolkit',
        mcpServers: {
          main: {
            command: process.execPath,
            args: ['--no-env-file', fixture],
            cwd: '${workspace}',
          },
        },
      }),
    )
    const snapshot = await inspectIntegration(root)
    const integrationId = await publish(f.ctx, {
      subject: 'owner',
      root,
      revision: snapshot.revision,
      manifest: JSON.stringify(snapshot.manifest),
      connections: integrationConnections(snapshot),
    })
    await select(f.ctx, { integrationId, agentId: f.agentId, enabled: true })
    const targetRoot = path.join(root, 'target')
    await mkdir(targetRoot)
    const folder = await f.db.insert('sessionFolders', {
      ownerId: 'owner',
      name: 'Target',
      revision: 1,
      sources: [{ id: 'target', path: targetRoot, label: 'Target' }],
    })
    await f.db.patch(f.sessionId, { folderId: folder })
    const serverId = f
      .rows('mcpServers')
      .find((row) => row.integrationId === integrationId)!
      ._id as Id<'mcpServers'>
    const broker = await createMcpBrokerTools({
      operation: {
        ctx: f.action,
        execution: f.execution,
        messageId: f.messageId,
      },
      current: (serverKey, toolName) =>
        _getExecution(f.ctx, {
          ...f.execution,
          sessionId: f.sessionId,
          agentId: f.agentId,
          serverKey,
          toolName,
        }),
      connected: (runtimeId, key, bootId, generation) =>
        connected(f.ctx, { runtimeId, key, bootId, generation }),
    })
    const options = { toolCallId: 'search', messages: [], context: {} }
    const search = (await broker.search_mcp_tools.execute!(
      { serverId, query: 'tool_249', limit: 10, offset: 0, length: 1000 },
      options,
    )) as { tools: { toolId: string }[] }
    expect(search.tools).toHaveLength(1)
    expect((await f.db.get(serverId))?.catalogCount).toBe(250)
    const target = { serverId, toolId: search.tools[0].toolId }
    const first = JSON.parse(
      mcpText(
        await broker.call_mcp_tool.execute!(
          { ...target, arguments: { value: 'retained evidence' } },
          { ...options, toolCallId: 'first' },
        ),
      ),
    )
    // A later call receives its own durable identity and the same persistent analysis process.
    const second = JSON.parse(
      mcpText(
        await broker.call_mcp_tool.execute!(
          { ...target, arguments: {} },
          { ...options, toolCallId: 'second' },
        ),
      ),
    )
    expect(second).toMatchObject({
      value: 'retained evidence',
      pid: first.pid,
      calls: 2,
    })
    await writeFile(file, JSON.stringify({ name: 'Replaced' }))
    await expect(
      broker.call_mcp_tool.execute!(
        { ...target, arguments: {} },
        { ...options, toolCallId: 'third' },
      ),
    ).rejects.toThrow('manifest changed')
    expect(
      f.sidecar.registry.list().filter((row) => row.scope.serverId !== 'local'),
    ).toHaveLength(0)
  } finally {
    globalThis.fetch = original
    await f.sidecar.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
