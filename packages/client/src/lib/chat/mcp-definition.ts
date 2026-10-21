import { readTextPreview } from '@/lib/text-file-preview'
import {
  MAX_MCP_DEFINITION_BYTES,
  mcpDefinitionSchema,
} from '@sb/core/types/mcp-catalog'

/** Loads a complete stored definition and checks its catalog identity. */
export async function loadMcpDefinition(
  url: string,
  name: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const result = await readTextPreview(url, signal, MAX_MCP_DEFINITION_BYTES)
  signal.throwIfAborted()
  if (result.truncated) throw new Error('MCP tool definition is too large')
  const definition = mcpDefinitionSchema.safeParse(JSON.parse(result.text))
  if (!definition.success) throw new Error('Invalid MCP tool definition')
  if (definition.data.name !== name)
    throw new Error('MCP tool definition does not match this tool')
  return definition.data
}
