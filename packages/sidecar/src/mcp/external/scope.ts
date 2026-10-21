import { z } from 'zod'

export const mcpScopeSchema = z.object({
  epoch: z.number().int().nonnegative().optional(),
  key: z.string(),
  ownerId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  serverId: z.string(),
  revision: z.string(),
})

export function assertMcpLease(expiresAt: number) {
  if (expiresAt < Date.now() || expiresAt > Date.now() + 60_000) {
    throw new Error('MCP authorization expired')
  }
}
