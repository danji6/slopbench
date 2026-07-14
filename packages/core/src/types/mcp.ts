import { z } from 'zod'

export const MCP_TRANSPORTS = ['sse', 'ws', 'http'] as const

export type McpTransport = (typeof MCP_TRANSPORTS)[number]

export const mcpTransportSchema = z.enum(MCP_TRANSPORTS)

export const SUPPORTED_MCP_TRANSPORTS = [
  { id: 'sse', label: 'SSE' },
  { id: 'ws', label: 'WebSocket' },
  { id: 'http', label: 'HTTP' },
] as const satisfies readonly { id: McpTransport; label: string }[]

/** A tool discovered from an external MCP server. */
export const mcpToolMetaSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  descriptionOverride: z.string().optional(), // user's custom description
  inputSchema: z.string().optional(), // kept raw to avoid Convex rejections
})

export const mcpServerSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  url: z.string().url(),
  transport: mcpTransportSchema,
  apiKey: z.string().optional(),
  enabled: z.boolean(),
  tools: z.array(mcpToolMetaSchema).optional(),
})

export type McpToolMeta = z.infer<typeof mcpToolMetaSchema>
export type McpServer = z.infer<typeof mcpServerSchema>

/** Connection details needed to reach an external MCP server. */
export type McpConnection = {
  url: string
  transport: McpTransport
  apiKey?: string
}

export function isMcpTransport(value: unknown): value is McpTransport {
  return (
    typeof value === 'string' && MCP_TRANSPORTS.includes(value as McpTransport)
  )
}

/** Sanitized name prefixed with its label. */
export function mcpToolName(server: { label: string }, tool: string): string {
  const suffix = tool.replace(/[^A-Za-z0-9_-]+/g, '_')
  const prefix = slugify(server.label)
  return prefix ? `${prefix}_${suffix}` : suffix
}

export function mcpToolDescription(tool: {
  description?: string
  descriptionOverride?: string
}): string | undefined {
  const override = tool.descriptionOverride?.trim()
  return override || tool.description
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
