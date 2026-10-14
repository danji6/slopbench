import type { Id } from '@sb/convex/_generated/dataModel'
import { complete, fail } from '@sb/convex/model/skills/completion'
import {
  copyAssignments,
  reserveDestination,
} from '@sb/convex/model/skills/endpoints'
import { continueImport, prepare } from '@sb/convex/model/skills/imports'
import { releaseOperation } from '@sb/convex/model/skills/lifecycle'
import { retry, running, start } from '@sb/convex/model/skills/operations'
import type { FileOperationArgs } from '@sb/convex/types'
import { expect, test } from 'bun:test'

import { skillsDatabase } from '../helpers/skills-db'

const agentId = 'agent' as Id<'agents'>
const duplicateId = 'duplicate' as Id<'agents'>
const homeId = 'home' as Id<'agentHomes'>
const skillId = 'skill' as Id<'skills'>
const assignmentId = 'assignment' as Id<'agentSkills'>
const storageId = 'upload' as Id<'_storage'>
const newerId = 'newer' as Id<'agentFileOperations'>
const otherOwner = 'other' as Id<'users'>

function setup() {
  const fixture = skillsDatabase()
  fixture
    .rows('agents')
    .push(
      { _id: agentId, ownerId: 'owner', homeId, name: 'Agent' },
      { _id: duplicateId, ownerId: 'owner', name: 'Duplicate' },
    )
  fixture.rows('agentHomes').push({
    _id: homeId,
    ownerId: 'owner',
    originAgentId: agentId,
    managed: true,
    revision: 0,
    path: '/home',
  })
  fixture.rows('skills').push({
    _id: skillId,
    ownerId: 'owner',
    name: 'review',
    description: 'Review',
    status: 'ready',
  })
  fixture.rows('skillUploads').push({
    _id: 'staged',
    ownerId: 'owner',
    storageId,
    ticket: 'owned-ticket',
  })
  return fixture
}

const commands: FileOperationArgs[] = [
  { kind: 'ensure', agentId },
  { kind: 'home', agentId, destination: '/new', copyFiles: true },
  { kind: 'detach', agentId },
  { kind: 'detach', agentId, removeFolder: true },
  { kind: 'duplicate', agentId, duplicateId },
  { kind: 'assign', agentId, skillId },
  { kind: 'delete-assigned', agentId, assignmentId },
  { kind: 'delete-library', skillId },
  { kind: 'install', source: '/skills' },
  { kind: 'install', storageId },
  { kind: 'delete-home' },
]

test.each(commands)(
  'preparing %j persists and claims its resolved targets',
  async (command) => {
    const { ctx, rows, scheduled } = setup()
    if (command.kind === 'delete-assigned')
      rows('agentSkills').push({
        _id: assignmentId,
        ownerId: 'owner',
        homeId,
        skillId,
      })
    const id = await start(ctx, command)
    const op = (await ctx.db.get(id))!
    expect(op).toMatchObject({
      ...command,
      ownerId: ctx.userId,
      status: 'queued',
    })
    expect(op).not.toHaveProperty('agent')
    expect(op).not.toHaveProperty('command')
    if ('agentId' in command) {
      expect(op.homeId).toBe(homeId)
      expect((await ctx.db.get(agentId))?.fileOperationId).toBe(id)
      expect((await ctx.db.get(homeId))?.operationId).toBe(id)
    }
    if (command.kind === 'duplicate') {
      const duplicate = (await ctx.db.get(duplicateId))!
      expect(op.destinationHomeId).toBe(duplicate.homeId)
      expect(duplicate.fileOperationId).toBe(id)
      expect((await ctx.db.get(duplicate.homeId!))?.operationId).toBe(id)
    }
    if (
      ['assign', 'delete-assigned', 'delete-library'].includes(command.kind)
    ) {
      expect(op.skillId).toBe(skillId)
      expect((await ctx.db.get(skillId))?.operationId).toBe(id)
    }
    if (command.kind === 'install') {
      expect(op.importSummary).toEqual({ installed: 0, skipped: 0, failed: 0 })
      expect(op.uploadTicket).toBe(
        'storageId' in command ? 'owned-ticket' : undefined,
      )
    }
    expect(scheduled).toHaveLength(2)
  },
)

test('assignment deletion checks ownership and the shared home identity', async () => {
  for (const assignment of [
    null,
    { ownerId: 'other', homeId },
    { ownerId: 'owner', homeId: 'other-home' },
  ]) {
    const { ctx, rows, scheduled } = setup()
    if (assignment)
      rows('agentSkills').push({ _id: assignmentId, skillId, ...assignment })
    await expect(
      start(ctx, { kind: 'delete-assigned', agentId, assignmentId }),
    ).rejects.toThrow('Assignment not found')
    expect(rows('agentFileOperations')).toHaveLength(0)
    expect((await ctx.db.get(homeId))?.operationId).toBeUndefined()
    expect(scheduled).toHaveLength(0)
  }
})

