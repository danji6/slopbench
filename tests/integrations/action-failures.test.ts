import type { Id } from '@sb/convex/_generated/dataModel'
import { link, refresh } from '@sb/convex/model/integrations/actions'
import { select } from '@sb/convex/model/integrations/selection'
import { previewSkills } from '@sb/convex/model/integrations/skillPreview'
import { integrationRequest } from '@sb/convex/model/integrations/transport'
import { _getExecution } from '@sb/convex/model/mcp'
import { isAuthorized } from '@sb/convex/model/mcpRuntime'
import { inspectIntegration } from '@sb/sidecar/integrations/manifest'
import { expect, test } from 'bun:test'
import { ConvexError } from 'convex/values'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { integrationActionsFixture } from '../helpers/integration-actions'

for (const outcome of ['failure', 'stale response']) {
  test(`a delayed inspection ${outcome} cannot revoke a newer refreshed runtime`, async () => {
    const f = await integrationActionsFixture()
    const { root, action } = f
    try {
      await mkdir(path.join(root, '.agents'))
      const filename = path.join(root, '.agents/integration.json')
      await writeFile(
        filename,
        JSON.stringify({ mcpServers: { main: { command: 'old' } } }),
      )
      const integrationId = await link(action, root)
      const agentId = (await f.db.insert('agents', {
        ownerId: 'owner',
        name: 'Agent',
      })) as Id<'agents'>
      const sessionId = (await f.db.insert('sessions', {
        ownerId: 'owner',
      })) as Id<'sessions'>
      await f.db.insert('userSessions', { sessionId, userId: 'owner' })
      const streamId = (await f.db.insert('streams', {
        agentId,
        sessionId,
        invokedBy: 'owner',
        generation: 1,
        state: { phase: 'streaming', processingMessageId: 'message' },
      })) as Id<'streams'>
      await select(f.ctx, { integrationId, agentId, enabled: true })

      const started = Promise.withResolvers<void>()
      const inspection = Promise.withResolvers<void>()
      const fetch = globalThis.fetch
      let delayed = false
      globalThis.fetch = Object.assign(
        async (...args: Parameters<typeof fetch>) => {
          if (!delayed) {
            delayed = true
            const response = await fetch(...args)
            started.resolve()
            await inspection.promise
            return response
          }
          return fetch(...args)
        },
        { preconnect: fetch.preconnect },
      )
      const obsolete = refresh(action, integrationId).catch(
        (cause: unknown) => cause,
      )
      await started.promise
      await writeFile(
        filename,
        JSON.stringify({ mcpServers: { main: { command: 'new' } } }),
      )
      const revision = (await inspectIntegration(root)).revision
      await refresh(action, integrationId)
      const server = f.rows('mcpServers')[0]
      await _getExecution(f.ctx, {
        streamId,
        generation: 1,
        sessionId,
        agentId,
        serverKey: String(server.key),
      })
      const runtime = structuredClone(f.rows('mcpRuntimes')[0])
      const cleanups = f.rows('mcpCleanups').length
      if (outcome === 'failure')
        inspection.reject(new Error('Old inspection failed'))
      else inspection.resolve()
      expect(await obsolete).toBeInstanceOf(ConvexError)
      expect(await f.db.get(integrationId)).toMatchObject({
        revision,
        status: 'ready',
      })
      expect(f.rows('mcpRuntimes')[0]).toEqual(runtime)
      expect(await isAuthorized(f.ctx, f.rows('mcpRuntimes')[0] as never)).toBe(
        true,
      )
      expect(f.rows('mcpCleanups')).toHaveLength(cleanups)
    } finally {
      await f.dispose()
    }
  })
}

test('expected public action failures have structured messages and status codes', async () => {
  const f = await integrationActionsFixture()
  try {
    await mkdir(path.join(f.root, '.agents'))
    const filename = path.join(f.root, '.agents/integration.json')
    await writeFile(filename, '{}')
    const integrationId = await link(f.action, f.root)
    await expect(
      previewSkills(f.action, { integrationId, offset: -1 }),
    ).rejects.toMatchObject({
      data: { code: 400, message: 'Invalid skill offset' },
    })
    await expect(
      previewSkills(f.action, { integrationId, offset: 1 }),
    ).rejects.toMatchObject({
      data: { code: 400, message: 'Skill offset is out of range' },
    })
    await expect(
      previewSkills(f.action, {
        integrationId,
        offset: 0,
        fingerprint: 'stale',
      }),
    ).rejects.toMatchObject({
      data: {
        code: 409,
        message: 'Skill catalog changed. Reload the components.',
      },
    })
    await writeFile(
      filename,
      '{"mcpServers":{"main":{"command":"a","url":"https://example.com"}}}',
    )
    await expect(refresh(f.action, integrationId)).rejects.toMatchObject({
      data: {
        code: 400,
        message: 'main: specify exactly one of command or url',
      },
    })
    expect((await f.db.get(integrationId))?.status).toBe('missing')
    expect((await f.db.get(integrationId))?.manifest).toBe(
      '{"schemaVersion":1,"name":"' + path.basename(f.root) + '"}',
    )
    await writeFile(filename, '{"name":"Recovered"}')
    await refresh(f.action, integrationId)
    expect((await f.db.get(integrationId))?.status).toBe('ready')
  } finally {
    await f.dispose()
  }
})

test('integration transport preserves application errors and structures network and timeout failures', async () => {
  const original = globalThis.fetch
  const previous = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'fixture'
  const failWith = (cause: Error) => {
    globalThis.fetch = Object.assign(
      async () => {
        throw cause
      },
      { preconnect: original.preconnect },
    )
  }
  try {
    const structured = new ConvexError({
      message: 'Missing toolkit',
      code: 404,
    })
    failWith(structured)
    await expect(integrationRequest('inspect', {})).rejects.toBe(structured)
    failWith(new TypeError('Connection refused'))
    await expect(integrationRequest('inspect', {})).rejects.toMatchObject({
      data: {
        code: 502,
        message: 'Integration request failed: Connection refused',
      },
    })
    failWith(new DOMException('Deadline exceeded', 'TimeoutError'))
    await expect(integrationRequest('inspect', {})).rejects.toMatchObject({
      data: { code: 504, message: 'Integration request timed out' },
    })
    globalThis.fetch = Object.assign(
      async () => Response.json({ error: 'Missing file' }, { status: 404 }),
      { preconnect: original.preconnect },
    )
    await expect(integrationRequest('inspect', {})).rejects.toMatchObject({
      data: { code: 404, message: 'Missing file' },
    })
  } finally {
    globalThis.fetch = original
    if (previous === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = previous
  }
})
