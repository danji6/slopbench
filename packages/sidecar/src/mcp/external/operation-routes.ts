import { mcpProtocolRequestSchema } from '@sb/core/types/mcp-protocol'
import { Hono } from 'hono'
import path from 'node:path'
import { z } from 'zod'

import { dataRoot } from '../../agent-files/storage'
import { ioError } from '../../http-errors'
import { McpOperations } from './operation'
import { McpOperationStore } from './operation-store'
import { mcpRegistry } from './registry'
import { assertMcpLease, mcpScopeSchema } from './scope'

let operations: McpOperations | undefined

export async function drainMcpOperations() {
  await operations?.drain()
}

export function mcpOperations() {
  return (operations ??= new McpOperations(
    mcpRegistry,
    new McpOperationStore(path.join(dataRoot(), 'mcp-operations')),
  ))
}

const accessSchema = z.object({
  id: z.string().min(1).max(200),
  scope: mcpScopeSchema,
})

const startSchema = accessSchema.extend({
  protocol: mcpProtocolRequestSchema.optional(),
  bootId: z.string(),
  generation: z.string(),
  expiresAt: z.number(),
  deadlineAt: z.number(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  requestTimeoutMs: z.number().int().min(100).max(86_400_000),
  maxTotalTimeoutMs: z.number().int().min(100).max(86_400_000),
})

/** All routes require the same backend authentication as runtime management. */
export function mcpOperationRoutes(getOperations = mcpOperations) {
  const app = new Hono()

  app.post('/start', async (c) => {
    try {
      const input = startSchema.parse(await c.req.json())
      assertMcpLease(input.expiresAt)
      return c.json(await getOperations().start(input))
    } catch (error) {
      return ioError(c, error)
    }
  })

  for (const method of ['status', 'cancel', 'acknowledge', 'forget'] as const) {
    app.post(`/${method}`, async (c) => {
      try {
        const input = accessSchema.parse(await c.req.json())
        const result = await getOperations()[method](input)
        return c.json(result ?? null)
      } catch (error) {
        return ioError(c, error)
      }
    })
  }

  app.post('/result', async (c) => {
    try {
      const input = accessSchema.parse(await c.req.json())
      const result = await getOperations().result(input)
      c.header('Content-Type', 'application/json')
      return c.body(new Uint8Array(result))
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.post('/list', async (c) => {
    try {
      const { cursor, limit } = z
        .object({
          cursor: z.string().nullable(),
          limit: z.number().int().min(1).max(64),
        })
        .parse(await c.req.json())
      return c.json(await getOperations().list(cursor, limit))
    } catch (error) {
      return ioError(c, error)
    }
  })

  return app
}
