import type { McpResult } from '@sb/core/types/mcp-result'

import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import type { McpOperationExecutionArgs } from '../types'

/** Validates output before completion, including resumed calls. */
export async function outputValidationError(
  ctx: ActionCtx,
  execution: McpOperationExecutionArgs,
  output: McpResult,
) {
  const reference = await ctx.runQuery(
    internal.mcpOperations._outputDefinition,
    execution,
  )
  if (!reference) return undefined

  const { loadMcpDefinition } = await import('./tool/mcpDefinition')
  const definition = await loadMcpDefinition(ctx, reference, {
    streamId: execution.streamId,
    generation: execution.generation,
  })
  if (!definition.outputSchema) return undefined

  const { mcpInputValidator } = await import('@sb/core/mcp-schema-validation')
  const validate = mcpInputValidator(definition.outputSchema)
  const structured = output.result.structuredContent
  if (!structured && output.result.isError) return undefined
  const result = structured ? validate(structured) : undefined
  if (result?.valid) return undefined

  const reason =
    result?.errorMessage ??
    'The tool did not return required structured content'
  const name = output.origin.display?.output
  const retrieval = name ? ` Full result retained as output "${name}".` : ''

  return `MCP output rejected: ${reason.slice(0, 2000)}.${retrieval}`
}
