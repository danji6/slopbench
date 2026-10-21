import { mcpConnectionSchema } from '@sb/core/types'
import { Hono } from 'hono'
import { z } from 'zod'

import { ioError } from '../../http-errors'
import { withWorkspaceOperation } from '../workspace/context'
import { catalogSnapshots } from './catalog-snapshots'
import { withClient } from './client'
import { discoverTools } from './discovery'
import { mcpRegistry } from './registry'
import { assertMcpLease, mcpScopeSchema } from './scope'

const activeSchema = z.object({
  scope: mcpScopeSchema,
  bootId: z.string(),
  generation: z.string(),
  expiresAt: z.number(),
})

/** Separates complete discovery from bounded, immutable transport pages. */
export function mcpCatalogRoutes(
  registry = mcpRegistry,
  snapshots = catalogSnapshots,
) {
  const app = new Hono()

  app.post('/probe', async (c) => {
    try {
      const connection = mcpConnectionSchema.parse(await c.req.json())
      const { value, transport } = await withClient(connection, discoverTools)
      return c.json({ ...snapshots.create(value), transport })
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.post('/active', async (c) => {
    try {
      const input = activeSchema.parse(await c.req.json())
      assertMcpLease(input.expiresAt)
      const { tools, changeToken } = await withWorkspaceOperation(
        input.scope.sessionId,
        () => registry.catalog(input.scope, input),
      )
      return c.json({ ...snapshots.create(tools), changeToken })
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.post('/acknowledge', async (c) => {
    try {
      const input = activeSchema
        .extend({ changeToken: z.number().int().nonnegative() })
        .parse(await c.req.json())
      assertMcpLease(input.expiresAt)
      registry.acknowledgeCatalog(input.scope, input, input.changeToken)
      return c.json({ ok: true })
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.post('/page', async (c) => {
    try {
      const { id, cursor } = z
        .object({ id: z.string(), cursor: z.number().int().nonnegative() })
        .parse(await c.req.json())
      return c.json(snapshots.page(id, cursor))
    } catch (error) {
      return ioError(c, error)
    }
  })

  app.post('/release', async (c) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(await c.req.json())
      snapshots.delete(id)
      return c.json({ ok: true })
    } catch (error) {
      return ioError(c, error)
    }
  })

  return app
}
