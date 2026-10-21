import { z } from 'zod'

export const MCP_OPERATION_STATES = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'timedOut',
  'lost',
] as const

export const mcpOperationStateSchema = z.enum(MCP_OPERATION_STATES)

export const mcpProgressSchema = z.object({
  progress: z.number(),
  total: z.number().optional(),
  message: z.string().max(2000).optional(),
})

export type McpProgress = z.infer<typeof mcpProgressSchema>
export type McpOperationState = z.infer<typeof mcpOperationStateSchema>

export type McpOperationStatus = {
  id: string
  bootId: string
  generation: string
  state: McpOperationState
  progress?: McpProgress
  error?: string
  resultBytes?: number
  acknowledged?: boolean
}

/** Keeps absent remote settings at the previous SDK deadline. */
export function mcpOperationTimeouts(connection: {
  transport: string
  requestTimeoutMs?: number
  maxTotalTimeoutMs?: number
}) {
  const legacy = connection.transport !== 'stdio'
  return {
    requestTimeoutMs:
      connection.requestTimeoutMs ?? (legacy ? 60_000 : 300_000),
    maxTotalTimeoutMs:
      connection.maxTotalTimeoutMs ?? (legacy ? 60_000 : 1_800_000),
  }
}
