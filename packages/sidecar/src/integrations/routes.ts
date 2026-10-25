import { Hono } from 'hono'
import { z } from 'zod'

import { integrationCatalogSchema, integrationSkillCatalog } from './catalog'
import { inspectIntegration, integrationConnections } from './manifest'
import { integrationReadSchema, readIntegrationSkill } from './read'

export function integrationRoutes() {
  const routes = new Hono()

  routes.onError((cause, c) => c.json({ error: cause.message }, 400))

  routes.post('/inspect', async (c) => {
    const { root } = z
      .object({ root: z.string().min(1).max(4096) })
      .parse(await c.req.json())
    const snapshot = await inspectIntegration(root)
    return c.json({
      ...snapshot,
      connections: integrationConnections(snapshot),
    })
  })

  routes.post('/catalog', async (c) =>
    c.json(
      await integrationSkillCatalog(
        integrationCatalogSchema.parse(await c.req.json()),
      ),
    ),
  )

  routes.post('/read', async (c) =>
    c.json(
      await readIntegrationSkill(
        integrationReadSchema.parse(await c.req.json()),
      ),
    ),
  )

  return routes
}
