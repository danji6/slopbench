import {
  type McpDefinitionPage,
  presentMcpDefinition,
} from '@sb/core/mcp-definition-presentation'
import type { McpBrokerSearch } from '@sb/core/types/mcp-catalog'

import { internal } from '../../_generated/api'
import { ToolError } from '../../errors'
import type { createMcpDefinitionReader } from './mcpDefinition'
import type { McpOperationContext } from './mcpOperation'

type DefinitionReader = ReturnType<typeof createMcpDefinitionReader>

/** Returns a call-ready object, or explicit ranges of the selected view when large. */
export async function readMcpBrokerDefinition(
  operation: McpOperationContext,
  input: McpBrokerSearch,
  read: DefinitionReader,
) {
  const target = await operation.ctx.runQuery(internal.mcpBroker._target, {
    ...operation.execution,
    tool: input.tool!,
    forDefinition: true,
  })

  const definition = await read(target.tool)
  const presented = presentMcpDefinition(definition, input.tool!, input.view)
  const text = JSON.stringify(presented)
  const range = definitionRange(text, input)
  const includesInput = input.view === 'input' || input.view === 'full'

  const page: McpDefinitionPage = {
    name: input.tool!,
    originalName: definition.name,
    catalogRevision: target.catalogRevision,
    view: input.view,
    diagnostic: definition.diagnostic,
    inputSchemaComplete: includesInput && range.wholeDefinition,
    hasMore: range.end < text.length,
    offset: input.offset,
    nextOffset: range.end < text.length ? range.end : null,
    totalCharacters: text.length,
    ...(range.wholeDefinition
      ? { definition: presented }
      : { text: text.slice(input.offset, range.end) }),
  }

  // Convex reserves $-prefixed keys; the model converter sends this JSON verbatim
  return JSON.stringify(page)
}

function definitionRange(text: string, input: McpBrokerSearch) {
  if (input.offset > text.length)
    throw new ToolError('MCP definition offset is out of range')
  const end = Math.min(text.length, input.offset + input.length)
  return { end, wholeDefinition: input.offset === 0 && end === text.length }
}
