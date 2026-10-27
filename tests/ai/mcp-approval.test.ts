import { guardMcpApproval } from '@sb/convex/model/tool/mcpApproval'
import { type ToolExecutionOptions, tool } from 'ai'
import { expect, mock, test } from 'bun:test'
import { z } from 'zod'

const options = (toolCallId: string): ToolExecutionOptions<unknown> => ({
  toolCallId,
  messages: [],
  context: {},
})

test('approval failure remains a rejected call even if access recovers before execution', async () => {
  const execute = mock(async () => 'must not run')
  let unavailable = true
  const guarded = guardMcpApproval(
    tool({
      inputSchema: z.object({}),
      needsApproval: async () => {
        if (unavailable) throw new Error('MCP access revoked')
        return false
      },
      execute,
    }),
  )
  const gate = guarded.needsApproval
  if (typeof gate !== 'function') throw new Error('Missing approval gate')

  expect(await gate({}, options('failed'))).toBe(false)
  unavailable = false
  expect(await gate({}, options('failed'))).toBe(false)
  await expect(guarded.execute!({}, options('failed'))).rejects.toThrow(
    'MCP access revoked',
  )
  expect(execute).not.toHaveBeenCalled()
  expect(await gate({}, options('retry'))).toBe(false)
  expect(await guarded.execute!({}, options('retry'))).toBe('must not run')
  expect(execute).toHaveBeenCalledTimes(1)
})

test('concurrent approval failures stay bound to their own calls and do not suppress required approval', async () => {
  const execute = mock(async () => 'executed')
  const guarded = guardMcpApproval(
    tool({
      inputSchema: z.object({ fail: z.boolean() }),
      needsApproval: async (input, execution) => {
        if (input.fail) throw new Error(`Failed ${execution.toolCallId}`)
        return true
      },
      execute,
    }),
  )
  const gate = guarded.needsApproval
  if (typeof gate !== 'function') throw new Error('Missing approval gate')

  expect(
    await Promise.all([
      gate({ fail: true }, options('first')),
      gate({ fail: true }, options('second')),
      gate({ fail: false }, options('approval-required')),
    ]),
  ).toEqual([false, false, true])
  for (const id of ['first', 'second']) {
    await expect(guarded.execute!({ fail: true }, options(id))).rejects.toThrow(
      `Failed ${id}`,
    )
  }
  expect(execute).not.toHaveBeenCalled()
})
