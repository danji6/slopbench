import { mcpOperationTimeouts } from '@sb/core/types/mcp-operation'
import { McpOperations } from '@sb/sidecar/mcp/external/operation'
import { McpOperationStore } from '@sb/sidecar/mcp/external/operation-store'
import { McpRegistry } from '@sb/sidecar/mcp/external/registry'
import { afterEach, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { operationFixture, untilOperation } from '../helpers/mcp-operations'
import { mcpText } from '../helpers/mcp-result'

const fixtures: Awaited<ReturnType<typeof operationFixture>>[] = []
async function fixture() {
  const result = await operationFixture()
  fixtures.push(result)
  return result
}
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.close()
})

test('repeated and concurrent starts attach to one invocation; full result survives until ack', async () => {
  const { operations, input, store } = await fixture()
  input.args.delay = 60
  const statuses = await Promise.all(
    Array.from({ length: 8 }, () => operations.start(input)),
  )
  expect(statuses.every((status) => status.state === 'running')).toBe(true)
  await untilOperation(
    async () => (await operations.status(input))?.state === 'completed',
  )
  const output = JSON.parse(
    mcpText(JSON.parse((await operations.result(input)).toString())),
  )
  expect(output.count).toBe(1)
  expect(await store.result(input.id)).toEqual(await operations.result(input))
  await expect(
    operations.start({ ...input, args: { delay: 1 } }),
  ).rejects.toThrow('changed arguments')
  await operations.acknowledge(input)
  await expect(operations.result(input)).rejects.toThrow('unavailable')
  expect((await operations.start(input)).acknowledged).toBe(true)
})

test('progress includes a protocol token and resets inactivity without extending absolute duration', async () => {
  const { operations, input } = await fixture()
  input.args = { delay: 200, progressInterval: 15 }
  input.requestTimeoutMs = 100
  await operations.start(input)
  await untilOperation(async () => !!(await operations.status(input))?.progress)
  expect((await operations.status(input))?.progress?.total).toBeUndefined()
  expect((await operations.status(input))?.progress?.message).toBe(
    'Analyzing fixture',
  )
  await untilOperation(
    async () => (await operations.status(input))?.state === 'completed',
  )
  const output = JSON.parse(
    mcpText(JSON.parse((await operations.result(input)).toString())),
  )
  expect(output.token).toBeDefined()
  const second = {
    ...input,
    id: 'absolute',
    args: { delay: 1000, progressInterval: 15 },
    maxTotalTimeoutMs: 140,
    deadlineAt: Date.now() + 140,
  }
  await operations.start(second)
  await untilOperation(
    async () => (await operations.status(second))?.state === 'timedOut',
  )
  expect((await operations.status(second))?.error).toContain('absolute')
})

test('inactivity without progress cancels and closes the uncertain analysis session', async () => {
  const { operations, registry, input } = await fixture()
  await operations.start({
    ...input,
    args: { delay: 1000 },
    requestTimeoutMs: 100,
  })
  await untilOperation(
    async () => (await operations.status(input))?.state === 'timedOut',
  )
  expect((await operations.status(input))?.error).toContain('inactivity')
  await untilOperation(async () => registry.status(input.scope) === null)
})

test('cancellation reaches the server and late completion cannot overwrite it', async () => {
  const { operations, input, root, registry } = await fixture()
  const cancelFile = path.join(root, 'cancellations')
  const dispatchFile = path.join(root, 'dispatches')
  await operations.start({
    ...input,
    args: { delay: 300, ignoreCancel: true, cancelFile, dispatchFile },
  })
  await untilOperation(
    async () =>
      (await readFile(dispatchFile, 'utf8').catch(() => '')) === '1\n',
  )
  await operations.cancel(input)
  await untilOperation(
    async () =>
      (await readFile(cancelFile, 'utf8').catch(() => '')) === 'cancelled\n',
  )
  await untilOperation(async () => registry.status(input.scope) === null)
  expect((await operations.status(input))?.state).toBe('cancelled')
  await expect(operations.result(input)).rejects.toThrow('unavailable')
})

test('cancellation before start creates a durable tombstone and prevents delayed dispatch', async () => {
  const { operations, input, store, registry, limits } = await fixture()
  await operations.cancel(input)
  await operations.acknowledge(input)
  const reloaded = new McpOperations(registry, store, limits)
  expect((await reloaded.start(input)).state).toBe('cancelled')
  expect((await operations.start({ ...input, id: 'next' })).state).toBe(
    'running',
  )
  await untilOperation(
    async () =>
      (await operations.status({ ...input, id: 'next' }))?.state ===
      'completed',
  )
  expect(
    JSON.parse(
      mcpText(
        JSON.parse(
          (await operations.result({ ...input, id: 'next' })).toString(),
        ),
      ),
    ).count,
  ).toBe(1)
})

