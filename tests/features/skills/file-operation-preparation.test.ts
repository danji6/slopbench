import type { Id } from '@sb/convex/_generated/dataModel'
import { complete, fail } from '@sb/convex/model/skills/completion'
import {
  copyAssignments,
  reserveDestination,
} from '@sb/convex/model/skills/endpoints'
import { claimExecution } from '@sb/convex/model/skills/execution'
import {
  continueImport,
  finish,
  prepare,
} from '@sb/convex/model/skills/imports'
import { releaseOperation } from '@sb/convex/model/skills/lifecycle'
import { retry, start } from '@sb/convex/model/skills/operations'
import type { FileOperationArgs } from '@sb/convex/types'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const agentId = 'agent' as Id<'agents'>
const duplicateId = 'duplicate' as Id<'agents'>
const homeId = 'home' as Id<'agentHomes'>
const skillId = 'skill' as Id<'skills'>
const assignmentId = 'assignment' as Id<'agentSkills'>
const storageId = 'upload' as Id<'_storage'>
const newerId = 'newer' as Id<'agentFileOperations'>

function setup() {
  const f = skillsDatabase()
  f.rows('agents').push(
    { _id: agentId, ownerId: 'owner', homeId, name: 'Agent' },
    { _id: duplicateId, ownerId: 'owner', name: 'Duplicate' },
  )
  f.rows('agentHomes').push({
    _id: homeId,
    ownerId: 'owner',
    originAgentId: agentId,
    managed: true,
    revision: 0,
    path: '/home',
  })
  f.rows('skills').push({
    _id: skillId,
    ownerId: 'owner',
    name: 'review',
    description: 'Review',
    status: 'ready',
  })
  f.rows('skillUploads').push({
    _id: 'staged',
    ownerId: 'owner',
    storageId,
    ticket: 'owned-ticket',
  })
  return f
}

const commands: FileOperationArgs[] = [
  { kind: 'ensure', agentId },
  { kind: 'home', agentId, destination: '/new', copyFiles: true },
  { kind: 'detach', agentId },
  { kind: 'detach', agentId, removeFolder: true },
  { kind: 'duplicate', agentId, duplicateId },
  { kind: 'assign', agentId, skillId },
  { kind: 'delete-assigned', agentId, assignmentId },
  { kind: 'delete-library', mode: 'keep-copies', skillId },
  { kind: 'install', source: '/skills' },
  { kind: 'install', storageId },
]

test.each(commands)(
  'preparing %j reserves required resources and returns a typed execution context',
  async (command) => {
    const f = setup()
    if (command.kind === 'delete-assigned')
      f.rows('agentSkills').push({
        _id: assignmentId,
        ownerId: 'owner',
        homeId,
        skillId,
      })
    const operationId = await start(f.ctx, command)
    const op = (await f.ctx.db.get(operationId))!
    expect(op).toMatchObject({
      kind: command.kind,
      ownerId: f.ctx.userId,
      state: { phase: 'queued' },
      attempt: 1,
    })
    expect(op).not.toHaveProperty('agent')
    if ('agentId' in command) {
      expect(op).toHaveProperty('homeId', homeId)
      expect((await f.ctx.db.get(agentId))?.fileOperationId).toBe(operationId)
    }
    if (command.kind === 'install') {
      expect(op).toHaveProperty('progress', {
        cursor: 0,
        summary: { installed: 0, skipped: 0, failed: 0 },
      })
      expect(op).toHaveProperty(
        'source',
        'source' in command
          ? { kind: 'directory', path: command.source }
          : { kind: 'upload', storageId, ticket: 'owned-ticket' },
      )
    }
    const data = await claimExecution(f.ctx, { operationId, attempt: 1 })
    expect(data?.kind).toBe(command.kind)
    expect(data?.operation.state.phase).toBe('executing')
    if ('agentId' in command) expect(data).toHaveProperty('home._id', homeId)
    expect(await claimExecution(f.ctx, { operationId, attempt: 1 })).toBeNull()
    expect(f.scheduled).toHaveLength(2)
    for (const job of f.scheduled)
      expect(job.args).toEqual({ operationId, attempt: 1 })
  },
)

