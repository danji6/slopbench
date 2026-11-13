import type { Id } from '@cv/convex/_generated/dataModel'
import { list, replaceAll } from '@cv/convex/model/mcp'
import { begin as beginCatalog } from '@cv/convex/model/mcpCatalogs'
import { settingsLaunch } from '@cv/convex/model/mcpProtocol'
import { availableToolkits } from '@cv/convex/model/toolkits/access'
import { publish } from '@cv/convex/model/toolkits/publication'
import { remove, settings } from '@cv/convex/model/toolkits/settings'
import { list as listToolkits, sources } from '@cv/convex/model/toolkits/views'
import { expect, test } from 'bun:test'
import { fixture } from '~/tests/helpers/toolkit-activation'

test('toolkit descriptions come from the saved snapshot and follow refresh and removal', async () => {
  const f = await fixture()
  const description = async () =>
    (await listToolkits(f.ctx, { agentId: f.agentId }))[0].description
  expect(await description()).toBeUndefined()
  const update = (revision: string, description?: string) =>
    publish(f.ctx, {
      ...f.input,
      toolkitId: f.toolkitId,
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
  const toolkitId = f.toolkitId
  await settings(f.ctx, {
    toolkitId,
    skill: { name: 'review', enabled: false },
  })
  await settings(f.ctx, {
    toolkitId,
    skill: { name: 'analyze', enabled: false },
  })
  await settings(f.ctx, { toolkitId, skillsEnabled: false })
  let row = await f.db.get(toolkitId)
  expect(row?.disabledSkills).toEqual(['review', 'analyze'])
  expect(row?.skillsEnabled).toBe(false)
  await settings(f.ctx, {
    toolkitId,
    skill: { name: 'review', enabled: true },
  })
  row = await f.db.get(toolkitId)
  expect(row?.disabledSkills).toEqual(['analyze'])
  expect(row?.skillsEnabled).toBe(false)
})

test('individual skill updates validate names and reject ambiguous batch changes', async () => {
  const f = await fixture()
  const toolkitId = f.toolkitId
  await expect(
    settings(f.ctx, {
      toolkitId,
      skill: { name: '../outside', enabled: false },
    }),
  ).rejects.toThrow('Invalid skill component name')
  await expect(
    settings(f.ctx, {
      toolkitId,
      skill: { name: 'review', enabled: false },
      disabledSkills: [],
    }),
  ).rejects.toThrow('Cannot combine skill and batch selection updates')
  expect((await f.db.get(toolkitId))?.disabledSkills).toEqual([])
})

test('registration and standalone settings do not activate or remove toolkit servers', async () => {
  const f = await fixture()
  expect(f.rows('mcpRuntimes')).toHaveLength(0)
  expect(await list(f.ctx)).toEqual([])
  expect(await availableToolkits(f.ctx, f.agentId, f.sessionId)).toEqual([])
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
  ).rejects.toThrow('Toolkits settings')
})

test('project discovery is per source, defaults off, and never changes activation', async () => {
  const f = await fixture()
  const folder = await f.db.insert('sessionFolders', {
    ownerId: 'owner',
    revision: 1,
    name: 'Project',
    sources: [
      { id: 'one', path: '/one', label: 'One' },
      { id: 'two', path: '/two', label: 'Two', discoverToolkits: true },
    ],
  })
  await f.db.patch(f.sessionId, { folderId: folder })
  expect(
    (await sources(f.ctx, { sessionId: f.sessionId })).map((row) => row.path),
  ).toEqual(['/two'])
  expect(await availableToolkits(f.ctx, f.agentId, f.sessionId)).toEqual([])
  await remove(f.ctx, f.toolkitId)
  expect(f.rows('mcpServers')).toHaveLength(0)
  expect(f.rows('toolkits')).toHaveLength(0)
})

test('toolkit settings cannot launch catalog or protocol probes', async () => {
  const f = await fixture()
  const serverId = f.server._id as Id<'mcpServers'>
  await expect(beginCatalog(f.ctx, { serverId })).rejects.toMatchObject({
    data: {
      code: 403,
      message: 'Toolkit servers are discovered by agents',
    },
  })
  const ctx = {
    ...f.ctx,
    auth: { getUserIdentity: async () => ({ subject: 'owner' }) },
  }
  await expect(
    settingsLaunch(ctx as never, { serverId }),
  ).rejects.toMatchObject({
    data: { code: 403, message: 'Toolkit servers are accessed by agents' },
  })
  expect(f.rows('mcpCatalogs')).toHaveLength(0)
  expect(f.rows('mcpRuntimes')).toHaveLength(0)
})
