import type { Id } from '@sb/convex/_generated/dataModel'
import { publish } from '@sb/convex/model/integrations/publication'
import { select } from '@sb/convex/model/integrations/selection'
import { _getExecution } from '@sb/convex/model/mcp'
import { connected } from '@sb/convex/model/mcpRuntime'
import { createMcpBrokerTools } from '@sb/convex/model/tool/mcpBroker'
import type { McpBrokerContext } from '@sb/convex/model/tool/mcpBroker'
import { createMcpProtocolTools } from '@sb/convex/model/tool/mcpProtocol'
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

test('linked integration uses 250 tools without per-call approval and rechecks live access', async () => {
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
    const context: McpBrokerContext = {
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
    }
    const broker = await createMcpBrokerTools(context)
    const protocol = await createMcpProtocolTools(context)
    const needsToolApproval = broker.call_mcp_tool.needsApproval
    const needsProtocolApproval = protocol.mcp_protocol.needsApproval
    if (typeof needsToolApproval !== 'function')
      throw new Error('Missing tool approval policy')
    if (typeof needsProtocolApproval !== 'function')
      throw new Error('Missing protocol approval policy')
    const options = { toolCallId: 'search', messages: [], context: {} }
    const servers = (await broker.search_mcp_tools.execute!(
      { query: '', view: 'input', limit: 25, offset: 0, length: 1000 },
      options,
    )) as { servers: { name: string }[] }
    const server = servers.servers.find((row) => row.name !== 'Local')!.name
    const search = (await broker.search_mcp_tools.execute!(
      {
        server,
        query: 'tool_249',
        view: 'input',
        limit: 10,
        offset: 0,
        length: 1000,
      },
      options,
    )) as { tools: { name: string }[] }
    expect(search.tools).toHaveLength(1)
    expect((await f.db.get(serverId))?.catalogCount).toBe(250)
    const target = { tool: search.tools[0].name }
    expect(await needsToolApproval({ ...target, arguments: {} }, options)).toBe(
      false,
    )
    expect(
      await needsToolApproval(
        { ...target, arguments: { value: 'retained evidence' } },
        options,
      ),
    ).toBe(false)
    const prompt = { server, method: 'get_prompt' as const, name: 'analyze' }
    expect(await needsProtocolApproval(prompt, options)).toBe(false)
    expect(
      await needsProtocolApproval(
        { server, method: 'read_resource', uri: 'fixture://evidence' },
        options,
      ),
    ).toBe(false)
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
    const restriction = await f.db.insert('mcpTools', {
      serverId,
      name: 'tool_249',
      order: 0,
      enabled: false,
      allowInReadOnly: false,
    })
    const input = { ...target, arguments: {} }
    const nextCall = { ...options, toolCallId: 'restricted-call' }
    await expect(needsToolApproval(input, nextCall)).rejects.toThrow(
      'restricted',
    )
    await f.db.patch(restriction, { enabled: true })
    await f.db.patch(f.sessionId, { mode: 'plan' })
    await expect(
      broker.call_mcp_tool.execute!(input, nextCall),
    ).rejects.toThrow('not allowed in read-only mode')
    await f.db.patch(f.sessionId, { mode: 'normal' })
    await f.db.patch('owner', { role: 'user' })
    await expect(needsToolApproval(input, nextCall)).rejects.toThrow(
      'unavailable',
    )
    await expect(needsProtocolApproval(prompt, nextCall)).rejects.toThrow(
      'unavailable',
    )
    expect(f.rows('mcpOperations')).toHaveLength(2)
    await f.db.patch('owner', { role: 'admin' })
    await f.db.patch(f.agentId, { integrationIds: [] })
    await expect(needsToolApproval(input, nextCall)).rejects.toThrow(
      'unavailable',
    )
    await expect(needsProtocolApproval(prompt, nextCall)).rejects.toThrow(
      'unavailable',
    )
    await expect(
      broker.call_mcp_tool.execute!(input, nextCall),
    ).rejects.toThrow('unavailable')
    await expect(
      protocol.mcp_protocol.execute!(prompt, nextCall),
    ).rejects.toThrow('unavailable')
    expect(f.rows('mcpOperations')).toHaveLength(2)
    await f.db.patch(f.agentId, { integrationIds: [integrationId] })
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