test.each(['missing', 'foreign', 'wrong-home'])(
  'assigned removal rejects a %s assignment before reserving resources',
  async (invalid) => {
    const f = setup()
    if (invalid !== 'missing')
      f.rows('agentSkills').push({
        _id: assignmentId,
        ownerId: invalid === 'foreign' ? 'other' : 'owner',
        homeId: invalid === 'wrong-home' ? 'other' : homeId,
        skillId,
      })
    await expect(
      start(f.ctx, { kind: 'delete-assigned', agentId, assignmentId }),
    ).rejects.toThrow('Assignment not found')
    expect(f.rows('agentFileOperations')).toHaveLength(0)
    expect(f.scheduled).toHaveLength(0)
  },
)

test('foreign duplicate and upload targets cannot be prepared', async () => {
  const f = setup()
  await f.ctx.db.patch(duplicateId, { ownerId: 'other' as Id<'users'> })
  await expect(
    start(f.ctx, { kind: 'duplicate', agentId, duplicateId }),
  ).rejects.toThrow('not found')
  f.rows('skillUploads')[0]!.ownerId = 'other'
  await expect(start(f.ctx, { kind: 'install', storageId })).rejects.toThrow(
    'not found',
  )
})

test.each(['agent', 'home', 'skill'])(
  'claiming refuses a lost %s reservation and records a controlled failure',
  async (resource) => {
    const f = setup()
    const operationId = await start(f.ctx, { kind: 'assign', agentId, skillId })
    if (resource === 'agent')
      await f.ctx.db.patch(agentId, { fileOperationId: newerId })
    if (resource === 'home')
      await f.ctx.db.patch(homeId, { operationId: newerId })
    if (resource === 'skill')
      await f.ctx.db.patch(skillId, { operationId: newerId })
    expect(await claimExecution(f.ctx, { operationId, attempt: 1 })).toBeNull()
    expect((await f.ctx.db.get(operationId))?.state.phase).toBe('failed')
  },
)

test('claiming rejects changed ownership before filesystem execution', async () => {
  const f = setup()
  const operationId = await start(f.ctx, { kind: 'assign', agentId, skillId })
  await f.ctx.db.patch(skillId, { ownerId: 'other' as Id<'users'> })
  expect(await claimExecution(f.ctx, { operationId, attempt: 1 })).toBeNull()
  expect((await f.ctx.db.get(operationId))?.state.phase).toBe('failed')
})

test('callbacks reject stale attempts and commands outside their execution contract', async () => {
  const f = setup()
  const operationId = await start(f.ctx, {
    kind: 'home',
    agentId,
    destination: '/new',
    copyFiles: true,
  })
  await claimExecution(f.ctx, { operationId, attempt: 1 })
  expect(
    await complete(f.ctx, {
      operationId,
      attempt: 0,
      result: { kind: 'home', path: '/wrong' },
    }),
  ).toBe(false)
  await expect(
    reserveDestination(f.ctx, {
      operationId,
      attempt: 0,
      path: '/new',
      insideData: false,
    }),
  ).rejects.toThrow('expired')
  await expect(
    copyAssignments(f.ctx, { operationId, attempt: 0, ids: [] }),
  ).rejects.toThrow('Invalid')
  await expect(
    complete(f.ctx, { operationId, attempt: 1, result: { kind: 'install' } }),
  ).rejects.toThrow('Unexpected')
})

