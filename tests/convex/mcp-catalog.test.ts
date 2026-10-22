import type { Id } from '@sb/convex/_generated/dataModel'
import { rememberApproval } from '@sb/convex/model/chat/approvalMemory'
import { replaceAll } from '@sb/convex/model/mcp'
import { _getExecution } from '@sb/convex/model/mcp'
import * as Access from '@sb/convex/model/mcpCatalogAccess'
import { refreshCatalog } from '@sb/convex/model/mcpCatalogActions'
import { pinManifest, releasePins } from '@sb/convex/model/mcpCatalogPins'
import * as Catalogs from '@sb/convex/model/mcpCatalogs'
import { reserve } from '@sb/convex/model/mcpOperations'
import { connected } from '@sb/convex/model/mcpRuntime'
import { prepareMcpContext } from '@sb/convex/model/stream/contextNotes'
import {
  resolveToolManifest,
  upgradeToolManifest,
} from '@sb/convex/model/tool/manifest'
import { createExternalMcpTool } from '@sb/convex/model/tool/mcp'
import { createMcpBrokerTools } from '@sb/convex/model/tool/mcpBroker'
import {
  MCP_BROKER_TOOLS,
  MCP_MANIFEST_VERSION,
  mcpApprovalKey,
} from '@sb/core/types/mcp-catalog'
import { mcpCatalogRoutes } from '@sb/sidecar/mcp/external/catalog-routes'
import { CatalogSnapshots } from '@sb/sidecar/mcp/external/catalog-snapshots'
import { mcpOperationRoutes } from '@sb/sidecar/mcp/external/operation-routes'
import { expect, mock, test } from 'bun:test'
import { Hono } from 'hono'

import { mcpBackendFixture } from '../helpers/mcp-backend'
import { mcpText } from '../helpers/mcp-result'

async function fixture() {
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
    const result = await Access.search(f.ctx, {
      ...f.execution,
      serverId,
      query: name,
      limit: 10,
    })
    const row = 'tools' in result ? result.tools?.[0] : undefined
    if (!row) throw new Error('Missing target')
    return { serverId, toolId: row.toolId, arguments: {} }
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
    options,
    close,
  }
}

test('250 tools publish atomically; a tool beyond 100 executes through the durable broker', async () => {
  const f = await fixture()
  try {
    expect((await f.db.get(f.serverId))?.catalogId).toBeUndefined()
    await f.publish()
    expect((await f.db.get(f.serverId))?.catalogCount).toBe(250)
    const input = {
      ...(await f.target()),
      arguments: { value: 'retained through broker' },
    }
    const result = await f.broker.call_mcp_tool.execute!(input, f.options())
    expect(JSON.parse(mcpText(result))).toMatchObject({
      name: 'tool_249',
      value: 'retained through broker',
      calls: 1,
    })
    expect(f.rows('mcpOperations')).toHaveLength(1)
    expect(f.rows('mcpOperations')[0].name).toBe('call_mcp_tool')
    expect(JSON.parse(String(f.rows('mcpOperations')[0].input))).toEqual(input)
    const duplicate = await f.broker.call_mcp_tool.execute!(input, f.options())
    expect(duplicate).toEqual(result)
    const next = await f.broker.call_mcp_tool.execute!(
      await f.target('tool_001'),
      f.options('later-turn'),
    )
    expect(JSON.parse(mcpText(next))).toMatchObject({
      value: 'retained through broker',
      calls: 2,
    })
  } finally {
    await f.close()
  }
}, 20_000)

test('large definitions round-trip in bounded ranges, including metadata and output schemas', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const input = await f.target()
    let offset = 0
    let text = ''
    for (;;) {
      const result = await f.broker.search_mcp_tools.execute!(
        { ...input, query: '', limit: 10, offset, length: 32_768 },
        f.options(),
      )
      if (!('text' in result)) throw new Error('Missing schema range')
      expect(result.text.length).toBeLessThanOrEqual(32_768)
      text += result.text
      if (result.nextOffset === null) break
      offset = result.nextOffset
    }
    const definition = JSON.parse(text)
    expect(
      JSON.parse(definition.inputSchema).properties.value.description,
    ).toBe('λ😀'.repeat(30_000))
    expect(JSON.parse(definition.metadata).title).toBe('Tool title 249')
    expect(JSON.parse(definition.outputSchema).type).toBe('object')
    expect(JSON.parse(definition.annotations).readOnlyHint).toBe(true)
    await expect(
      f.broker.call_mcp_tool.execute!(
        { ...input, arguments: { value: 42 } },
        f.options(),
      ),
    ).rejects.toThrow('arguments rejected')
    expect(f.rows('mcpOperations')).toHaveLength(0)
  } finally {
    await f.close()
  }
}, 20_000)

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

