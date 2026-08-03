import { z } from 'zod'

import {
  MAX_MCP_DESCRIPTION_CHARS,
  MAX_MCP_SCHEMA_CHARS,
  MAX_SERVER_MCP_TOOLS,
} from '../limits'

export const MCP_TRANSPORTS = ['auto', 'http', 'sse', 'ws'] as const

export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/** A transport that can be dialed when using `auto`. */
export type McpDialedTransport = Exclude<McpTransport, 'auto'>

export const mcpTransportSchema = z.enum(MCP_TRANSPORTS)

export const SUPPORTED_MCP_TRANSPORTS = [
  { id: 'auto', label: 'Auto' },
  { id: 'http', label: 'HTTP' },
  { id: 'sse', label: 'SSE' },
  { id: 'ws', label: 'WebSocket' },
] as const satisfies readonly { id: McpTransport; label: string }[]

/**
 * Streamable HTTP first since SSE is getting deprecated. WebSocket stays a
 * deliberate user choice.
 */
const AUTO_TRANSPORTS = [
  'http',
  'sse',
] as const satisfies readonly McpDialedTransport[]

/** Transports to try in order for a configured transport preference. */
export function mcpTransportCandidates(
  transport: McpTransport,
): readonly McpDialedTransport[] {
  return transport === 'auto' ? AUTO_TRANSPORTS : [transport]
}

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

/** Trims discovered metadata to the storage caps. */
export function clampMcpTools(tools: McpToolMeta[]): McpToolMeta[] {
  return tools.slice(0, MAX_SERVER_MCP_TOOLS).map((tool) => ({
    name: tool.name.slice(0, MAX_MCP_DESCRIPTION_CHARS),
    description: clamp(tool.description, MAX_MCP_DESCRIPTION_CHARS),
    descriptionOverride: clamp(
      tool.descriptionOverride,
      MAX_MCP_DESCRIPTION_CHARS,
    ),
    inputSchema: clamp(tool.inputSchema, MAX_MCP_SCHEMA_CHARS),
  }))
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

function clamp(value: string | undefined, max: number) {
  return value === undefined ? undefined : value.slice(0, max)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
