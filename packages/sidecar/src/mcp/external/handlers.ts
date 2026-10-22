import { mcpConnectionSchema } from '@sb/core/types'
import { Hono } from 'hono'
import { z } from 'zod'

import { ioError } from '../../http-errors'
import { withWorkspaceOperation } from '../workspace/context'
import { mcpCatalogRoutes } from './catalog-routes'
import { listExternalTools } from './client'
import { mcpOperationRoutes } from './operation-routes'
import { mcpProtocolRoutes } from './protocol-routes'
import { mcpRegistry } from './registry'
import { assertMcpLease, mcpScopeSchema } from './scope'

const scopedSchema = z.object({
  scope: mcpScopeSchema,
  bootId: z.string().optional(),
  generation: z.string().optional(),
  expiresAt: z.number(),
})

/** These routes are mounted behind the sidecar's backend authentication. */
export function externalMcpRoutes() {
  const app = new Hono()

  app.route('/protocol', mcpProtocolRoutes())

  app.route('/operations', mcpOperationRoutes())

  app.route('/catalog', mcpCatalogRoutes())

  app.post('/list', async (c) => {
    try {
      return c.json(
        await listExternalTools(
          mcpConnectionSchema.parse(await c.req.json()),
        ).then(({ value, transport }) => ({ tools: value, transport })),
      )
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.post('/connect', async (c) => {
    try {
      const input = scopedSchema
        .extend({ connection: mcpConnectionSchema })
        .parse(await c.req.json())
      assertMcpLease(input.expiresAt)
      const status = await withWorkspaceOperation(input.scope.sessionId, () =>
        mcpRegistry.connect(input.scope, input.connection, input),
      )
      return c.json(status)
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.post('/status', async (c) => {
    try {
      const { scope } = z
        .object({ scope: mcpScopeSchema })
        .parse(await c.req.json())
      return c.json(mcpRegistry.status(scope))
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.post('/disconnect', async (c) => {
    try {
      const { scope } = z
        .object({ scope: mcpScopeSchema })
        .parse(await c.req.json())
      await mcpRegistry.disconnect(scope)
      return c.json({ ok: true })
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.get('/runtimes', (c) =>
    c.json({ bootId: mcpRegistry.bootId, runtimes: mcpRegistry.list() }),
  )

  return app
}
