import type { Id } from '@sb/convex/_generated/dataModel'
import { complete, fail } from '@sb/convex/model/skills/completion'
import {
  operation,
  reserveDestination,
  watchdog,
} from '@sb/convex/model/skills/endpoints'
import { claimExecution } from '@sb/convex/model/skills/execution'
import { invalidateHomeCaches } from '@sb/convex/model/skills/invalidation'
import { retry, start } from '@sb/convex/model/skills/operations'
import { cleanupRecords } from '@sb/convex/model/skills/removal'
import type {
  InvalidateAgentHomeArgs,
  OperationAttemptArgs,
} from '@sb/convex/types'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'

import { skillsDatabase } from '../helpers/skills-db'

const agentId = 'agent' as Id<'agents'>
const homeId = 'home' as Id<'agentHomes'>

async function setup(count = 1, kind: 'home' | 'detach' = 'home') {
  const f = skillsDatabase()
  f.rows('agents').push({
    _id: agentId,
    ownerId: 'owner',
    name: 'Agent',
    homeId,
  })
  f.rows('agentHomes').push({
    _id: homeId,
    ownerId: 'owner',
    originAgentId: agentId,
    managed: true,
    revision: 0,
    path: '/old',
  })
  for (let i = 0; i < count; i++) {
    f.rows('sessionCache').push({
      _id: `cache-${i}`,
      sessionId: `session-${i}`,
      agentId,
    })
    f.rows('sessionState').push({
      _id: `state-${i}`,
      sessionId: `session-${i}`,
      toolApprovals: {
        paths: ['/old', '/old/note', '/new', '/older', '/project'],
        tools: ['write_file'],
      },
    })
  }
  const operationId = await start(
    f.ctx,
    kind === 'home'
      ? { kind, agentId, destination: '/new', copyFiles: true }
      : { kind, agentId, removeFolder: true },
  )
  const args = { operationId, attempt: 1 }
  await claimExecution(f.ctx, args)
  if (kind === 'home')
    await reserveDestination(f.ctx, {
      ...args,
      path: '/new',
      insideData: false,
    })
  return { ...f, args }
}

type Fixture = Awaited<ReturnType<typeof setup>>

function lastJob<T>(f: Fixture, name: string): T {
  const job = [...f.scheduled]
    .reverse()
    .find(
      (entry) =>
        getFunctionName(entry.reference as FunctionReference<'mutation'>) ===
        name,
    )
  expect(job).toBeDefined()
  return job!.args as T
}

async function finishMetadata(f: Fixture) {
  const op = (await f.ctx.db.get(f.args.operationId))!
  await complete(f.ctx, {
    ...f.args,
    result:
      op.kind === 'home' ? { kind: 'home', path: '/new' } : { kind: 'detach' },
  })
  return lastJob<InvalidateAgentHomeArgs>(f, 'skills:_invalidateHomeCaches')
}

test('invalidation cannot change an executing operation', async () => {
  const f = await setup()
  const before = structuredClone(f.rows('sessionState'))
  const op = structuredClone(await f.ctx.db.get(f.args.operationId))
  await invalidateHomeCaches(f.ctx, { ...f.args, cursor: null })
  expect(f.rows('sessionState')).toEqual(before)
  expect(await f.ctx.db.get(f.args.operationId)).toEqual(op)
})

test('pages carry the attempt and hold reservations until final approval revocation', async () => {
  const f = await setup(21)
  await invalidateHomeCaches(f.ctx, await finishMetadata(f))
  expect((await operation(f.ctx, f.args))?.status).toBe('running')
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBe(
    f.args.operationId,
  )
  expect((await f.ctx.db.get(homeId))?.revision).toBe(0)
  const page = lastJob<InvalidateAgentHomeArgs>(
    f,
    'skills:_invalidateHomeCaches',
  )
  expect(page).toEqual({ ...f.args, cursor: '20' })
  await invalidateHomeCaches(f.ctx, page)
  expect((await operation(f.ctx, f.args))?.status).toBe('done')
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBeUndefined()
  for (const state of f.rows('sessionState'))
    expect(state.toolApprovals).toEqual({
      paths: ['/new', '/older', '/project'],
      tools: ['write_file'],
    })
  await invalidateHomeCaches(f.ctx, page)
  expect((await f.ctx.db.get(homeId))?.revision).toBe(1)
})

test('execution failures and duplicate completions cannot undo committed metadata', async () => {
  const f = await setup(21)
  await finishMetadata(f)
  const before = structuredClone(await f.ctx.db.get(f.args.operationId))
  await fail(f.ctx, { ...f.args, message: 'Late execution failure' })
  await complete(f.ctx, { ...f.args, result: { kind: 'home', path: '/wrong' } })
  expect(await f.ctx.db.get(f.args.operationId)).toEqual(before)
  await expect(retry(f.ctx, f.args)).rejects.toThrow('not found')
})

