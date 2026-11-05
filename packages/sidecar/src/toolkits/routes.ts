import { Hono } from 'hono'
import { z } from 'zod'

import { toolkitCatalogSchema, toolkitSkillCatalog } from './catalog'
import { inspectToolkit, toolkitConnections } from './manifest'
import { readToolkitSkill, toolkitReadSchema } from './read'

export function toolkitRoutes() {
  const routes = new Hono()

  routes.onError((cause, c) => c.json({ error: cause.message }, 400))

  routes.post('/inspect', async (c) => {
    const { root } = z
      .object({ root: z.string().min(1).max(4096) })
      .parse(await c.req.json())
    const snapshot = await inspectToolkit(root)
    return c.json({
      ...snapshot,
      connections: toolkitConnections(snapshot),
    })
  })

  routes.post('/catalog', async (c) =>
    c.json(
      await toolkitSkillCatalog(toolkitCatalogSchema.parse(await c.req.json())),
    ),
  )

  routes.post('/read', async (c) =>
    c.json(await readToolkitSkill(toolkitReadSchema.parse(await c.req.json()))),
  )

  return routes
}