test('queued cancellation does not kill the active operation on the same connection', async () => {
  const { operations, input, registry } = await fixture()
  await operations.start({ ...input, args: { delay: 130 } })
  const queued = { ...input, id: 'queued' }
  await operations.start(queued)
  await operations.cancel(queued)
  await untilOperation(
    async () => (await operations.status(input))?.state === 'completed',
  )
  expect(registry.status(input.scope)?.state).toBe('connected')
  expect((await operations.status(queued))?.state).toBe('cancelled')
})

test('sidecar recovery marks journaled running work lost and never replays it', async () => {
  const { operations, input, registry, store, limits } = await fixture()
  await operations.start({ ...input, args: { delay: 500 } })
  await registry.close()
  await operations.drain()
  const [record] = await store.records()
  await store.save({ ...record, state: 'running' })
  const recovered = new McpOperations(registry, store, limits)
  const status = await recovered.start({ ...input, args: { delay: 500 } })
  expect(status.state).toBe('lost')
  expect(status.error).toContain('unknown')
})

test('boot mismatch and process crash are terminal lost outcomes', async () => {
  const { operations, input } = await fixture()
  expect((await operations.start({ ...input, bootId: 'old-boot' })).state).toBe(
    'lost',
  )
  const crash = { ...input, id: 'crash', args: { crash: true } }
  await operations.start(crash)
  await untilOperation(
    async () => (await operations.status(crash))?.state === 'lost',
  )
})

test('scope isolation, capacity errors and journal removal are explicit', async () => {
  const { registry, root, limits, input } = await fixture()
  const store = new McpOperationStore(path.join(root, 'bounded'))
  const operations = new McpOperations(registry, store, {
    ...limits,
    operations: 1,
  })
  await operations.start(input)
  await expect(
    operations.status({
      ...input,
      scope: { ...input.scope, sessionId: 'other' },
    }),
  ).rejects.toThrow('scope mismatch')
  await expect(operations.start({ ...input, id: 'overflow' })).rejects.toThrow(
    'capacity',
  )
  await untilOperation(
    async () => (await operations.status(input))?.state === 'completed',
  )
  await operations.acknowledge(input)
  await operations.forget(input)
  expect(await readdir(path.join(root, 'bounded'))).toEqual([])
})

test('oversize full output fails explicitly without returning a clipped result', async () => {
  const { registry, store, input, limits } = await fixture()
  const operations = new McpOperations(registry, store, {
    ...limits,
    maxResultBytes: 100,
  })
  await operations.start({ ...input, args: { output: 'x'.repeat(500) } })
  await untilOperation(
    async () => (await operations.status(input))?.state === 'failed',
  )
  expect((await operations.status(input))?.error).toContain(
    'full output could not be stored',
  )
})

test('remote absent settings retain legacy deadlines; local defaults allow long work', () => {
  expect(mcpOperationTimeouts({ transport: 'http' })).toEqual({
    requestTimeoutMs: 60_000,
    maxTotalTimeoutMs: 60_000,
  })
  expect(mcpOperationTimeouts({ transport: 'stdio' })).toEqual({
    requestTimeoutMs: 300_000,
    maxTotalTimeoutMs: 1_800_000,
  })
})

test('completed full output survives a sidecar boot change before acknowledgement', async () => {
  const { operations, input, store, registry, limits } = await fixture()
  await operations.start(input)
  await untilOperation(
    async () => (await operations.status(input))?.state === 'completed',
  )
  await registry.close()
  await operations.drain()
  const newRegistry = new McpRegistry()
  const recovered = new McpOperations(newRegistry, store, limits)
  expect((await recovered.start(input)).state).toBe('completed')
  expect(
    JSON.parse(mcpText(JSON.parse((await recovered.result(input)).toString())))
      .count,
  ).toBe(1)
  expect(newRegistry.list()).toEqual([])
  await recovered.acknowledge(input)
  await recovered.forget(input)
})

test('startup finishes an interrupted acknowledgement without retaining result bytes', async () => {
  const { operations, input, store, registry, limits } = await fixture()
  await operations.start(input)
  await untilOperation(
    async () => (await operations.status(input))?.state === 'completed',
  )
  await operations.drain()
  const [record] = await store.records()
  await store.save({ ...record, acknowledged: true })
  const recovered = new McpOperations(registry, store, limits)
  expect((await recovered.status(input))?.acknowledged).toBe(true)
  expect(await store.resultSize(input.id)).toBe(0)
})

test('journal pagination is stable when earlier entries are reclaimed between pages', async () => {
  const { operations, input } = await fixture()
  for (const id of ['a', 'b', 'c']) await operations.cancel({ ...input, id })
  const first = await operations.list(null, 1)
  expect(first.items[0].id).toBe('a')
  await operations.forget({ ...input, id: 'a' })
  const second = await operations.list(first.nextCursor, 1)
  expect(second.items[0].id).toBe('b')
  const third = await operations.list(second.nextCursor, 1)
  expect(third.items[0].id).toBe('c')
})
