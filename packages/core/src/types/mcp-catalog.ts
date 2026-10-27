import { z } from 'zod'

export const MCP_BROKER_TOOLS = [
  'search_mcp_tools',
  'call_mcp_tool',
  'mcp_protocol',
  'read_mcp_output',
] as const

export const SKILL_BROKER_TOOLS = ['list_skills', 'read_skill'] as const
export const MCP_MANIFEST_VERSION = 7
export const MAX_MCP_CATALOG_TOOLS = 5_000
export const MAX_MCP_CATALOG_BYTES = 64 * 1024 * 1024
export const MAX_MCP_DEFINITION_BYTES = 8 * 1024 * 1024
export const MCP_DEFINITION_CONTENT_TYPE = 'application/vnd.slopbench.mcp-definition+json' // prettier-ignore

export const mcpBrokerCallSchema = z.object({
  tool: z
    .string()
    .min(1)
    .max(1024)
    .describe(
      'Callable name returned by search_mcp_tools. Copy any numeric suffix exactly.',
    ),
  arguments: z.object({}).catchall(z.unknown()),
})

export const mcpDefinitionViewSchema = z.enum([
  'input',
  'output',
  'metadata',
  'full',
])
export type McpDefinitionView = z.infer<typeof mcpDefinitionViewSchema>

export const mcpBrokerSearchSchema = z.object({
  query: z
    .string()
    .max(200)
    .default('')
    .describe('Search text for server labels or tool names and descriptions.'),
  server: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe(
      'Server name returned by this tool. Provide to search its tools; omit to list servers.',
    ),
  tool: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe(
      'Callable tool name returned by this tool. Provide to read its definition instead of searching; copy any numeric suffix exactly.',
    ),
  view: mcpDefinitionViewSchema
    .default('input')
    .describe(
      'Definition view when tool is provided. Defaults to the complete input contract; output schemas and extra metadata are opt-in.',
    ),
  cursor: z
    .string()
    .max(4096)
    .optional()
    .describe(
      'nextCursor from a search result; keep server and query unchanged.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(10)
    .describe('Maximum servers or tools returned per search page.'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe(
      'Character offset in the selected definition; use nextOffset to continue.',
    ),
  length: z
    .number()
    .int()
    .min(1)
    .max(32_768)
    .default(16_384)
    .describe('Maximum characters returned per definition read.'),
})

export type McpBrokerCall = z.infer<typeof mcpBrokerCallSchema>

export type McpBrokerSearch = z.infer<typeof mcpBrokerSearchSchema>

/** Keeps complete protocol definitions separate from bounded catalog summaries. */
export const mcpDefinitionSchema = z.object({
  name: z.string().min(1).max(512),
  description: z.string().optional(),
  inputSchema: z.string(),
  outputSchema: z.string().optional(),
  annotations: z.string().optional(),
  metadata: z.string(),
  diagnostic: z.string().optional(),
})

export type McpDefinition = z.infer<typeof mcpDefinitionSchema>

export type McpCatalogSnapshot = {
  id: string
  count: number
  fingerprint: string
  transport?: string
  changeToken?: number
}

/** Server-wide broker selection is distinct from individual direct tool names. */
export function mcpServerSelection(server: { id: string }) {
  return `mcp_server:${server.id}`
}

/** Scopes remembered broker approvals to one immutable catalog target. */
export function mcpApprovalKey(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const { serverId, toolId } = input as Record<string, unknown>
  if (typeof serverId !== 'string' || typeof toolId !== 'string')
    return undefined
  return `mcp_target:${JSON.stringify([serverId, toolId])}`
}

/** Rejects missing or malformed schemas instead of inventing an empty schema. */
export function parseMcpInputSchema(raw: string | undefined) {
  if (!raw) throw new Error('MCP input schema is missing; refresh this catalog')
  const schema: unknown = JSON.parse(raw)
  const objectSchema =
    schema && typeof schema === 'object' && !Array.isArray(schema)
  if (!objectSchema || (schema as Record<string, unknown>).type !== 'object') {
    throw new Error('MCP input schema must describe an object')
  }
  return schema as Record<string, unknown>
}
