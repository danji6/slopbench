import type { Id } from '@sb/convex/_generated/dataModel'
import { _getExecution } from '@sb/convex/model/mcp'
import { servers as namedServers } from '@sb/convex/model/mcpBrokerAccess'
import { outputAccess } from '@sb/convex/model/mcpOperationAccess'
import { operationOutput } from '@sb/convex/model/mcpOperationActions'
import { pending, reserve } from '@sb/convex/model/mcpOperations'
import { readMcpOutput } from '@sb/convex/model/mcpOutputActions'
import { connected } from '@sb/convex/model/mcpRuntime'
import { createMcpProtocolTools } from '@sb/convex/model/tool/mcpProtocol'
import { mcpProtocolApprovalKey } from '@sb/core/types/mcp-protocol'
import { mcpResultSchema } from '@sb/core/types/mcp-result'
import { mcpOperationRoutes } from '@sb/sidecar/mcp/external/operation-routes'
import { afterEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { mcpBackendFixture } from '~/tests/helpers/mcp-backend'

const originalFetch = globalThis.fetch
let active: Awaited<ReturnType<typeof mcpBackendFixture>> | undefined
afterEach(async () => {
  globalThis.fetch = originalFetch
  await active?.sidecar.close()
  active = undefined
})
async function fixture() {
  const f = (active = await mcpBackendFixture(
    new URL('../../fixtures/mcp/protocol.mjs', import.meta.url),
  ))
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
  const approvals = { tools: [] as string[] }
  const tools = await createMcpProtocolTools({
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
    connected: (runtimeId, key, bootId, generation, initialization) =>
      connected(f.ctx, { runtimeId, key, bootId, generation, initialization }),
    approvals: async () => approvals,
  })
  const serverId = f.rows('mcpServers')[0]._id as Id<'mcpServers'>
  await namedServers(f.ctx, f.execution)
  const input = {
    server: 'Local',
    method: 'get_prompt' as const,
    name: 'prompt-0',
    arguments: { target: 'one' },
  }
  const options = { toolCallId: 'protocol-call', messages: [], context: {} }
  return { ...f, tools, input, options, approvals, serverId }
}

test('protocol broker preserves literal prompt output and supports bounded retrieval without another dispatch', async () => {
  const f = await fixture()
  const output = mcpResultSchema.parse(
    await f.tools.mcp_protocol.execute!(f.input, f.options),
  )
  expect(output.result.messages).toEqual([
    {
      role: 'user',
      content: { type: 'text', text: 'Analyze one {{ literal }}' },
    },
  ])
  expect(f.rows('mcpOperations')).toHaveLength(1)
  expect(f.rows('mcpRuntimes')[0].initialization).toContain(
    '{{ DO_NOT_EVALUATE }}',
  )
  const operationId = f.rows('mcpOperations')[0]._id as Id<'mcpOperations'>
  const read = await readMcpOutput(f.action, f.execution, {
    output: output.origin.display!.output,
    offset: 0,
    length: 40,
  })
  expect(read.complete).toBe(false)
  expect(read.nextOffset).toBe(40)
  const full = await readMcpOutput(f.action, f.execution, {
    output: output.origin.display!.output,
    offset: 0,
    length: 32_768,
  })
  expect(JSON.parse(full.text).origin).toEqual({
    server: 'Local',
    name: 'get_prompt',
    output: 'output',
    untrusted: true,
  })
  expect(
    JSON.stringify(
      await operationOutput(
        f.action,
        await outputAccess(f.ctx, { ...f.execution, operationId }),
      ),
    ),
  ).toContain('Analyze one')
  expect(f.rows('mcpOperations')).toHaveLength(1)
  expect(await pending(f.ctx, f.execution)).toHaveLength(0)
})

test('protocol approvals bind exact server, method, prompt arguments and resource URI', async () => {
  const f = await fixture()
  const policy = f.tools.mcp_protocol.needsApproval
  if (typeof policy !== 'function') throw new Error('Expected approval policy')
  expect(await policy(f.input, f.options)).toBe(true)
  f.approvals.tools.push(mcpProtocolApprovalKey(f.input, f.serverId)!)
  expect(await policy(f.input, f.options)).toBe(false)
  expect(
    await policy({ ...f.input, arguments: { target: 'two' } }, f.options),
  ).toBe(true)
  expect(
    await policy(
      { server: 'Local', method: 'read_resource', uri: 'fixture://one' },
      f.options,
    ),
  ).toBe(true)
  await expect(
    policy({ ...f.input, server: 'foreign' }, f.options),
  ).rejects.toThrow('unavailable')
})

test('protocol-only selected servers work without granting unselected tools, and disable revokes access', async () => {
  const f = await fixture()
  await f.db.patch(f.agentId, { tools: ['mcp_server:local'] })
  await f.db.patch(f.serverId, { brokerEnabled: true })
  const result = mcpResultSchema.parse(
    await f.tools.mcp_protocol.execute!(
      {
        server: 'Local',
        method: 'read_resource',
        uri: 'fixture://target/42',
      },
      f.options,
    ),
  )
  expect(result.result.contents).toEqual([
    {
      uri: 'fixture://target/42',
      mimeType: 'text/plain',
      text: 'Scoped output at fixture://target/42',
    },
  ])
  await f.db.patch(f.serverId, { enabled: false })
  await expect(
    f.tools.mcp_protocol.execute!(f.input, {
      ...f.options,
      toolCallId: 'second',
    }),
  ).rejects.toThrow('unavailable')
})

test('full output cannot be read by a different session, child session, agent or execution generation', async () => {
  const f = await fixture()
  await f.tools.mcp_protocol.execute!(f.input, f.options)
  const operationId = f.rows('mcpOperations')[0]._id as Id<'mcpOperations'>
  await expect(
    outputAccess(f.ctx, { ...f.execution, generation: 2, operationId }),
  ).rejects.toThrow('no longer owns')
  for (const field of ['sessionId', 'agentId']) {
    const stream = (await f.db.get(f.execution.streamId))!
    const previous = stream[field]
    await f.db.patch(f.execution.streamId, { [field]: 'foreign' })
    await expect(
      outputAccess(f.ctx, { ...f.execution, operationId }),
    ).rejects.toThrow('another session or agent')
    await f.db.patch(f.execution.streamId, { [field]: previous })
  }
})

test('protocol reservation rejects mismatched methods instead of dispatching a hidden tool', async () => {
  const f = await fixture()
  await expect(
    reserve(f.ctx, {
      ...f.args,
      name: 'mcp_protocol',
      protocolMethod: 'get_prompt',
      toolName: 'work',
      args: '{"method":"get_prompt","name":"prompt-0"}',
    }),
  ).rejects.toThrow('identity changed')
  expect(f.rows('mcpOperations')).toHaveLength(0)
})

test('completed protocol retries serve full output after session loss without reconnecting', async () => {
  const f = await fixture()
  const first = await f.tools.mcp_protocol.execute!(f.input, f.options)
  const runtime = f.rows('mcpRuntimes')[0]
  await f.db.patch(runtime._id, { state: 'lost' })
  await f.sidecar.registry.disconnect(f.status.scope)
  const replay = await f.tools.mcp_protocol.execute!(f.input, f.options)
  expect(replay).toEqual(first)
  expect(f.rows('mcpOperations')).toHaveLength(1)
})

test('a same-named MCP tool restriction cannot change read-only protocol access', async () => {
  const f = await fixture()
  await f.db.insert('mcpTools', {
    serverId: f.serverId,
    name: 'get_prompt',
    allowInReadOnly: false,
    order: 1,
  })
  await f.db.patch(f.sessionId, { mode: 'plan' })
  const output = mcpResultSchema.parse(
    await f.tools.mcp_protocol.execute!(f.input, f.options),
  )
  expect(output.result.messages).toEqual([
    {
      role: 'user',
      content: { type: 'text', text: 'Analyze one {{ literal }}' },
    },
  ])
})