test('broker approvals are target-specific and never accept the generic broker grant', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const first = await f.target('tool_001')
    const second = await f.target('tool_002')
    const needs = f.broker.call_mcp_tool.needsApproval
    if (typeof needs !== 'function') throw new Error('Missing approval policy')
    expect(await needs(first, f.options())).toBe(true)
    f.approvals.tools = ['call_mcp_tool']
    expect(await needs(second, f.options())).toBe(true)
    f.approvals.tools = [mcpApprovalKey(first)!]
    expect(await needs(first, f.options())).toBe(false)
    expect(await needs(second, f.options())).toBe(true)
    await rememberApproval(
      f.ctx,
      { _id: f.sessionId } as never,
      { toolName: 'call_mcp_tool', input: first },
      'patterns',
    )
    const stored = f.rows('sessionState')[0].toolApprovals as {
      tools: string[]
    }
    expect(stored.tools).toContain(mcpApprovalKey(first)!)
    expect(stored.tools).not.toContain('call_mcp_tool')
  } finally {
    await f.close()
  }
}, 20_000)

test('aliases and duplicate names on different servers cannot redirect broker handles', async () => {
  const f = await fixture()
  try {
    await f.publish()
    await f.db.insert('mcpTools', {
      serverId: f.serverId,
      name: 'tool_249',
      nameOverride: 'same-alias',
      order: 0,
    })
    const result = await Access.search(f.ctx, {
      ...f.execution,
      serverId: f.serverId,
      query: 'same-alias',
      limit: 10,
    })
    expect('tools' in result && result.tools?.[0].name).toBe('tool_249')
    const input = await f.target()
    const foreign = await f.db.insert('mcpServers', {
      key: 'foreign',
      ownerId: 'other-owner',
      label: 'Foreign',
      url: '',
      transport: 'stdio',
      command: 'unavailable',
      enabled: true,
      order: 1,
    })
    await expect(
      Access.target(f.ctx, {
        ...f.execution,
        serverId: foreign as Id<'mcpServers'>,
        toolId: input.toolId,
      }),
    ).rejects.toThrow('unavailable')
    const restricted = await f.target('tool_001')
    await f.db.patch(f.agentId, { tools: ['local_same-alias'] })
    await expect(
      Access.target(f.ctx, { ...f.execution, ...restricted }),
    ).rejects.toThrow('restricted')
  } finally {
    await f.close()
  }
}, 20_000)

test('invalid schema diagnostics, disabled targets, stale cursors and live role changes are explicit', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const invalid = await Access.search(f.ctx, {
      ...f.execution,
      serverId: f.serverId,
      query: 'tool_017',
      limit: 10,
    })
    expect('tools' in invalid && invalid.tools?.[0].diagnostic).toContain(
      'Unsupported',
    )
    const input = await f.target('tool_001')
    await f.db.insert('mcpTools', {
      serverId: f.serverId,
      name: 'tool_001',
      enabled: false,
      order: 0,
    })
    await expect(
      Access.target(f.ctx, { ...f.execution, ...input }),
    ).rejects.toThrow('restricted')
    const page = await Access.search(f.ctx, {
      ...f.execution,
      serverId: f.serverId,
      query: '',
      limit: 2,
    })
    await f.db.patch(f.agentId, { tools: ['local_tool_002'] })
    await expect(
      Access.search(f.ctx, {
        ...f.execution,
        serverId: f.serverId,
        query: '',
        limit: 2,
        cursor: page.nextCursor!,
      }),
    ).rejects.toThrow('cursor')
    await f.db.patch('owner', { role: 'user' })
    await expect(
      Access.target(f.ctx, { ...f.execution, ...input }),
    ).rejects.toThrow('unavailable')
  } finally {
    await f.close()
  }
}, 20_000)

test('manifest upgrades add stable broker definitions without rewriting frozen direct tools', () => {
  const frozen = {
    names: ['local_original'],
    mcp: [
      {
        name: 'local_original',
        serverId: 'local',
        toolName: 'original',
        description: 'frozen',
        inputSchema: '{"type":"object"}',
      },
    ],
  }
  const upgraded = upgradeToolManifest(frozen)
  expect(upgraded.version).toBe(MCP_MANIFEST_VERSION)
  expect(upgraded.names).toEqual(['local_original', ...MCP_BROKER_TOOLS])
  expect(upgraded.mcp).toBe(frozen.mcp)
  expect(frozen.names).toEqual(['local_original'])
  expect(upgradeToolManifest(upgraded)).toBe(upgraded)
  const fresh = resolveToolManifest({
    agent: { tools: ['mcp_server:local'] },
    invoker: { role: 'admin' },
    session: {},
    resources: { settings: null, mcpServers: [] },
    spawnableAgents: [],
  } as never)
  expect(fresh.names).toEqual([...MCP_BROKER_TOOLS])
})

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
    expect((await f.target()).toolId).toBe(previous.toolId)
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
    const row = (await f.db.get(input.toolId))!
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

