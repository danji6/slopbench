import type { Id } from '@sb/convex/_generated/dataModel'
import { complete, fail } from '@sb/convex/model/skills/completion'
import { watchdog } from '@sb/convex/model/skills/endpoints'
import { invalidateHomeCaches } from '@sb/convex/model/skills/invalidation'
import { retry, running, start } from '@sb/convex/model/skills/operations'
import type { InvalidateAgentHomeArgs } from '@sb/convex/types'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'

import { skillsDatabase } from '../helpers/skills-db'

const agentId = 'agent' as Id<'agents'>
const homeId = 'home' as Id<'agentHomes'>

async function setup(count = 1) {
  const fixture = skillsDatabase()
  fixture
    .rows('agents')
    .push({ _id: agentId, ownerId: 'owner', name: 'Agent', homeId })
  fixture.rows('agentHomes').push({
    _id: homeId,
    ownerId: 'owner',
    originAgentId: agentId,
    managed: true,
    revision: 0,
    path: '/old',
  })
  for (let i = 0; i < count; i++) {
    fixture
      .rows('sessionCache')
      .push({ _id: `cache-${i}`, sessionId: `session-${i}`, agentId })
    fixture.rows('sessionState').push({
      _id: `state-${i}`,
      sessionId: `session-${i}`,
      toolApprovals: {
        paths: ['/old', '/old/note', '/new', '/older', '/project'],
        tools: ['write_file'],
      },
    })
  }
  const operationId = await start(fixture.ctx, {
    kind: 'home',
    agentId,
    destination: '/new',
    copyFiles: true,
  })
  const attempt = Number(await running(fixture.ctx, { operationId }))
  return { ...fixture, operationId, attempt }
}

type Fixture = Awaited<ReturnType<typeof setup>>

function lastInvalidation(fixture: Fixture): InvalidateAgentHomeArgs {
  const job = fixture.scheduled.at(-1)!
  expect(getFunctionName(job.reference as FunctionReference<'mutation'>)).toBe(
    'skills:_invalidateHomeCaches',
  )
  return job.args as InvalidateAgentHomeArgs
}

async function finishMetadata(fixture: Fixture, previousPath = '/old') {
  await complete(fixture.ctx, {
    operationId: fixture.operationId,
    attempt: fixture.attempt,
    path: '/new',
    previousPath,
  })
  return lastInvalidation(fixture)
}

test('invalidation cannot run before metadata enters the finishing phase', async () => {
  const f = await setup()
  const before = structuredClone(f.rows('sessionState'))
  const op = structuredClone(await f.ctx.db.get(f.operationId))
  await invalidateHomeCaches(f.ctx, {
    operationId: f.operationId,
    attempt: f.attempt,
    cursor: null,
    previousPath: '/old',
  })
  expect(f.rows('sessionState')).toEqual(before)
  expect(await f.ctx.db.get(f.operationId)).toEqual(op)
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBe(f.operationId)
})

test('every page carries the attempt and reservations remain held until the last page', async () => {
  const f = await setup(21)
  const initial = await finishMetadata(f)
  expect(initial.attempt).toBe(f.attempt)
  await invalidateHomeCaches(f.ctx, initial)
  expect((await f.ctx.db.get(f.operationId))?.status).toBe('running')
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBe(f.operationId)
  expect((await f.ctx.db.get(homeId))?.revision).toBe(0)
  const page = lastInvalidation(f)
  expect(page).toMatchObject({
    attempt: f.attempt,
    cursor: '20',
    previousPath: '/old',
  })
  await invalidateHomeCaches(f.ctx, page)
  expect((await f.ctx.db.get(f.operationId))?.status).toBe('done')
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBeUndefined()
  expect((await f.ctx.db.get(homeId))?.operationId).toBeUndefined()
  for (const state of f.rows('sessionState'))
    expect(state.toolApprovals).toEqual({
      paths: ['/new', '/older', '/project'],
      tools: ['write_file'],
    })
  await invalidateHomeCaches(f.ctx, page)
  expect((await f.ctx.db.get(homeId))?.revision).toBe(1)
})

