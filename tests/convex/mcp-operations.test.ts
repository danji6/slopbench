import {
  acknowledged,
  allowed,
  cancelForStream,
  deliver,
  get,
  observe,
  pending,
  removeForMessage,
  reserve,
} from '@sb/convex/model/mcpOperations'
import { revoke } from '@sb/convex/model/mcpRuntime'
import { _patchMessage } from '@sb/convex/model/stream/lifecycle'
import { afterEach, expect, test } from 'bun:test'

import { mcpBackendFixture } from '../helpers/mcp-backend'

const fixtures: Awaited<ReturnType<typeof mcpBackendFixture>>[] = []
async function fixture() {
  const result = await mcpBackendFixture()
  fixtures.push(result)
  return result
}
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.sidecar.close()
})

test('reservation checkpoints input before dispatch and deduplicates unchanged call identity', async () => {
  const { ctx, args, db, contentId, rows } = await fixture()
  const first = await reserve(ctx, args)
  expect((await db.get(contentId))?.parts).toMatchObject([
    {
      type: 'tool-local_work',
      state: 'input-available',
      toolCallId: args.toolCallId,
      mcpOperationId: first._id,
    },
  ])
  expect((await reserve(ctx, args))._id).toBe(first._id)
  expect(rows('mcpOperations')).toHaveLength(1)
  await expect(
    reserve(ctx, { ...args, args: '{"changed":true}' }),
  ).rejects.toThrow('changed arguments')
})

test('execution generation changes allow waiting with the same operation but fence stale watchers', async () => {
  const { ctx, args, db, execution } = await fixture()
  const operation = await reserve(ctx, args)
  await db.patch(execution.streamId, { generation: 2 })
  await expect(
    get(ctx, { ...execution, operationId: operation._id }),
  ).rejects.toThrow('no longer owns')
  expect(
    (
      await get(ctx, {
        ...execution,
        generation: 2,
        operationId: operation._id,
      })
    )._id,
  ).toBe(operation._id)
  expect(await pending(ctx, { ...execution, generation: 2 })).toHaveLength(1)
})

test('SDK error or stale patch cannot replace durable pending input and progress', async () => {
  const { ctx, args, db, contentId, execution } = await fixture()
  const operation = await reserve(ctx, args)
  await observe(ctx, {
    ...execution,
    operationId: operation._id,
    state: 'running',
    progress: { progress: 4, message: 'Reading output' },
  })
  await _patchMessage(ctx, {
    ...execution,
    parts: [
      {
        type: 'tool-local_work',
        toolCallId: args.toolCallId,
        state: 'output-error',
        errorText: 'Watcher detached',
      },
    ],
  })
  expect((await db.get(contentId))?.parts).toMatchObject([
    {
      state: 'input-available',
      mcpProgress: { progress: 4, message: 'Reading output' },
    },
  ])
})

test.each(['cancel', 'disable'] as const)(
  'late completed results cannot overwrite %s',
  async (action) => {
    const { ctx, args, execution, db, contentId } = await fixture()
    const operation = await reserve(ctx, args)
    if (action === 'cancel')
      await cancelForStream(ctx, execution.streamId, 'Stop')
    else await revoke(ctx, { sessionId: operation.sessionId }, 'Disabled')
    const result = await observe(ctx, {
      ...execution,
      operationId: operation._id,
      state: 'completed',
      output: 'late success',
    })
    expect(result.state).toBe('cancelled')
    expect((await db.get(contentId))?.parts).toMatchObject([
      { state: 'output-error' },
    ])
  },
)

test('completed backend results survive retries and are projected before provider continuation', async () => {
  const { ctx, args, execution, db, contentId } = await fixture()
  const operation = await reserve(ctx, args)
  await observe(ctx, {
    ...execution,
    operationId: operation._id,
    state: 'completed',
    output: 'full output',
  })
  await deliver(ctx, { ...execution, operationId: operation._id })
  expect(await pending(ctx, execution)).toEqual([])
  await _patchMessage(ctx, { ...execution, parts: [] })
  expect((await db.get(contentId))?.parts).toMatchObject([
    { state: 'output-available', output: 'full output' },
  ])
})

test('tool-specific revocation is checked even when another tool on the server remains available', async () => {
  const { ctx, args, execution, rows, db, agentId } = await fixture()
  const operation = await reserve(ctx, args)
  const server = rows('mcpServers')[0]
  await db.insert('mcpTools', { serverId: server._id, name: 'other', order: 1 })
  await db.patch(agentId, { tools: ['local_other'] })
  expect(await allowed(ctx, { ...execution, operationId: operation._id })).toBe(
    'revoked',
  )
  expect(
    (
      await observe(ctx, {
        ...execution,
        operationId: operation._id,
        state: 'completed',
        output: 'late',
      })
    ).state,
  ).toBe('cancelled')
})

test('plan-mode changes revoke an opted-out target while it is running', async () => {
  const { ctx, args, execution, rows, db, sessionId } = await fixture()
  const operation = await reserve(ctx, args)
  await db.patch(rows('mcpTools')[0]._id, { allowInReadOnly: false })
  await db.patch(sessionId, { mode: 'plan' })
  expect(await allowed(ctx, { ...execution, operationId: operation._id })).toBe(
    'revoked',
  )
})

test('a late acknowledgement cannot hide deleted-owner cleanup', async () => {
  const { ctx, args, execution } = await fixture()
  const operation = await reserve(ctx, args)
  await observe(ctx, {
    ...execution,
    operationId: operation._id,
    state: 'completed',
    output: 'output',
  })
  await removeForMessage(ctx, operation.messageId)
  await acknowledged(ctx, { operationId: operation._id })
  expect((await ctx.db.get(operation._id))?.acknowledged).toBe(false)
  expect((await ctx.db.get(operation._id))?.deleted).toBe(true)
})
