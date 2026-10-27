import { z } from 'zod'

import type { McpResult } from './mcp-result'

export type McpProtocolCheckResult = {
  output: McpResult
  initialization: string
}

export const MCP_PROTOCOL_METHODS = [
  'get_server_info',
  'list_prompts',
  'get_prompt',
  'list_resources',
  'list_resource_templates',
  'read_resource',
] as const

export const mcpProtocolMethodSchema = z.enum(MCP_PROTOCOL_METHODS)

export type McpProtocolMethod = z.infer<typeof mcpProtocolMethodSchema>

export const mcpProtocolRequestSchema = z
  .object({
    method: mcpProtocolMethodSchema.describe(
      'Operation to perform on the selected MCP server. Choose one of the listed methods.',
    ),
    name: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe(
        'Prompt name returned by list_prompts. Required for get_prompt.',
      ),
    arguments: z
      .object({})
      .catchall(z.string().max(32_768))
      .optional()
      .describe(
        'Optional string arguments for the prompt selected by get_prompt.',
      ),
    uri: z
      .string()
      .min(1)
      .max(8192)
      .optional()
      .describe(
        'Resource URI returned by list_resources or constructed from a resource template. Required for read_resource.',
      ),
  })
  .superRefine((request, ctx) => {
    if (request.method === 'get_prompt' && !request.name)
      ctx.addIssue({
        code: 'custom',
        message: 'A prompt name is required',
        path: ['name'],
      })
    if (request.method === 'read_resource' && !request.uri)
      ctx.addIssue({
        code: 'custom',
        message: 'A resource URI is required',
        path: ['uri'],
      })
  })

export type McpProtocolRequest = z.infer<typeof mcpProtocolRequestSchema>

export const mcpProtocolBrokerSchema = mcpProtocolRequestSchema.safeExtend({
  server: z
    .string()
    .min(1)
    .max(1024)
    .describe('Server name returned by search_mcp_tools.'),
})

export const mcpOutputReadSchema = z.object({
  output: z
    .string()
    .min(1)
    .max(1024)
    .describe('Output name from origin.output in an MCP result.'),
  offset: z.number().int().nonnegative().default(0),
  length: z.number().int().min(1).max(32_768).default(16_384),
})

/** Prevents remembered approval for one resource or prompt from granting another. */
export function mcpProtocolApprovalKey(input: unknown, serverId: string) {
  const parsed = mcpProtocolBrokerSchema.safeParse(input)
  if (!parsed.success) return undefined
  const { method, name, uri, arguments: args } = parsed.data
  return `mcp_protocol:${JSON.stringify([serverId, method, name, uri, Object.entries(args ?? {}).sort()])}`
}