test('an old page cannot change approvals or finish a retried execution', async () => {
  const f = await setup(21)
  await invalidateHomeCaches(f.ctx, await finishMetadata(f))
  const oldPage = lastInvalidation(f)
  await fail(f.ctx, {
    operationId: f.operationId,
    attempt: f.attempt,
    message: 'Interrupted',
  })
  await retry(f.ctx, { operationId: f.operationId })
  expect((await f.ctx.db.get(f.operationId))?.finishingHome).toBeUndefined()
  expect((await f.ctx.db.get(f.operationId))?.previousHomePath).toBeUndefined()
  f.attempt = Number(await running(f.ctx, { operationId: f.operationId }))
  const before = structuredClone(f.rows('sessionState'))
  await invalidateHomeCaches(f.ctx, oldPage)
  expect(f.rows('sessionState')).toEqual(before)
  const currentPage = await finishMetadata(f, '/new')
  const op = structuredClone(await f.ctx.db.get(f.operationId))
  await invalidateHomeCaches(f.ctx, oldPage)
  expect(f.rows('sessionState')).toEqual(before)
  expect(await f.ctx.db.get(f.operationId)).toEqual(op)
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBe(f.operationId)
  await invalidateHomeCaches(f.ctx, currentPage)
  await invalidateHomeCaches(f.ctx, lastInvalidation(f))
  expect((await f.ctx.db.get(f.operationId))?.status).toBe('done')
})

test('watchdog resumes the current finishing attempt from persisted metadata', async () => {
  const f = await setup()
  await finishMetadata(f)
  await watchdog(f.ctx, { operationId: f.operationId })
  const job = lastInvalidation(f)
  expect(job).toEqual({
    operationId: f.operationId,
    attempt: f.attempt,
    cursor: null,
    previousPath: '/old',
  })
  await invalidateHomeCaches(f.ctx, job)
  expect((await f.ctx.db.get(f.operationId))?.status).toBe('done')
})

test('legacy jobs restart from the current attempt and ignore their supplied cursor and path', async () => {
  const f = await setup(21)
  await finishMetadata(f, '/new')
  const before = structuredClone(f.rows('sessionState'))
  await invalidateHomeCaches(f.ctx, {
    operationId: f.operationId,
    cursor: '20',
    previousPath: '/project',
  })
  expect(f.rows('sessionState')).toEqual(before)
  const recovery = lastInvalidation(f)
  expect(recovery).toEqual({
    operationId: f.operationId,
    attempt: f.attempt,
    cursor: null,
    previousPath: '/new',
  })
  await invalidateHomeCaches(f.ctx, recovery)
  await invalidateHomeCaches(f.ctx, lastInvalidation(f))
  for (const state of f.rows('sessionState'))
    expect(state.toolApprovals).toEqual({
      paths: ['/old', '/old/note', '/older', '/project'],
      tools: ['write_file'],
    })
  expect((await f.ctx.db.get(f.operationId))?.status).toBe('done')
})

test('legacy finishing records without an attempt recover using attempt zero', async () => {
  const f = await setup()
  await finishMetadata(f)
  await f.ctx.db.patch(f.operationId, { attempt: undefined })
  await invalidateHomeCaches(f.ctx, {
    operationId: f.operationId,
    cursor: '20',
    previousPath: '/project',
  })
  const recovery = lastInvalidation(f)
  expect(recovery.attempt).toBe(0)
  await invalidateHomeCaches(f.ctx, recovery)
  expect((await f.ctx.db.get(f.operationId))?.status).toBe('done')
})

test.each(['queued', 'failed', 'done'] as const)(
  'invalidation ignores %s operations even with a finishing marker',
  async (status) => {
    const f = await setup()
    await finishMetadata(f)
    await f.ctx.db.patch(f.operationId, { status })
    const before = structuredClone(f.rows('sessionState'))
    const scheduled = f.scheduled.length
    await invalidateHomeCaches(f.ctx, {
      operationId: f.operationId,
      attempt: f.attempt,
      cursor: null,
      previousPath: '/old',
    })
    await invalidateHomeCaches(f.ctx, {
      operationId: f.operationId,
      cursor: null,
      previousPath: '/old',
    })
    expect(f.rows('sessionState')).toEqual(before)
    expect(f.scheduled).toHaveLength(scheduled)
  },
)
