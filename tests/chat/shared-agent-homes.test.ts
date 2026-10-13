import type { Id } from '@sb/convex/_generated/dataModel'
import { assertAgentAvailable } from '@sb/convex/model/skills/access'
import { complete, fail } from '@sb/convex/model/skills/completion'
import { assertHomeDestination } from '@sb/convex/model/skills/destinations'
import { reserveDestination } from '@sb/convex/model/skills/endpoints'
import { bindHome, ensureHome, getHome } from '@sb/convex/model/skills/homes'
import { assigned, list } from '@sb/convex/model/skills/library'
import {
  migrateAgentHome,
  migrateHomeSkill,
} from '@sb/convex/model/skills/migration'
import { retry, running, start } from '@sb/convex/model/skills/operations'
import {
  assertRemovableHome,
  cleanupRecords,
  prepareHomeRemoval,
} from '@sb/convex/model/skills/removal'
import { expect, test } from 'bun:test'

import { skillsDatabase } from '../helpers/skills-db'

const a = 'a' as Id<'agents'>
const b = 'b' as Id<'agents'>
const skillId = 'review' as Id<'skills'>

async function setup(shared = true) {
  const fixture = skillsDatabase()
  fixture
    .rows('agents')
    .push(
      { _id: a, ownerId: 'owner', name: 'A', resolvedHomePath: '/shared' },
      { _id: b, ownerId: 'owner', name: 'B', resolvedHomePath: '/other' },
    )
  fixture.rows('skills').push({
    _id: skillId,
    ownerId: 'owner',
    name: 'review',
    description: 'Review',
    status: 'ready',
  })
  const first = (await fixture.ctx.db.get(a))!
  const home = await ensureHome(fixture.ctx, first)
  if (shared) await bindHome(fixture.ctx, b, home)
  return { ...fixture, home }
}

