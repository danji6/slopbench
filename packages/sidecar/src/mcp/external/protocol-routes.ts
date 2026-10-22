import { mcpConnectionSchema } from '@sb/core/types'
import { mcpProtocolRequestSchema } from '@sb/core/types/mcp-protocol'
import { mcpResult } from '@sb/core/types/mcp-result'
import { Hono } from 'hono'
import { z } from 'zod'

import { ioError } from '../../http-errors'
import { withClient } from './client'
import { initializationContext, requestProtocol } from './protocol'

/** Explicit settings checks use temporary clients, never a chat's analysis session. */
export function mcpProtocolRoutes() {
  const app = new Hono()
  app.post('/probe', async (c) => {
    try {
      const input = z
        .object({
          connection: mcpConnectionSchema,
          request: mcpProtocolRequestSchema,
        })
        .parse(await c.req.json())
      const signal = AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(60_000),
      ])
      const { value } = await withClient(input.connection, async (client) => ({
        initialization: initializationContext(client),
        output: mcpResult(
          {
            ...(await requestProtocol(client, input.request, {
              signal,
              timeout: 60_000,
            })),
            content: [],
          },
          { serverId: 'settings-probe', name: input.request.method },
        ),
      }))
      return c.json(value)
    } catch (error) {
      return ioError(c, error)
    }
  })
  return app
}
