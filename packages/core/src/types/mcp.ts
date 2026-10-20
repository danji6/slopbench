import { z } from 'zod'

import {
  MAX_MCP_DESCRIPTION_CHARS,
  MAX_MCP_SCHEMA_CHARS,
  MAX_SERVER_MCP_TOOLS,
} from '../limits'

export const MCP_TRANSPORTS = ['auto', 'http', 'sse', 'ws', 'stdio'] as const

export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/** A transport that can be dialed when using `auto`. */
export type McpDialedTransport = Exclude<McpTransport, 'auto'>

export const mcpTransportSchema = z.enum(MCP_TRANSPORTS)

export const SUPPORTED_MCP_TRANSPORTS = [
  { id: 'stdio', label: 'Local process' },
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
  allowInReadOnly: z.boolean().optional(),
  nameOverride: z.string().optional(), // user's custom alias
  description: z.string().optional(),
  descriptionOverride: z.string().optional(), // user's custom description
  inputSchema: z.string().optional(), // kept raw to avoid Convex rejections
})

/** Optional local launch settings; credentials are resolved only on the server. */
export const mcpLaunchSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096))
    .optional(),
  secretEnv: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096))
    .optional(),
  startupTimeoutMs: z.number().int().min(100).max(300_000).optional(),
})

const connectionFields = mcpLaunchSchema.extend({
  url: z.string().default(''),
  apiKey: z.string().optional(),
})

export const mcpConnectionSchema = z.union([
  connectionFields.extend({
    transport: z.literal('stdio'),
    command: z.string().trim().min(1),
  }),
  connectionFields
    .extend({
      transport: z.enum(['auto', 'http', 'sse', 'ws']),
      url: z.string().url(),
    })
    .refine((connection) => isMcpUrl(connection.url, connection.transport), {
      message: 'URL scheme does not match the MCP transport',
      path: ['url'],
    }),
])

export const mcpServerSchema = connectionFields.extend({
  id: z.string(),
  label: z.string().min(1),
  transport: mcpTransportSchema,
  revision: z.number().optional(),
  enabled: z.boolean(),
  tools: z.array(mcpToolMetaSchema).optional(),
})

export type McpToolMeta = z.infer<typeof mcpToolMetaSchema>
export type McpServer = z.infer<typeof mcpServerSchema>
export type McpConnection = z.infer<typeof mcpConnectionSchema>

export type McpRuntimeScope = {
  epoch?: number
  key: string
  ownerId: string
  sessionId: string
  agentId: string
  serverId: string
  revision: string
}

export type McpRuntimeStatus = {
  scope: McpRuntimeScope
  bootId: string
  generation: string
  state: 'connecting' | 'connected' | 'closing' | 'closed' | 'lost'
  transport?: McpDialedTransport
  reason?: string
  stderr: string
}

/** Checks network schemes without excluding deliberately selected WebSockets. */
export function isMcpUrl(url: string, transport: McpTransport): boolean {
  try {
    const protocol = new URL(url).protocol
    return transport === 'ws'
      ? protocol === 'ws:' || protocol === 'wss:'
      : protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Trims discovered metadata to the storage caps. */
export function clampMcpTools(tools: McpToolMeta[]): McpToolMeta[] {
  return tools.slice(0, MAX_SERVER_MCP_TOOLS).map((tool) => ({
    name: tool.name.slice(0, MAX_MCP_DESCRIPTION_CHARS),
    allowInReadOnly: tool.allowInReadOnly,
    nameOverride: clamp(tool.nameOverride, MAX_MCP_DESCRIPTION_CHARS),
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

/** The user-facing alias, falling back to the name discovered from the server. */
export function mcpToolAlias(tool: {
  name: string
  nameOverride?: string
}): string {
  return tool.nameOverride?.trim() || tool.name
}

/** Sanitized user-facing name prefixed with its server label. */
export function mcpToolName(
  server: { label: string },
  tool: string | { name: string; nameOverride?: string },
): string {
  const value = typeof tool === 'string' ? tool : mcpToolAlias(tool)
  const suffix = value.replace(/[^A-Za-z0-9_-]+/g, '_')
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
