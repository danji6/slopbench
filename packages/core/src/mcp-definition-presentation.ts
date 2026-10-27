import type { McpDefinition, McpDefinitionView } from './types/mcp-catalog'

export type McpPresentedDefinition = {
  name: string
  originalName: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  outputSchema?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

export type McpDefinitionPage = {
  name: string
  originalName: string
  catalogRevision: string
  view: McpDefinitionView
  diagnostic?: string
  inputSchemaComplete: boolean
  hasMore: boolean
  offset: number
  nextOffset: number | null
  totalCharacters: number
} & (
  | { definition: McpPresentedDefinition; text?: never }
  | { text: string; definition?: never }
)

/** Projects intact schemas without exposing the duplicated storage representation. */
export function presentMcpDefinition(
  definition: McpDefinition,
  name: string,
  view: McpDefinitionView,
): McpPresentedDefinition {
  const input = view === 'input' || view === 'full'
  const output = view === 'output' || view === 'full'
  const metadata = view === 'metadata' || view === 'full'

  return {
    name,
    originalName: definition.name,
    description: definition.description,
    ...(input ? { inputSchema: JSON.parse(definition.inputSchema) } : {}),
    ...(definition.annotations
      ? { annotations: JSON.parse(definition.annotations) }
      : {}),
    ...(output
      ? { outputSchema: parseOptionalSchema(definition.outputSchema) }
      : {}),
    ...(metadata ? { metadata: extraMetadata(definition) } : {}),
  }
}

function parseOptionalSchema(
  schema: string | undefined,
): Record<string, unknown> | null {
  return schema === undefined ? null : JSON.parse(schema)
}

function extraMetadata(definition: McpDefinition) {
  const {
    name: _name,
    description: _description,
    inputSchema: _input,
    outputSchema: _output,
    annotations: _annotations,
    ...metadata
  } = JSON.parse(definition.metadata)
  return metadata as Record<string, unknown>
}
