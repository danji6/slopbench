import {
  ProviderStreamFailure,
  consumeProviderStep,
} from '@sb/convex/actions/stream/engineStep'
import { STEP_DEADLINE_GRACE_MS } from '@sb/convex/actions/stream/engineWatchdog'
import { _getExecution } from '@sb/convex/model/mcp'
import {
  operationOutput,
  resumeOperations,
  settle,
  waitForOperation,
} from '@sb/convex/model/mcpOperationActions'
import { pending, reserve } from '@sb/convex/model/mcpOperations'
import { connected } from '@sb/convex/model/mcpRuntime'
import { _claim, _handoff } from '@sb/convex/model/stream/lifecycle'
import { createExternalMcpTool } from '@sb/convex/model/tool/mcp'
import { sidecarAuthentication } from '@sb/sidecar/auth'
import { mcpOperationRoutes } from '@sb/sidecar/mcp/external/operation-routes'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { mcpBackendFixture } from '../helpers/mcp-backend'

const originalFetch = globalThis.fetch
const fixtures: Awaited<ReturnType<typeof mcpBackendFixture>>[] = []
afterEach(async () => {
  globalThis.fetch = originalFetch
  for (const item of fixtures.splice(0)) await item.sidecar.close()
})

async function fixture(drop?: string) {
  const result = await mcpBackendFixture()
  fixtures.push(result)
  const app = new Hono()
  app.use('*', sidecarAuthentication(process.env.SIDECAR_SECRET))
  app.route(
    '/mcp-ext/operations',
    mcpOperationRoutes(() => result.sidecar.operations),
  )
  app.post('/mcp-ext/connect', (c) => c.json(result.status))
  let dropped = false
  let requests = 0
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input))
      requests++
      const response = await app.request(url.pathname, init)
      if (url.pathname.endsWith(`/${drop}`) && !dropped) {
        dropped = true
        throw new Error('Simulated HTTP response loss after dispatch')
      }
      return response
    },
    { preconnect: originalFetch.preconnect },
  )
  return { ...result, requestCount: () => requests }
}

function model(input: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({
            type: 'tool-call',
            toolCallId: 'call-one',
            toolName: 'local_work',
            input,
          })
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          })
          controller.close()
        },
      }),
    }),
  })
}

