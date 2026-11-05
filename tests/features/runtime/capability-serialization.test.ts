import { internal } from '@sb/convex/_generated/api'
import { _getContext } from '@sb/convex/model/stream/reads'
import {
  capabilitySource,
  skillCatalogSource,
} from '@sb/convex/model/tool/capabilitySource'
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import { expect, spyOn, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { skillRequests } from '~/tests/helpers/skill-requests'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'capability-serialization-'))
  const state = skillRequests(root)
  state.agent.tools = []
  state.rows('mcpServers').push({
    _id: 'server',
    ownerId: 'owner',
    key: 'docs',
    label: 'Docs',
    transport: 'http',
    url: 'http://fixture',
    enabled: true,
  })
  return {
    ...state,
    async dispose() {
      state.restore()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test.each([true, false])(
  'unchanged catalogs prepare once across Convex serialization (project: %s)',
  async (hasProject) => {
    const f = await fixture()
    const mutation = spyOn(f.action, 'runMutation')
    try {
      if (!hasProject) await f.db.patch('session', { folderId: undefined })
      await f.db.patch('server', { catalogId: 'catalog', revision: 0 })
      f.rows('mcpCatalogs').push({ _id: 'catalog', configRevision: 0 })
      f.rows('mcpCatalogTools').push({
        _id: 'catalog-tool',
        catalogId: 'catalog',
        name: 'status',
        description: 'Read status',
        definitionRef: 'blob',
        order: 0,
      })
      expect(await f.nextTurn()).not.toBeNull()
      const local = (await _getContext(f.ctx, f.execution))!
      const transported = (await f.action.runQuery(
        internal.streams._getContext,
        f.execution,
      ))!
      expect(await capabilitySource(local)).toBe(
        await capabilitySource(transported),
      )
      expect(skillCatalogSource(local)).toBe(skillCatalogSource(transported))
      mutation.mockClear()
      expect(await f.repeat()).not.toBeNull()
      expect(await f.repeat()).not.toBeNull()
      const repeatedPreparation = mutation.mock.calls.some(([reference]) =>
        ['streams:_prepareCapabilities', 'streams:_handoff'].includes(
          getFunctionName(reference),
        ),
      )
      expect(repeatedPreparation).toBe(false)
      expect(
        f.rows('messages').filter((row) => row.type === 'capabilities'),
      ).toHaveLength(0)
      await f.db.patch('catalog-tool', { description: 'Updated status' })
      const changed = (await f.action.runQuery(
        internal.streams._getContext,
        f.execution,
      ))!
      expect(await capabilitySource(changed)).not.toBe(
        await capabilitySource(transported),
      )
    } finally {
      mutation.mockRestore()
      await f.dispose()
    }
  },
)

test('serialized native MCP contracts retain access until their configuration changes', async () => {
  const f = await fixture()
  try {
    await f.nextTurn()
    f.agent.tools = ['docs_status']
    f.rows('mcpTools').push({
      _id: 'tool',
      serverId: 'server',
      order: 0,
      name: 'status',
      description: 'Read status',
      inputSchema: '{"type":"object"}',
    })
    const data = (await f.action.runQuery(
      internal.streams._getContext,
      f.execution,
    ))!
    const manifest = resolveToolManifest({
      ...data,
      resources: { settings: data.settings, mcpServers: data.mcpServers },
    })
    const assertAccess = () =>
      f.action.runQuery(internal.streams._assertToolAccess, {
        ...f.execution,
        name: 'docs_status',
        manifest,
      })
    await expect(assertAccess()).resolves.toBe(true)
    await f.db.patch('tool', { description: 'Updated status' })
    await expect(assertAccess()).rejects.toThrow('Tool contract changed')
  } finally {
    await f.dispose()
  }
})