test('shared assignments are visible and excluded from both agents’ available lists', async () => {
  const { ctx, home } = await setup()
  const operationId = await start(ctx, { kind: 'assign', agentId: a, skillId })
  await expect(assertAgentAvailable(ctx, b)).rejects.toThrow('updated')
  await complete(ctx, { operationId })
  const page = await assigned(ctx, {
    agentId: b,
    paginationOpts: { cursor: null, numItems: 20 },
  })
  expect(page.page.map((row) => row.name)).toEqual(['review'])
  expect(
    (
      await list(ctx, {
        agentId: b,
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toEqual([])
  expect((await getHome(ctx, { agentId: b })).members).toHaveLength(2)
  expect((await ctx.db.get(a))?.homeRevision).toBe(
    (await ctx.db.get(home._id))?.revision,
  )
  expect((await ctx.db.get(b))?.homeRevision).toBe(
    (await ctx.db.get(home._id))?.revision,
  )
  const remove = await start(ctx, {
    kind: 'delete-assigned',
    agentId: b,
    assignmentId: page.page[0]!._id,
  })
  await complete(ctx, { operationId: remove })
  expect(
    (
      await assigned(ctx, {
        agentId: a,
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toEqual([])
})

test('a turn or shell job in any member blocks shared folder changes', async () => {
  const { ctx, rows } = await setup()
  rows('shellJobs').push({ _id: 'job', agentId: b })
  await expect(
    start(ctx, { kind: 'assign', agentId: a, skillId }),
  ).rejects.toThrow('finish')
  rows('shellJobs').splice(0)
  rows('streams').push({ _id: 'stream', agentId: b })
  await expect(
    start(ctx, {
      kind: 'home',
      agentId: a,
      destination: '/new',
      copyFiles: true,
    }),
  ).rejects.toThrow('finish')
})

test('joining adopts a same-owner home and rejects foreign or nested destinations', async () => {
  const { ctx, home, rows } = await setup(false)
  const operationId = await start(ctx, {
    kind: 'home',
    agentId: b,
    destination: '/shared',
    copyFiles: true,
  })
  await running(ctx, { operationId })
  const result = await reserveDestination(ctx, { operationId, path: '/shared' })
  expect(result.joined).toBe(true)
  expect(result.home._id).toBe(home._id)
  await complete(ctx, { operationId, path: '/shared' })
  expect((await ctx.db.get(b))?.homeId).toBe(home._id)
  await expect(assertHomeDestination(ctx, a, '/shared/nested')).rejects.toThrow(
    'overlap',
  )
  rows('agents').push({ _id: 'foreign', ownerId: 'other', name: 'Foreign' })
  await expect(
    assertHomeDestination(ctx, 'foreign' as Id<'agents'>, '/shared'),
  ).rejects.toThrow('owner')
})

test('a retried new destination stays a copy operation instead of becoming a join', async () => {
  const { ctx } = await setup(false)
  const operationId = await start(ctx, {
    kind: 'home',
    agentId: a,
    destination: '/new',
    copyFiles: true,
  })
  await running(ctx, { operationId })
  expect(
    (await reserveDestination(ctx, { operationId, path: '/new' })).joined,
  ).toBe(false)
  await fail(ctx, { operationId, message: 'Interrupted' })
  await retry(ctx, { operationId })
  await running(ctx, { operationId })
  expect(
    (await reserveDestination(ctx, { operationId, path: '/new' })).joined,
  ).toBe(false)
})

test('late completions and failures cannot overwrite a newer attempt', async () => {
  const { ctx } = await setup()
  const operationId = await start(ctx, { kind: 'assign', agentId: a, skillId })
  const first = await running(ctx, { operationId })
  await fail(ctx, { operationId, message: 'Interrupted' })
  await retry(ctx, { operationId })
  const second = await running(ctx, { operationId })
  expect(second).not.toBe(first)
  await complete(ctx, { operationId, attempt: Number(first) })
  await fail(ctx, {
    operationId,
    attempt: Number(first),
    message: 'Late failure',
  })
  expect((await ctx.db.get(operationId))?.status).toBe('running')
})

test('cleanup is reserved only for the last member of a managed home and remains retryable', async () => {
  const { ctx, home } = await setup()
  await expect(
    prepareHomeRemoval(ctx, (await ctx.db.get(a))!, true),
  ).rejects.toThrow('shared')
  await ctx.db.delete(b)
  const operationId = (await prepareHomeRemoval(
    ctx,
    (await ctx.db.get(a))!,
    true,
  ))!
  await ctx.db.delete(a)
  expect((await assertRemovableHome(ctx, home._id, operationId)).managed).toBe(
    true,
  )
  await running(ctx, { operationId })
  await fail(ctx, { operationId, message: 'Disk unavailable' })
  await retry(ctx, { operationId })
  expect((await ctx.db.get(operationId))?.status).toBe('queued')
  await running(ctx, { operationId })
  await complete(ctx, { operationId })
  await cleanupRecords(ctx, { homeId: home._id })
  expect(await ctx.db.get(home._id)).toBeNull()
})

test('custom homes cannot be removed through agent deletion', async () => {
  const { ctx, home } = await setup(false)
  await ctx.db.patch(home._id, { managed: false })
  await expect(
    prepareHomeRemoval(ctx, (await ctx.db.get(a))!, true),
  ).rejects.toThrow('Custom')
})

test('home identity creation is idempotent and retains the existing path', async () => {
  const { ctx, home, rows } = await setup(false)
  expect((await ensureHome(ctx, (await ctx.db.get(a))!))._id).toBe(home._id)
  expect(rows('agentHomes')).toHaveLength(1)
  expect(home.path).toBe('/shared')
})

test('joining a shared home can resume its own reservation while rejecting new activity', async () => {
  const { ctx, home } = await setup(false)
  const operationId = await start(ctx, {
    kind: 'home',
    agentId: b,
    destination: '/shared',
    copyFiles: true,
  })
  await running(ctx, { operationId })
  await reserveDestination(ctx, { operationId, path: '/shared' })
  expect(
    (await reserveDestination(ctx, { operationId, path: '/shared' })).home._id,
  ).toBe(home._id)
})

test('a failed operation cannot be retried against an agent that has changed homes', async () => {
  const { ctx } = await setup(false)
  const operationId = await start(ctx, { kind: 'assign', agentId: a, skillId })
  await fail(ctx, { operationId, message: 'Interrupted' })
  const otherHome = await ensureHome(ctx, (await ctx.db.get(b))!)
  await bindHome(ctx, a, otherHome)
  await expect(retry(ctx, { operationId })).rejects.toThrow('changed folders')
})

test('home migration resumes after pending work and preserves assignments on repeated runs', async () => {
  const { ctx, rows } = skillsDatabase()
  rows('agents').push({
    _id: a,
    ownerId: 'owner',
    name: 'A',
    resolvedHomePath: '/existing',
    fileOperationId: 'pending',
  })
  rows('agentFileOperations').push({ _id: 'pending', status: 'running' })
  rows('agentSkills').push({
    _id: 'assigned',
    ownerId: 'owner',
    agentId: a,
    skillId,
    name: 'review',
    description: 'Existing metadata',
  })
  const agent = (await ctx.db.get(a))!
  await expect(migrateAgentHome(ctx, agent)).rejects.toThrow(
    'finish before migrating',
  )
  expect(rows('agentHomes')).toHaveLength(0)
  await ctx.db.patch('pending' as Id<'agentFileOperations'>, { status: 'done' })
  await migrateAgentHome(ctx, agent)
  await migrateAgentHome(ctx, (await ctx.db.get(a))!)
  const assignmentId = 'assigned' as Id<'agentSkills'>
  await migrateHomeSkill(ctx, (await ctx.db.get(assignmentId))!)
  await migrateHomeSkill(ctx, (await ctx.db.get(assignmentId))!)
  expect(rows('agentHomes')).toHaveLength(1)
  expect(rows('agentHomes')[0]?.path).toBe('/existing')
  expect(rows('agentSkills')).toHaveLength(1)
  expect((await ctx.db.get(assignmentId))?.description).toBe(
    'Existing metadata',
  )
  expect((await ctx.db.get(assignmentId))?.homeId).toBe(
    (await ctx.db.get(a))?.homeId,
  )
})

test('detaching one member preserves shared files and assignments but removes its skill access', async () => {
  const { ctx, home, rows } = await setup()
  rows('agentSkills').push({
    _id: 'shared-skill',
    ownerId: 'owner',
    agentId: a,
    homeId: home._id,
    skillId,
    name: 'review',
    description: 'Review',
  })
  const operationId = await start(ctx, {
    kind: 'detach',
    agentId: a,
    removeFolder: false,
  })
  await running(ctx, { operationId })
  await complete(ctx, { operationId, previousPath: '/shared' })
  expect((await ctx.db.get(a))?.homeId).toBeUndefined()
  expect((await ctx.db.get(a))?.homeDetached).toBe(true)
  expect((await getHome(ctx, { agentId: a })).path).toBeUndefined()
  expect(
    (
      await assigned(ctx, {
        agentId: a,
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toHaveLength(0)
  expect(
    (
      await assigned(ctx, {
        agentId: b,
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toHaveLength(1)
  expect(
    (
      await list(ctx, {
        agentId: a,
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page,
  ).toHaveLength(1)
  expect((await ctx.db.get(b))?.homeId).toBe(home._id)
  expect(await ctx.db.get(home._id)).not.toBeNull()
})

test('detach-and-delete rejects shared and custom folders, then cleans up the final managed home', async () => {
  const { ctx, home } = await setup()
  await expect(
    start(ctx, { kind: 'detach', agentId: a, removeFolder: true }),
  ).rejects.toThrow('shared')
  await ctx.db.delete(b)
  await ctx.db.patch(home._id, { managed: false })
  await expect(
    start(ctx, { kind: 'detach', agentId: a, removeFolder: true }),
  ).rejects.toThrow('Custom')
  await ctx.db.patch(home._id, { managed: true })
  const operationId = await start(ctx, {
    kind: 'detach',
    agentId: a,
    removeFolder: true,
  })
  await running(ctx, { operationId })
  await fail(ctx, { operationId, message: 'Disk unavailable' })
  expect((await ctx.db.get(a))?.homeId).toBe(home._id)
  await retry(ctx, { operationId })
  await running(ctx, { operationId })
  await complete(ctx, { operationId })
  await cleanupRecords(ctx, { homeId: home._id })
  expect((await ctx.db.get(a))?.homeDetached).toBe(true)
  expect(await ctx.db.get(home._id)).toBeNull()
})

test('explicit reinitialization reuses a preserved managed home instead of duplicating its identity', async () => {
  const { ctx, home, rows } = await setup(false)
  const operationId = await start(ctx, {
    kind: 'detach',
    agentId: a,
    removeFolder: false,
  })
  await running(ctx, { operationId })
  await complete(ctx, { operationId })
  // Finish the cache invalidation lease, as the scheduler would.
  await ctx.db.patch(a, { fileOperationId: undefined })
  await ctx.db.patch(home._id, { operationId: undefined })
  const init = await start(ctx, { kind: 'ensure', agentId: a })
  expect((await ctx.db.get(init))?.homeId).toBe(home._id)
  expect(rows('agentHomes')).toHaveLength(1)
  expect((await ctx.db.get(a))?.homeDetached).toBe(false)
})