test('disabling broker access cancels a reserved operation before another dispatch', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const input = await f.target('tool_001')
    const operation = await reserve(f.ctx, {
      ...f.args,
      toolName: 'tool_001',
      name: 'call_mcp_tool',
      input: JSON.stringify(input),
      catalogToolId: input.toolId,
    })
    await replaceAll(f.ctx, {
      servers: [
        {
          key: 'local',
          label: 'Local',
          url: '',
          enabled: true,
          transport: 'stdio',
          command: f.sidecar.connection.command,
          args: f.sidecar.connection.args,
          brokerEnabled: false,
        },
      ],
    })
    expect((await f.db.get(operation._id))?.state).toBe('cancelled')
    await expect(
      f.broker.call_mcp_tool.execute!(input, f.options('another-target-call')),
    ).rejects.toThrow('unavailable')
    expect(f.rows('mcpOperations')).toHaveLength(1)
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

test('same-named tools on two authorized servers retain distinct handles, approvals and processes', async () => {
  const f = await fixture()
  try {
    await f.publish()
    const base = {
      label: 'Local',
      url: '',
      transport: 'stdio' as const,
      command: f.sidecar.connection.command,
      args: f.sidecar.connection.args,
      enabled: true,
      brokerEnabled: true,
    }
    await replaceAll(f.ctx, {
      servers: [
        { ...base, key: 'local' },
        { ...base, key: 'second' },
      ],
    })
    await f.db.patch(f.agentId, {
      tools: ['mcp_server:local', 'mcp_server:second'],
    })
    const serverId = f.rows('mcpServers').find((row) => row.key === 'second')!
      ._id as Id<'mcpServers'>
    const secondCatalog = await Catalogs.begin(f.ctx, { serverId })
    await refreshCatalog(f.action, secondCatalog)
    const page = await Access.search(f.ctx, {
      ...f.execution,
      serverId,
      query: 'tool_001',
      limit: 10,
    })
    if (!('tools' in page) || !page.tools?.[0])
      throw new Error('Missing second target')
    const first = {
      ...(await f.target('tool_001')),
      arguments: { value: 'first only' },
    }
    const second = { serverId, toolId: page.tools[0].toolId, arguments: {} }
    expect(second.toolId).not.toBe(first.toolId)
    f.approvals.tools = [mcpApprovalKey(first)!]
    const needs = f.broker.call_mcp_tool.needsApproval
    if (typeof needs !== 'function') throw new Error('Missing policy')
    expect(await needs(second, f.options())).toBe(true)
    const one = JSON.parse(
      mcpText(await f.broker.call_mcp_tool.execute!(first, f.options('one'))),
    )
    const two = JSON.parse(
      mcpText(await f.broker.call_mcp_tool.execute!(second, f.options('two'))),
    )
    expect(one.name).toBe('tool_001')
    expect(two.name).toBe('tool_001')
    expect(two.value).toBeNull()
    expect(one.pid).not.toBe(two.pid)
    await expect(
      Access.target(f.ctx, { ...f.execution, serverId, toolId: first.toolId }),
    ).rejects.toThrow('unavailable')
  } finally {
    await f.close()
  }
}, 30_000)

test('MCP context changes append immutable literal notes and stale generations cannot replace them', async () => {
  const f = await fixture()
  try {
    const first = {
      ...f.execution,
      fingerprint: 'catalog-one',
      content: 'Literal server label: {{ do_not_evaluate() }}',
    }
    expect(await prepareMcpContext(f.ctx, first)).toBe(true)
    expect(await prepareMcpContext(f.ctx, first)).toBe(true)
    expect(f.rows('messages').filter((row) => row.type === 'mcp')).toHaveLength(
      1,
    )
    await prepareMcpContext(f.ctx, {
      ...first,
      fingerprint: 'catalog-two',
      content: 'Server disabled',
    })
    const notes = f.rows('messages').filter((row) => row.type === 'mcp')
    expect(notes).toHaveLength(2)
    const oldParts = f
      .rows('messageContents')
      .find((row) => row.messageId === notes[0]._id)!.parts
    expect(JSON.stringify(oldParts)).toContain('{{ do_not_evaluate() }}')
    expect(await prepareMcpContext(f.ctx, { ...first, generation: 0 })).toBe(
      false,
    )
    expect(f.rows('messages').filter((row) => row.type === 'mcp')).toHaveLength(
      2,
    )
  } finally {
    await f.close()
  }
}, 20_000)
