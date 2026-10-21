import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

type Operation = Doc<'mcpOperations'>

/** Projects durable tool state over partial or stale SDK transcript patches. */
export function operationPart(operation: Operation, existing?: unknown) {
  const previous = existing && typeof existing === 'object' ? existing : {}
  const base = {
    ...previous,
    type: `tool-${operation.name}`,
    toolCallId: operation.toolCallId,
    input: JSON.parse(operation.input ?? operation.args),
    mcpOperationId: operation._id,
    mcpProgress: operation.progress,
    preliminary: undefined,
  }
  if (operation.state === 'running') {
    return {
      ...base,
      state: 'input-available',
      output: undefined,
      errorText: undefined,
    }
  }
  if (operation.state === 'completed') {
    return {
      ...base,
      state: 'output-available',
      output: operation.output,
      outputRef: operation.outputRef,
      errorText: undefined,
    }
  }
  return {
    ...base,
    state: 'output-error',
    errorText: operation.error ?? `MCP operation ${operation.state}`,
    output: undefined,
    outputRef: undefined,
  }
}

export async function mergeOperationParts(
  ctx: QueryCtx,
  contentId: Id<'messageContents'>,
  parts: unknown[],
) {
  const operations = await ctx.db
    .query('mcpOperations')
    .withIndex('by_contentId_toolCallId', (q) => q.eq('contentId', contentId))
    .collect()
  if (!operations.length) return parts

  const result = [...parts]

  for (const operation of operations) {
    const index = result.findIndex(
      (part) =>
        (part as { toolCallId?: string })?.toolCallId === operation.toolCallId,
    )
    const projected = operationPart(operation, result[index])
    if (index < 0) result.push(projected)
    else result[index] = projected
  }

  return result
}
