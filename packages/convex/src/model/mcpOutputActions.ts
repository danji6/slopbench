'use node'

import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { ToolError } from '../errors'
import type { StreamExecutionArgs } from '../types'
import { operationOutput } from './mcpOperationActions'

type ReadInput = { operationId: string; offset: number; length: number }

/** Reads full output without reconnecting or dispatching toolkit work. */
export async function readMcpOutput(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  input: ReadInput,
) {
  const operation = await ctx.runQuery(internal.mcpOperations._outputAccess, {
    ...execution,
    operationId: input.operationId as Id<'mcpOperations'>,
  })
  const output = await operationOutput(ctx, operation)
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  if (input.offset > text.length)
    throw new ToolError('MCP output offset is out of range')
  const end = Math.min(
    text.length,
    input.offset + Math.min(input.length, 32_768),
  )
  return {
    text: text.slice(input.offset, end),
    offset: input.offset,
    nextOffset: end < text.length ? end : null,
    totalCharacters: text.length,
    complete: input.offset === 0 && end === text.length,
  }
}