test('accelerated engine window detaches and resumes one invocation across a real stream handoff and lost start response', async () => {
  const f = await fixture('start')
  const dispatchFile = path.join(f.sidecar.root, 'dispatches')
  const input = JSON.stringify({
    delay: 650,
    progressInterval: 20,
    dispatchFile,
  })
  const live = () =>
    _getExecution(f.ctx, {
      ...f.execution,
      agentId: f.agentId,
      sessionId: f.sessionId,
      serverKey: 'local',
      toolName: 'work',
    })
  const tool = await createExternalMcpTool(
    {
      name: 'local_work',
      serverId: 'local',
      toolName: 'work',
      inputSchema: '{"type":"object"}',
    },
    [],
    live,
    (runtimeId, key, bootId, generation) =>
      connected(f.ctx, { runtimeId, key, bootId, generation }),
    async () => ({ mode: 'unrestricted' as const }),
    undefined,
    { ctx: f.action, execution: f.execution, messageId: f.messageId },
  )
  const setup = {
    output: { _id: f.messageId, role: 'assistant', parts: [] },
    stream: { sessionId: f.sessionId, invokedBy: 'owner' },
    agent: {},
    evalResult: {},
    resolved: { languageModel: model(input) },
    requestLog: {},
    messages: [{ role: 'user', content: 'Analyze the fixture' }],
    tools: { local_work: tool },
  } as unknown as Parameters<typeof consumeProviderStep>[2]
  let failure: unknown
  try {
    await consumeProviderStep(
      f.action,
      f.execution,
      setup,
      Date.now() - STEP_DEADLINE_GRACE_MS + 80,
    )
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(ProviderStreamFailure)
  expect((failure as ProviderStreamFailure).deadlineHit).toBe(true)
  const [operation] = await pending(f.ctx, f.execution)
  expect(operation.state).toBe('running')
  expect(
    ((await f.db.get(f.contentId))?.parts as Array<{ type: string }>).filter(
      (part) => part.type.startsWith('tool-'),
    ),
  ).toMatchObject([{ state: 'input-available', toolCallId: 'call-one' }])
  expect(await _handoff(f.ctx, f.execution)).toBe(true)
  const next = { ...f.execution, generation: 2 }
  expect(await _claim(f.ctx, next)).not.toBeNull()
  expect(await resumeOperations(f.action, next, Date.now() + 3000)).toBe(true)
  expect(await readFile(dispatchFile, 'utf8')).toBe('1\n')
  expect(
    ((await f.db.get(f.contentId))?.parts as Array<{ type: string }>).filter(
      (part) => part.type.startsWith('tool-'),
    ),
  ).toMatchObject([
    { state: 'output-available', output: expect.stringContaining('"count":1') },
  ])
  expect(await pending(f.ctx, next)).toEqual([])
}, 10_000)

test('lost result response preserves canonical output and serves completed backend retries', async () => {
  const f = await fixture('result')
  const text = 'retained evidence '.repeat(1000)
  const operation = await reserve(f.ctx, {
    ...f.args,
    args: JSON.stringify({ output: text }),
  })
  const result = await waitForOperation(f.action, f.execution, operation._id, {
    pollMs: 10,
    deadlineAt: Date.now() + 2000,
  })
  expect(result?.state).toBe('completed')
  expect(result?.outputRef).toBeDefined()
  expect(await operationOutput(f.action, result!)).toBe(text)
  const requests = f.requestCount()
  const replay = await waitForOperation(f.action, f.execution, operation._id)
  expect(await operationOutput(f.action, replay!)).toBe(text)
  expect(f.requestCount()).toBe(requests)
  expect(
    (
      await f.sidecar.operations.status({
        id: operation._id,
        scope: operation.scope,
      })
    )?.acknowledged,
  ).toBe(true)
}, 10_000)

test('Stop persists cancellation even with no watcher, including before dispatch', async () => {
  const f = await fixture()
  const operation = await reserve(f.ctx, f.args)
  const { stopExecution } = await import('@sb/convex/model/stream/stop')
  await stopExecution(f.ctx, (await f.ctx.db.get(f.execution.streamId))!)
  await settle(f.action, { operationId: operation._id })
  const status = await f.sidecar.operations.start({
    ...f.sidecar.input,
    id: operation._id,
    scope: operation.scope,
    bootId: operation.bootId,
    generation: operation.generation,
  })
  expect(status.state).toBe('cancelled')
}, 10_000)

test('sidecar boot loss produces a terminal unknown outcome without starting the toolkit again', async () => {
  const f = await fixture()
  const operation = await reserve(f.ctx, {
    ...f.args,
    bootId: 'boot-mismatch',
  }).catch(() => null)
  expect(operation).toBeNull()
  const actual = await reserve(f.ctx, f.args)
  await f.sidecar.registry.disconnect(actual.scope)
  const lost = await waitForOperation(f.action, f.execution, actual._id, {
    pollMs: 10,
    deadlineAt: Date.now() + 2000,
  })
  expect(lost?.state).toBe('lost')
  expect(lost?.error).toContain('unknown')
}, 10_000)

test('a lost acknowledgement response is retried from durable completion without another invocation', async () => {
  const f = await fixture('acknowledge')
  const operation = await reserve(f.ctx, f.args)
  const result = await waitForOperation(f.action, f.execution, operation._id, {
    pollMs: 10,
    deadlineAt: Date.now() + 2000,
  })
  expect(result?.state).toBe('completed')
  expect((await f.ctx.db.get(operation._id))?.acknowledged).toBe(false)
  expect(
    (
      await f.sidecar.operations.status({
        id: operation._id,
        scope: operation.scope,
      })
    )?.acknowledged,
  ).toBe(true)
  await settle(f.action, { operationId: operation._id })
  expect((await f.ctx.db.get(operation._id))?.acknowledged).toBe(true)
  expect(JSON.parse(await operationOutput(f.action, result!)).count).toBe(1)
}, 10_000)

test('Stop reaches an already dispatched tool without retaining its original watcher', async () => {
  const f = await fixture()
  const cancelFile = path.join(f.sidecar.root, 'cancelled')
  const dispatchFile = path.join(f.sidecar.root, 'dispatches')
  const operation = await reserve(f.ctx, {
    ...f.args,
    args: JSON.stringify({ delay: 1000, cancelFile, dispatchFile }),
  })
  const abort = new AbortController()
  const watcher = waitForOperation(f.action, f.execution, operation._id, {
    signal: abort.signal,
    pollMs: 10,
  })
  const { untilOperation } = await import('../helpers/mcp-operations')
  await untilOperation(
    async () =>
      (await readFile(dispatchFile, 'utf8').catch(() => '')) === '1\n',
  )
  abort.abort('watcher detached')
  expect(await watcher).toBeNull()
  const { stopExecution } = await import('@sb/convex/model/stream/stop')
  await stopExecution(f.ctx, (await f.ctx.db.get(f.execution.streamId))!)
  await settle(f.action, { operationId: operation._id })
  await untilOperation(
    async () =>
      (await readFile(cancelFile, 'utf8').catch(() => '')) === 'cancelled\n',
  )
  expect((await f.ctx.db.get(operation._id))?.state).toBe('cancelled')
}, 10_000)

test('the tool wrapper serves a completed retry after session loss without reconnecting or invoking again', async () => {
  const f = await fixture()
  const operation = await reserve(f.ctx, f.args)
  const result = await waitForOperation(f.action, f.execution, operation._id, {
    pollMs: 10,
    deadlineAt: Date.now() + 2000,
  })
  expect(result?.state).toBe('completed')
  await f.sidecar.registry.disconnect(operation.scope)
  const requests = f.requestCount()
  const tool = await createExternalMcpTool(
    {
      name: 'local_work',
      serverId: 'local',
      toolName: 'work',
      inputSchema: '{"type":"object"}',
    },
    [],
    async () => {
      throw new Error('Completed retry must not authorize a new connection')
    },
    undefined,
    undefined,
    undefined,
    { ctx: f.action, execution: f.execution, messageId: f.messageId },
  )
  if (typeof tool.needsApproval !== 'function')
    throw new Error('Expected MCP approval policy')
  expect(
    await tool.needsApproval(
      {},
      { toolCallId: 'call-one', messages: [], context: {} },
    ),
  ).toBe(false)
  await expect(
    tool.needsApproval(
      { changed: true },
      { toolCallId: 'call-one', messages: [], context: {} },
    ),
  ).rejects.toThrow('changed arguments')
  const output = await tool.execute!(
    {},
    { toolCallId: 'call-one', messages: [], context: {} },
  )
  expect(JSON.parse(output as string).count).toBe(1)
  expect(f.requestCount()).toBe(requests)
}, 10_000)

test('deleting an owning message reclaims its blobs and sidecar journal through durable cleanup', async () => {
  const f = await fixture()
  const operation = await reserve(f.ctx, {
    ...f.args,
    args: JSON.stringify({ output: 'large evidence '.repeat(1000) }),
  })
  expect(
    (
      await waitForOperation(f.action, f.execution, operation._id, {
        pollMs: 10,
        deadlineAt: Date.now() + 2000,
      })
    )?.outputRef,
  ).toBeDefined()
  const { deleteVersions } = await import('@sb/convex/model/messageContents')
  await deleteVersions(f.ctx, f.messageId)
  await settle(f.action, { operationId: operation._id })
  expect(await f.ctx.db.get(operation._id)).toBeNull()
  expect(f.blobs.size).toBe(0)
  expect((await f.sidecar.operations.list(null, 64)).items).toEqual([])
}, 10_000)
