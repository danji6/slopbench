import type { ActionCtx } from '@sb/convex/_generated/server'
import { publish } from '@sb/convex/model/integrations/publication'
import { missing } from '@sb/convex/model/integrations/settings'
import { get, sources } from '@sb/convex/model/integrations/views'
import { integrationRoutes } from '@sb/sidecar/integrations/routes'
import { expect } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { skillsDatabase } from './skills-db'

/** Exercises public integration actions through the sidecar routes and real model mutations. */
export async function integrationActionsFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sb-integration-actions-'))
  const original = globalThis.fetch
  const previousSecret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'integration-fixture'
  const f = skillsDatabase()
  await f.db.insert('users', { _id: 'owner', subject: 'owner', role: 'admin' })
  const app = new Hono()
  app.route('/integrations', integrationRoutes())
  app.onError((cause, c) => c.json({ error: cause.message }, 400))
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      app.fetch(new Request(input, init)),
    { preconnect: original.preconnect },
  )
  const action = {
    auth: { getUserIdentity: async () => ({ subject: 'owner' }) },
    runQuery: async (
      reference: Parameters<typeof getFunctionName>[0],
      args: unknown,
    ) => {
      const name = getFunctionName(reference)
      if (name === 'users:_getRoleBySubject') return 'admin'
      if (name === 'integrations:sources')
        return structuredClone(await sources(f.ctx, args as never))
      return structuredClone(await get(f.ctx, args as never))
    },
    runMutation: (
      reference: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) => {
      expect(args).not.toHaveProperty('diagnostics')
      if (getFunctionName(reference) === 'integrations:_missing')
        return missing(f.ctx, args as never)
      return publish(f.ctx, args as never)
    },
  } as unknown as ActionCtx
  return {
    ...f,
    root,
    action,
    async dispose() {
      globalThis.fetch = original
      if (previousSecret === undefined) delete process.env.SIDECAR_SECRET
      else process.env.SIDECAR_SECRET = previousSecret
      await rm(root, { recursive: true, force: true })
    },
  }
}
