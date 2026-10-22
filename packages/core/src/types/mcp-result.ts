import { z } from 'zod'

export const MAX_MCP_RESULT_BYTES = 32 * 1024 * 1024

/** Retains protocol extension fields without interpreting server supplied data. */
export const mcpContentSchema = z.looseObject({ type: z.string() })

export const mcpResultSchema = z.object({
  kind: z.literal('mcp-result'),
  version: z.literal(1),
  result: z.looseObject({
    content: z.array(mcpContentSchema),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    isError: z.boolean().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
  origin: z.object({
    serverId: z.string(),
    name: z.string(),
    generation: z.string().optional(),
    operationId: z.string().optional(),
    untrusted: z.literal(true),
  }),
})

export type McpResult = z.infer<typeof mcpResultSchema>

export type McpContent = z.infer<typeof mcpContentSchema>

/** Wraps full SDK output, including tool errors and future content blocks. */
export function mcpResult(
  result: unknown,
  origin: Omit<McpResult['origin'], 'untrusted'>,
): McpResult {
  const envelope = mcpResultSchema.parse({
    kind: 'mcp-result',
    version: 1,
    result,
    origin: { ...origin, untrusted: true },
  })
  const bytes = new TextEncoder().encode(JSON.stringify(envelope)).byteLength
  if (bytes > MAX_MCP_RESULT_BYTES)
    throw new Error(
      'Full MCP result exceeds the 32 MiB capacity; output was not truncated',
    )
  return envelope
}

export function isMcpResult(value: unknown): value is McpResult {
  return mcpResultSchema.safeParse(value).success
}

/** Decodes stored envelopes while retaining existing text-only transcript output. */
export function decodeMcpOutput(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value)
    return isMcpResult(parsed) || isMcpResultPreview(parsed) ? parsed : value
  } catch {
    return value
  }
}

/** Replaces large results with an explicitly incomplete preview. */
export function mcpResultPreview(output: McpResult) {
  return {
    kind: 'mcp-result-preview',
    version: 1,
    origin: output.origin,
    isError: output.result.isError,
    contentTypes: [
      ...new Set(output.result.content.map((part) => part.type)),
    ].slice(0, 16),
    contentBlocks: output.result.content.length,
    text: 'Full MCP output is stored separately. Load the full output to inspect it.',
  }
}

export function isMcpResultPreview(
  value: unknown,
): value is ReturnType<typeof mcpResultPreview> {
  return (
    !!value &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'mcp-result-preview'
  )
}

/** Projects protocol resources/messages into blocks without changing stored output. */
export function mcpResultBlocks(result: McpResult['result']): McpContent[] {
  const blocks = [...result.content]
  if (Array.isArray(result.contents)) {
    for (const resource of result.contents)
      blocks.push({ type: 'resource', resource })
  }
  if (Array.isArray(result.messages)) {
    for (const message of result.messages) {
      if (!message || typeof message !== 'object') continue
      blocks.push({
        type: 'text',
        text: `Prompt message role (literal server data): ${String(message.role)}`,
      })
      const parsed = mcpContentSchema.safeParse(message.content)
      if (parsed.success) blocks.push(parsed.data)
    }
  }
  return blocks
}