test('old callbacks cannot mutate a retried attempt before or after metadata commit', async () => {
  const f = await setup(21)
  const old = { ...f.args, cursor: '20' }
  await fail(f.ctx, { ...f.args, message: 'Interrupted' })
  await retry(f.ctx, f.args)
  f.args.attempt = 2
  await claimExecution(f.ctx, f.args)
  const before = structuredClone(f.rows('sessionState'))
  await invalidateHomeCaches(f.ctx, old)
  await finishMetadata(f)
  await invalidateHomeCaches(f.ctx, old)
  expect(f.rows('sessionState')).toEqual(before)
  await invalidateHomeCaches(f.ctx, { ...f.args, cursor: null })
  await invalidateHomeCaches(
    f.ctx,
    lastJob<InvalidateAgentHomeArgs>(f, 'skills:_invalidateHomeCaches'),
  )
  expect((await operation(f.ctx, f.args))?.status).toBe('done')
})

test('watchdogs reject old attempts and recover the current finalization phase', async () => {
  const f = await setup()
  await finishMetadata(f)
  await f.ctx.db.patch(f.args.operationId, { updatedAt: 0 })
  const count = f.scheduled.length
  await watchdog(f.ctx, { ...f.args, attempt: 0 })
  expect(f.scheduled).toHaveLength(count)
  await watchdog(f.ctx, f.args)
  const job = lastJob<InvalidateAgentHomeArgs>(
    f,
    'skills:_invalidateHomeCaches',
  )
  expect(job).toEqual({ ...f.args, cursor: null })
  await invalidateHomeCaches(f.ctx, job)
  expect((await operation(f.ctx, f.args))?.status).toBe('done')
})

test('an early watchdog preserves an active attempt and schedules its expiry check', async () => {
  const f = await setup()
  await watchdog(f.ctx, f.args)
  expect((await f.ctx.db.get(f.args.operationId))?.state.phase).toBe(
    'executing',
  )
  expect(lastJob<OperationAttemptArgs>(f, 'skills:_watchdog')).toEqual(f.args)
})

test('detachment invalidates first, then holds reservations through every cleanup batch', async () => {
  const f = await setup(1, 'detach')
  for (let i = 0; i < 101; i++)
    f.rows('agentSkills').push({ _id: `assignment-${i}`, homeId, name: `${i}` })
  const invalidation = await finishMetadata(f)
  await cleanupRecords(f.ctx, f.args)
  expect(f.rows('agentSkills')).toHaveLength(101)
  await invalidateHomeCaches(f.ctx, invalidation)
  expect((await operation(f.ctx, f.args))?.status).toBe('running')
  expect((await f.ctx.db.get(f.args.operationId))?.state.phase).toBe('cleaning')
  await cleanupRecords(f.ctx, { ...f.args, attempt: 0 })
  expect(f.rows('agentSkills')).toHaveLength(101)
  await cleanupRecords(f.ctx, f.args)
  expect(f.rows('agentSkills')).toHaveLength(1)
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBe(
    f.args.operationId,
  )
  await cleanupRecords(
    f.ctx,
    lastJob<OperationAttemptArgs>(f, 'skills:_cleanupHomeRecords'),
  )
  expect(await f.ctx.db.get(homeId)).toBeNull()
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBeUndefined()
  expect((await operation(f.ctx, f.args))?.status).toBe('done')
})

test('cleanup preserves a home that acquired another member or a newer reservation', async () => {
  const f = await setup(0, 'detach')
  await invalidateHomeCaches(f.ctx, await finishMetadata(f))
  f.rows('agents').push({ _id: 'other', ownerId: 'owner', homeId })
  await cleanupRecords(f.ctx, f.args)
  expect(await f.ctx.db.get(homeId)).not.toBeNull()
  await f.ctx.db.delete('other' as Id<'agents'>)
  await f.ctx.db.patch(homeId, {
    operationId: 'newer' as Id<'agentFileOperations'>,
  })
  await cleanupRecords(f.ctx, f.args)
  expect(await f.ctx.db.get(homeId)).not.toBeNull()
})

test.each(['queued', 'executing', 'failed', 'done'] as const)(
  'invalidation ignores %s operations',
  async (phase) => {
    const f = await setup()
    await finishMetadata(f)
    await f.ctx.db.patch(f.args.operationId, {
      state: phase === 'failed' ? { phase, error: 'Failure' } : { phase },
    })
    const before = structuredClone(f.rows('sessionState'))
    await invalidateHomeCaches(f.ctx, { ...f.args, cursor: null })
    expect(f.rows('sessionState')).toEqual(before)
  },
)
