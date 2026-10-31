import { page } from '@sb/convex/model/agent/discovery'
import { rememberSelection, select } from '@sb/convex/model/agent/selection'
import { duplicate, exportData } from '@sb/convex/model/agents'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

function fixture() {
  const f = skillsDatabase({
    by_ownerId_lastSelectedAt: [
      'ownerId',
      'lastSelectedAt',
      '_creationTime',
      '_id',
    ],
  })
  f.ctx.role = 'user'
  for (let i = 0; i < 24; i++) {
    f.rows('agents').push({
      _id: `agent-${i}`,
      _creationTime: i,
      ownerId: 'owner',
      name: `Agent ${i}`,
      description: i === 0 ? 'Specialist in documentation' : undefined,
    })
  }
  f.rows('agents').push({
    _id: 'foreign',
    ownerId: 'other',
    name: 'Secret',
    lastSelectedAt: Number.MAX_SAFE_INTEGER,
  })
  return f
}

test('agent pages show selections first, then newest agents, without leaks or duplicates', async () => {
  const f = fixture()
  await select(f.ctx, { agentId: 'agent-2' as never })
  const first = await page(f.ctx, {
    paginationOpts: { numItems: 4, cursor: null },
  })
  expect(first.page.map((agent) => agent._id)).toEqual([
    'agent-2',
    'agent-23',
    'agent-22',
    'agent-21',
  ] as never)
  expect(Object.keys(first.page[0]!).sort()).toEqual([
    '_id',
    'avatarId',
    'description',
    'name',
  ])
  const second = await page(f.ctx, {
    paginationOpts: { numItems: 12, cursor: first.continueCursor },
  })
  const last = await page(f.ctx, {
    paginationOpts: { numItems: 12, cursor: second.continueCursor },
  })
  const ids = [...first.page, ...second.page, ...last.page].map(
    (agent) => agent._id,
  )
  expect(new Set(ids).size).toBe(24)
  expect(ids).not.toContain('foreign' as never)
  expect(last.isDone).toBe(true)
})

test('search matches unloaded agent descriptions and names without case sensitivity', async () => {
  const f = fixture()
  const result = await page(f.ctx, {
    search: ' DOCUMENTATION ',
    paginationOpts: { numItems: 12, cursor: null },
  })
  expect(result.page.map((agent) => agent._id)).toEqual(['agent-0'] as never)
  expect(result.isDone).toBe(true)
  const missing = await page(f.ctx, {
    search: 'secret',
    paginationOpts: { numItems: 12, cursor: null },
  })
  expect(missing.page).toEqual([])
})

test('sparse searches advance bounded cursors until a later match is found', async () => {
  const f = fixture()
  for (let i = 24; i < 230; i++) {
    f.rows('agents').push({
      _id: `agent-${i}`,
      _creationTime: i,
      ownerId: 'owner',
      name: `Agent ${i}`,
    })
  }
  let cursor: string | null = null
  let found = false
  let requests = 0
  do {
    const result = await page(f.ctx, {
      search: 'documentation',
      paginationOpts: { numItems: 12, cursor },
    })
    requests++
    if (requests === 1) {
      expect(result.page).toEqual([])
      expect(result.isDone).toBe(false)
    }
    found ||= result.page.some((agent) => agent._id === 'agent-0')
    cursor = result.isDone ? null : result.continueCursor
  } while (cursor && requests < 10)
  expect(found).toBe(true)
  expect(requests).toBeGreaterThan(1)
})

test('selection is owned, persists recency, and clearing preserves preferences', async () => {
  const f = fixture()
  f.rows('settings').push({
    _id: 'settings',
    ownerId: 'owner',
    recentModel: 'chosen-model',
  })
  await expect(select(f.ctx, { agentId: 'foreign' as never })).rejects.toThrow(
    'Not found',
  )
  expect((await f.db.get('foreign'))?.lastSelectedAt).toBe(
    Number.MAX_SAFE_INTEGER,
  )
  await select(f.ctx, { agentId: 'agent-1' as never })
  const stamp = (await f.db.get('agent-1'))?.lastSelectedAt
  expect(stamp).toBeNumber()
  expect(await f.db.get('settings')).toMatchObject({
    recentAgentId: 'agent-1',
    recentModel: 'chosen-model',
  })
  await select(f.ctx, { agentId: null })
  expect((await f.db.get('settings'))?.recentAgentId).toBeUndefined()
  expect((await f.db.get('agent-1'))?.lastSelectedAt).toBe(stamp)
})

test('exports and duplicates omit selection history', async () => {
  const f = fixture()
  await select(f.ctx, { agentId: 'agent-1' as never })
  const data = await exportData(f.ctx, { agentId: 'agent-1' as never })
  expect(data?.data).not.toHaveProperty('lastSelectedAt')
  const id = await duplicate(f.ctx, { agentId: 'agent-1' as never })
  expect(await f.db.get(id)).not.toHaveProperty('lastSelectedAt')
})

test('selecting another owner’s linked agent does not change their selection history', async () => {
  const f = fixture()
  const foreign = await f.ctx.db.get('foreign' as never)
  if (!foreign) throw new Error('Missing agent fixture')
  await rememberSelection(f.ctx, foreign as never)
  expect((await f.db.get('foreign'))?.lastSelectedAt).toBe(
    Number.MAX_SAFE_INTEGER,
  )
})
