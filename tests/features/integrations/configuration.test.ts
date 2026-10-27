import type { Id } from '@sb/convex/_generated/dataModel'
import { availableIntegrations } from '@sb/convex/model/integrations/access'
import { publish } from '@sb/convex/model/integrations/publication'
import { remove, settings } from '@sb/convex/model/integrations/settings'
import {
  list as listIntegrations,
  sources,
} from '@sb/convex/model/integrations/views'
import { list, replaceAll } from '@sb/convex/model/mcp'
import { begin as beginCatalog } from '@sb/convex/model/mcpCatalogs'
import { settingsLaunch } from '@sb/convex/model/mcpProtocol'
import { expect, test } from 'bun:test'
import { fixture } from '~/tests/helpers/integration-activation'

test('integration descriptions come from the saved snapshot and follow refresh and removal', async () => {
  const f = await fixture()
  const description = async () =>
    (await listIntegrations(f.ctx, { agentId: f.agentId }))[0].description
  expect(await description()).toBeUndefined()
  const update = (revision: string, description?: string) =>
    publish(f.ctx, {
      ...f.input,
      integrationId: f.integrationId,
      revision,
      manifest: JSON.stringify({
        ...JSON.parse(f.input.manifest),
        description,
      }),
    })
  await update('b', '  Review local artifacts.  ')
  expect(await description()).toBe('Review local artifacts.')
  await update('c', 'Inspect retained evidence.')
  expect(await description()).toBe('Inspect retained evidence.')
  await update('d')
  expect(await description()).toBeUndefined()
})

test('individual skill updates merge without replacing other settings', async () => {
  const f = await fixture()
  const integrationId = f.integrationId
  await settings(f.ctx, {
    integrationId,
    skill: { name: 'review', enabled: false },
  })
  await settings(f.ctx, {
    integrationId,
    skill: { name: 'analyze', enabled: false },
  })
  await settings(f.ctx, { integrationId, skillsEnabled: false })
  let row = await f.db.get(integrationId)
  expect(row?.disabledSkills).toEqual(['review', 'analyze'])
  expect(row?.skillsEnabled).toBe(false)
  await settings(f.ctx, {
    integrationId,
    skill: { name: 'review', enabled: true },
  })
  row = await f.db.get(integrationId)
  expect(row?.disabledSkills).toEqual(['analyze'])
  expect(row?.skillsEnabled).toBe(false)
})

test('individual skill updates validate names and reject ambiguous batch changes', async () => {
  const f = await fixture()
  const integrationId = f.integrationId
  await expect(
    settings(f.ctx, {
      integrationId,
      skill: { name: '../outside', enabled: false },
    }),
  ).rejects.toThrow('Invalid skill component name')
  await expect(
    settings(f.ctx, {
      integrationId,
      skill: { name: 'review', enabled: false },
      disabledSkills: [],
    }),
  ).rejects.toThrow('Cannot combine skill and batch selection updates')
  expect((await f.db.get(integrationId))?.disabledSkills).toEqual([])
})

test('registration and standalone settings do not activate or remove integration servers', async () => {
  const f = await fixture()
  expect(f.rows('mcpRuntimes')).toHaveLength(0)
  expect(await list(f.ctx)).toEqual([])
  expect(await availableIntegrations(f.ctx, f.agentId, f.sessionId)).toEqual([])
  await replaceAll(f.ctx, { servers: [] })
  expect(f.rows('mcpServers')).toHaveLength(1)
  await expect(
    replaceAll(f.ctx, {
      servers: [
        {
          key: String(f.server.key),
          label: 'Override',
          url: '',
          command: 'evil',
          enabled: true,
          transport: 'stdio',
        },
      ],
    }),
  ).rejects.toThrow('Integrations settings')
})

test('project discovery is per source, defaults off, and never changes activation', async () => {
  const f = await fixture()
  const folder = await f.db.insert('sessionFolders', {
    ownerId: 'owner',
    revision: 1,
    name: 'Project',
    sources: [
      { id: 'one', path: '/one', label: 'One' },
      { id: 'two', path: '/two', label: 'Two', discoverIntegrations: true },
    ],
  })
  await f.db.patch(f.sessionId, { folderId: folder })
  expect(
    (await sources(f.ctx, { sessionId: f.sessionId })).map((row) => row.path),
  ).toEqual(['/two'])
  expect(await availableIntegrations(f.ctx, f.agentId, f.sessionId)).toEqual([])
  await remove(f.ctx, f.integrationId)
  expect(f.rows('mcpServers')).toHaveLength(0)
  expect(f.rows('integrations')).toHaveLength(0)
})

test('integration settings cannot launch catalog or protocol probes', async () => {
  const f = await fixture()
  const serverId = f.server._id as Id<'mcpServers'>
  await expect(beginCatalog(f.ctx, { serverId })).rejects.toMatchObject({
    data: {
      code: 403,
      message: 'Integration servers are discovered by agents',
    },
  })
  const ctx = {
    ...f.ctx,
    auth: { getUserIdentity: async () => ({ subject: 'owner' }) },
  }
  await expect(
    settingsLaunch(ctx as never, { serverId }),
  ).rejects.toMatchObject({
    data: { code: 403, message: 'Integration servers are accessed by agents' },
  })
  expect(f.rows('mcpCatalogs')).toHaveLength(0)
  expect(f.rows('mcpRuntimes')).toHaveLength(0)
})
