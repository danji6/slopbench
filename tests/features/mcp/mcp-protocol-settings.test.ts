import type { Id } from '@sb/convex/_generated/dataModel'
import {
  check,
  expire,
  publish,
  settingsLaunch,
} from '@sb/convex/model/mcpProtocol'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

async function fixture() {
  const f = skillsDatabase()
  await f.db.insert('users', { _id: 'owner', subject: 'owner', role: 'admin' })
  const serverId = (await f.db.insert('mcpServers', {
    ownerId: 'owner',
    key: 'one',
    label: 'One',
    url: '',
    transport: 'stdio',
    command: 'fixture-command',
    enabled: true,
    revision: 1,
    order: 0,
  })) as Id<'mcpServers'>
  const deleted: string[] = []
  Object.assign(f.ctx, {
    auth: { getUserIdentity: async () => ({ subject: 'owner' }) },
    storage: {
      getUrl: async (id: string) => `https://storage.invalid/${id}`,
      delete: async (id: string) => {
        deleted.push(id)
      },
    },
  })
  return {
    ...f,
    serverId,
    deleted,
    args: {
      serverId,
      revision: 1,
      resultRef: 'blob-one' as Id<'_storage'>,
      bytes: 100,
    },
  }
}

test('settings artifacts are owner/revision scoped, expire durably and clean up only their own blobs', async () => {
  const f = await fixture()
  expect((await settingsLaunch(f.ctx, { serverId: f.serverId })).command).toBe(
    'fixture-command',
  )
  const checkId = await publish(f.ctx, f.args)
  expect(f.scheduled).toHaveLength(1)
  expect(await check(f.ctx, { checkId })).toBe(
    'https://storage.invalid/blob-one',
  )
  await expect(
    check({ ...f.ctx, userId: 'other' as Id<'users'> }, { checkId }),
  ).rejects.toThrow('unavailable')
  await f.db.patch(f.serverId, { revision: 2 })
  expect(await check(f.ctx, { checkId })).toBeNull()
  await expire(f.ctx, { checkId })
  expect(f.deleted).toEqual(['blob-one'])
  expect(f.rows('mcpProtocolChecks')).toEqual([])
  expect(await check(f.ctx, { checkId })).toBeNull()
})

test('disabled and non-admin local settings checks never resolve launch configuration', async () => {
  const f = await fixture()
  await f.db.patch('owner', { role: 'user' })
  await expect(settingsLaunch(f.ctx, { serverId: f.serverId })).rejects.toThrow(
    'Forbidden',
  )
  await f.db.patch('owner', { role: 'admin' })
  await f.db.patch(f.serverId, { enabled: false })
  await expect(settingsLaunch(f.ctx, { serverId: f.serverId })).rejects.toThrow(
    'Enable and save',
  )
  await expect(publish(f.ctx, f.args)).rejects.toThrow('Enable and save')
  expect(f.rows('mcpProtocolChecks')).toEqual([])
})

test('configuration replacement and temporary capacity prevent publication without evicting results', async () => {
  const f = await fixture()
  await expect(publish(f.ctx, { ...f.args, revision: 0 })).rejects.toThrow(
    'configuration changed',
  )
  for (let i = 0; i < 64; i++)
    await publish(f.ctx, {
      ...f.args,
      resultRef: `blob-${i}` as Id<'_storage'>,
    })
  await expect(publish(f.ctx, f.args)).rejects.toThrow('capacity reached')
  expect(f.rows('mcpProtocolChecks')).toHaveLength(64)
  expect(f.deleted).toEqual([])
})