test('foreign duplicate targets and missing or foreign uploads cannot acquire claims', async () => {
  const { ctx, rows } = setup()
  await ctx.db.patch(duplicateId, { ownerId: otherOwner })
  await expect(
    start(ctx, { kind: 'duplicate', agentId, duplicateId }),
  ).rejects.toThrow('Agent not found')
  await ctx.db.patch('staged' as Id<'skillUploads'>, { ownerId: otherOwner })
  await expect(start(ctx, { kind: 'install', storageId })).rejects.toThrow(
    'Skill upload not found',
  )
  rows('skillUploads').length = 0
  await expect(start(ctx, { kind: 'install', storageId })).rejects.toThrow(
    'Skill upload not found',
  )
  expect(rows('agentFileOperations')).toHaveLength(0)
  expect((await ctx.db.get(agentId))?.fileOperationId).toBeUndefined()
})

test('running starts once and refuses lost agent or skill reservations', async () => {
  for (const target of [agentId, skillId]) {
    const { ctx } = setup()
    const operationId = await start(ctx, { kind: 'assign', agentId, skillId })
    await ctx.db.patch(
      target,
      target === agentId
        ? { fileOperationId: newerId }
        : { operationId: newerId },
    )
    expect(await running(ctx, { operationId })).toBe(false)
    expect((await ctx.db.get(operationId))?.status).toBe('queued')
  }
  const { ctx } = setup()
  const operationId = await start(ctx, { kind: 'ensure', agentId })
  expect(await running(ctx, { operationId })).toBe(1)
  expect(await running(ctx, { operationId })).toBe(false)
})

test('stale completions are ignored while stale destination, copy, and import callbacks reject', async () => {
  const { ctx, rows } = setup()
  const operationId = await start(ctx, {
    kind: 'home',
    agentId,
    destination: '/new',
    copyFiles: true,
  })
  await running(ctx, { operationId })
  await complete(ctx, { operationId, attempt: 0, path: '/new' })
  expect((await ctx.db.get(homeId))?.path).toBe('/home')
  await expect(
    reserveDestination(ctx, { operationId, attempt: 0, path: '/new' }),
  ).rejects.toThrow('expired')
  await expect(
    copyAssignments(ctx, { operationId, attempt: 0, ids: [] }),
  ).rejects.toThrow('Invalid assignment')
  expect(rows('agentHomes')).toHaveLength(1)
  const install = await start(ctx, { kind: 'install', source: '/skills' })
  await running(ctx, { operationId: install })
  await expect(
    prepare(ctx, {
      operationId: install,
      attempt: 0,
      cursor: 0,
      metadata: { name: 'other', description: 'Other' },
    }),
  ).rejects.toThrow('no longer running')
  // Older callers remain supported and continuation still schedules recovery.
  const skill = await prepare(ctx, {
    operationId: install,
    cursor: 0,
    metadata: { name: 'other', description: 'Other' },
  })
  expect(skill).not.toBeNull()
  await continueImport(ctx, { operationId: install, cursor: 0 })
  expect((await ctx.db.get(install))?.status).toBe('queued')
})

test('release preserves newer claims and advances an owned home revision only once', async () => {
  const { ctx } = setup()
  const operationId = await start(ctx, { kind: 'assign', agentId, skillId })
  const op = (await ctx.db.get(operationId))!
  await ctx.db.patch(agentId, { fileOperationId: newerId })
  await ctx.db.patch(skillId, { operationId: newerId })
  await releaseOperation(ctx, op)
  await releaseOperation(ctx, op)
  expect((await ctx.db.get(agentId))?.fileOperationId).toBe(newerId)
  expect((await ctx.db.get(skillId))?.operationId).toBe(newerId)
  expect((await ctx.db.get(homeId))?.revision).toBe(1)
  await ctx.db.patch(homeId, { operationId: newerId })
  await releaseOperation(ctx, op)
  expect((await ctx.db.get(homeId))?.operationId).toBe(newerId)
  expect((await ctx.db.get(homeId))?.revision).toBe(1)
})

test('retry treats already-deleted targets as done and rechecks activity for remaining ones', async () => {
  for (const kind of ['delete-library', 'delete-assigned'] as const) {
    const { ctx, rows } = setup()
    rows('agentSkills').push({
      _id: assignmentId,
      ownerId: 'owner',
      homeId,
      skillId,
    })
    if (kind === 'delete-library') rows('agentSkills').length = 0
    const operationId = await start(
      ctx,
      kind === 'delete-library'
        ? { kind, skillId }
        : { kind, agentId, assignmentId },
    )
    await fail(ctx, { operationId, message: 'Interrupted' })
    await ctx.db.delete(kind === 'delete-library' ? skillId : assignmentId)
    await retry(ctx, { operationId })
    expect((await ctx.db.get(operationId))?.status).toBe('done')
  }
  const { ctx, rows } = setup()
  const operationId = await start(ctx, { kind: 'assign', agentId, skillId })
  await fail(ctx, { operationId, message: 'Interrupted' })
  rows('shellJobs').push({ _id: 'job', agentId })
  await expect(retry(ctx, { operationId })).rejects.toThrow('finish')
  expect((await ctx.db.get(operationId))?.status).toBe('failed')
})
