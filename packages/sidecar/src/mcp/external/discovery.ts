import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { mcpInputValidator } from '@sb/core/mcp-schema-validation'
import {
  MAX_MCP_CATALOG_BYTES,
  MAX_MCP_CATALOG_TOOLS,
  MAX_MCP_DEFINITION_BYTES,
  type McpDefinition,
} from '@sb/core/types/mcp-catalog'

/** Follows the complete cursor chain; a partial inventory is never published. */
export async function discoverTools(
  client: Client,
  signal = AbortSignal.timeout(60_000),
): Promise<McpDefinition[]> {
  if (!client.getServerCapabilities()?.tools) return []
  const tools: McpDefinition[] = []
  const cursors = new Set<string>()
  const names = new Set<string>()
  let cursor: string | undefined
  let bytes = 0

  for (let pageNumber = 0; pageNumber < 1_000; pageNumber++) {
    const page = await client.listTools(cursor ? { cursor } : undefined, { signal }) // prettier-ignore

    for (const tool of page.tools) {
      if (names.has(tool.name))
        throw new Error(`Duplicate MCP tool name: ${tool.name}`)
      names.add(tool.name)
      const definition = toolDefinition(tool)
      bytes += Buffer.byteLength(JSON.stringify(definition))
      const catalogCapacityExceeded =
        bytes > MAX_MCP_CATALOG_BYTES || tools.length >= MAX_MCP_CATALOG_TOOLS
      if (catalogCapacityExceeded) {
        throw new Error(
          'MCP catalog capacity exceeded; discovery is incomplete',
        )
      }
      tools.push(definition)
    }

    cursor = page.nextCursor
    if (cursor === undefined) {
      return tools
    }
    if (!cursor || cursors.has(cursor)) {
      throw new Error('MCP discovery returned an invalid or repeated cursor')
    }

    cursors.add(cursor)
  }

  throw new Error(
    'MCP discovery page capacity exceeded; discovery is incomplete',
  )
}

function toolDefinition(
  tool: Awaited<ReturnType<Client['listTools']>>['tools'][number],
): McpDefinition {
  const definition: McpDefinition = {
    name: tool.name,
    description: tool.description,
    inputSchema: JSON.stringify(tool.inputSchema),
    outputSchema: tool.outputSchema
      ? JSON.stringify(tool.outputSchema)
      : undefined,
    annotations: tool.annotations
      ? JSON.stringify(tool.annotations)
      : undefined,
    metadata: JSON.stringify(tool),
  }

  const oversized =
    Buffer.byteLength(JSON.stringify(definition)) > MAX_MCP_DEFINITION_BYTES

  if (oversized || tool.name.length > 512) {
    throw new Error(
      'MCP tool definition capacity exceeded; discovery is incomplete',
    )
  }

  definition.diagnostic =
    schemaDiagnostic(definition.inputSchema, 'input') ??
    schemaDiagnostic(definition.outputSchema, 'output')

  return definition
}

function schemaDiagnostic(raw: string | undefined, kind: 'input' | 'output') {
  if (!raw) return undefined
  try {
    mcpInputValidator(raw)
  } catch (error) {
    return `Unsupported MCP ${kind} schema: ${error instanceof Error ? error.message : String(error)}`.slice(
      0,
      2000,
    )
  }
}