test('import continuations allocate new attempts and reject every old page callback', async () => {
  const f = setup()
  const operationId = await start(f.ctx, { kind: 'install', source: '/skills' })
  await claimExecution(f.ctx, { operationId, attempt: 1 })
  await continueImport(f.ctx, { operationId, attempt: 1, cursor: 0 })
  expect(await claimExecution(f.ctx, { operationId, attempt: 1 })).toBeNull()
  await claimExecution(f.ctx, { operationId, attempt: 2 })
  await expect(
    prepare(f.ctx, {
      operationId,
      attempt: 1,
      cursor: 0,
      metadata: { name: 'new', description: 'New' },
    }),
  ).rejects.toThrow('no longer running')
  await expect(
    finish(f.ctx, {
      operationId,
      attempt: 1,
      cursor: 0,
      nextCursor: 1,
      outcome: 'skipped',
    }),
  ).rejects.toThrow('no longer running')
  await expect(
    continueImport(f.ctx, { operationId, attempt: 1, cursor: 0 }),
  ).rejects.toThrow('no longer running')
  await fail(f.ctx, { operationId, attempt: 1, message: 'Late' })
  expect((await f.ctx.db.get(operationId))?.state.phase).toBe('executing')
})

test('release preserves newer reservations without advancing the home revision for skill assignments', async () => {
  const f = setup()
  const operationId = await start(f.ctx, { kind: 'assign', agentId, skillId })
  const op = (await f.ctx.db.get(operationId))!
  await f.ctx.db.patch(agentId, { fileOperationId: newerId })
  await f.ctx.db.patch(skillId, { operationId: newerId })
  await releaseOperation(f.ctx, op)
  await releaseOperation(f.ctx, op)
  expect((await f.ctx.db.get(agentId))?.fileOperationId).toBe(newerId)
  expect((await f.ctx.db.get(skillId))?.operationId).toBe(newerId)
  expect((await f.ctx.db.get(homeId))?.revision).toBe(0)
})

test('already deleted targets finish on retry and activity blocks normal retries', async () => {
  const f = setup()
  const operationId = await start(f.ctx, {
    kind: 'delete-library',
    mode: 'keep-copies',
    skillId,
  })
  await fail(f.ctx, { operationId, attempt: 1, message: 'Interrupted' })
  await f.ctx.db.delete(skillId)
  await retry(f.ctx, { operationId })
  expect((await f.ctx.db.get(operationId))?.state.phase).toBe('done')
  const ensure = await start(f.ctx, { kind: 'ensure', agentId })
  await fail(f.ctx, { operationId: ensure, attempt: 1, message: 'Interrupted' })
  f.rows('shellJobs').push({ _id: 'job', agentId })
  await expect(retry(f.ctx, { operationId: ensure })).rejects.toThrow(
    'pending messages',
  )
})

test('import pages preserve their reservation across duplicate preparation and reject mismatched completion', async () => {
  const f = setup()
  const operationId = await start(f.ctx, { kind: 'install', source: '/skills' })
  const args = { operationId, attempt: 1, cursor: 0 }
  await claimExecution(f.ctx, args)
  const metadata = { name: 'new-skill', description: 'New skill' }
  const reserved = await prepare(f.ctx, { ...args, metadata })
  expect(await prepare(f.ctx, { ...args, metadata })).toBe(reserved)
  await expect(
    prepare(f.ctx, { ...args, metadata: { ...metadata, name: 'other-skill' } }),
  ).rejects.toThrow('reservation expired')
  await expect(
    finish(f.ctx, { ...args, nextCursor: 1, outcome: 'failed' }),
  ).rejects.toThrow('reservation expired')
  expect((await f.ctx.db.get(reserved!))?.operationId).toBe(operationId)
  await finish(f.ctx, {
    ...args,
    skillId: reserved!,
    nextCursor: 1,
    outcome: 'installed',
  })
  expect(await f.ctx.db.get(operationId)).toHaveProperty('progress.summary', {
    installed: 1,
    skipped: 0,
    failed: 0,
  })
  await expect(
    finish(f.ctx, {
      ...args,
      skillId: reserved!,
      nextCursor: 1,
      outcome: 'installed',
    }),
  ).rejects.toThrow('no longer running')
})
