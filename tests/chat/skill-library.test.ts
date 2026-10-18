import type { Id } from '@sb/convex/_generated/dataModel'
import { getBySessionAgent } from '@sb/convex/model/session/cache'
import { assertAgentAvailable } from '@sb/convex/model/skills/access'
import { assertHomeDestination } from '@sb/convex/model/skills/destinations'
import { reserveDestination } from '@sb/convex/model/skills/endpoints'
import { invalidateHomeCaches } from '@sb/convex/model/skills/invalidation'
import { assigned, list } from '@sb/convex/model/skills/library'
import { start } from '@sb/convex/model/skills/operations'
import { expect, test } from 'bun:test'

import {
  completeFileOperation as complete,
  claimFileOperation as running,
} from '../helpers/file-operations'
import { skillsDatabase } from '../helpers/skills-db'

const agentId = 'agent' as Id<'agents'>
const skillId = 'skill' as Id<'skills'>
function setup() {
  const fixture = skillsDatabase()
  fixture.rows('agents').push({
    _id: agentId,
    ownerId: 'owner',
    name: 'Agent',
    homeId: 'home',
  })
  fixture.rows('agentHomes').push({
    _id: 'home',
    ownerId: 'owner',
    originAgentId: agentId,
    managed: true,
    path: '/old-home',
    revision: 0,
  })
  fixture.rows('skills').push({
    _id: skillId,
    ownerId: 'owner',
    name: 'review',
    description: 'Review changes.',
    status: 'ready',
  })
  return fixture
}

test('ownership and admin checks protect filesystem operation reservations', async () => {
  const { ctx } = setup()
  await expect(
    start({ ...ctx, role: 'user' }, { kind: 'assign', agentId, skillId }),
  ).rejects.toThrow('Forbidden')
  await expect(
    start(
      { ...ctx, userId: 'another-owner' as Id<'users'> },
      { kind: 'assign', agentId, skillId },
    ),
  ).rejects.toThrow('not found')
})

test('pending assignments fence turns and library removal; completion commits the copy', async () => {
  const { ctx, rows } = setup()
  const operationId = await start(ctx, { kind: 'assign', agentId, skillId })
  await expect(assertAgentAvailable(ctx, agentId)).rejects.toThrow('updated')
  await expect(
    start(ctx, { kind: 'delete-library', mode: 'keep-copies', skillId }),
  ).rejects.toThrow('finish')
  await complete(ctx, { operationId })
  expect(rows('agentSkills')).toHaveLength(1)
  expect(rows('agents')[0]!.fileOperationId).toBeUndefined()
  await expect(
    start(ctx, { kind: 'assign', agentId, skillId }),
  ).rejects.toThrow('already assigned')
})

test('library and assignments page through more than the former count limits', async () => {
  const { ctx, rows } = setup()
  for (let i = 0; i < 150; i++)
    rows('skills').push({
      _id: `skill-${i}`,
      ownerId: 'owner',
      name: `skill-${String(i).padStart(3, '0')}`,
      description: 'Skill',
      status: 'ready',
    })
  for (let i = 0; i < 60; i++)
    rows('agentSkills').push({
      _id: `assignment-${i}`,
      ownerId: 'owner',
      homeId: 'home',
      skillId,
      name: `assigned-${String(i).padStart(3, '0')}`,
      description: 'Skill',
    })
  let cursor: string | null = null
  let count = 0
  while (true) {
    const page = await list(ctx, { paginationOpts: { cursor, numItems: 20 } })
    count += page.page.length
    if (page.isDone) {
      break
    }
    cursor = page.continueCursor
  }
  expect(count).toBe(151)
  const first = await assigned(ctx, {
    agentId,
    paginationOpts: { cursor: null, numItems: 20 },
  })
  const second = await assigned(ctx, {
    agentId,
    paginationOpts: { cursor: first.continueCursor, numItems: 20 },
  })
  expect(first.page).toHaveLength(20)
  expect(second.page[0]!.name).toBe('assigned-020')
})

test('custom homes cannot overlap another owner’s current or reserved home', async () => {
  const { ctx, rows } = setup()
  rows('agentHomes').push(
    { _id: 'other', ownerId: 'another-owner', path: '/custom/other' },
    {
      _id: 'reserved',
      ownerId: 'another-owner',
      path: '/reserved',
      operationId: 'pending',
    },
  )
  await expect(assertHomeDestination(ctx, agentId, '/custom')).rejects.toThrow(
    'overlap',
  )
  await expect(
    assertHomeDestination(ctx, agentId, '/custom/other/child'),
  ).rejects.toThrow('overlap')
  await expect(
    assertHomeDestination(ctx, agentId, '/reserved'),
  ).rejects.toThrow('owner')
  await assertHomeDestination(ctx, agentId, '/custom/other-sibling')
})

test('home transition revokes old home grants before releasing the agent', async () => {
  const { ctx, rows } = setup()
  rows('sessionCache').push({ _id: 'cache', sessionId: 'session', agentId })
  rows('sessionState').push({
    _id: 'state',
    sessionId: 'session',
    toolApprovals: {
      paths: ['/old-home', '/old-home/notes', '/project', '.'],
      tools: ['write_file'],
    },
  })
  const operationId = await start(ctx, {
    kind: 'home',
    agentId,
    destination: '/new-home',
    copyFiles: true,
  })
  await running(ctx, { operationId })
  await reserveDestination(ctx, {
    operationId,
    attempt: 1,
    path: '/new-home',
    insideData: false,
  })
  await complete(ctx, {
    operationId,
    path: '/new-home',
  })
  expect(rows('agents')[0]!.fileOperationId).toBe(operationId)
  await invalidateHomeCaches(ctx, {
    operationId,
    attempt: 1,
    cursor: null,
  })
  expect(rows('agents')[0]!.fileOperationId).toBeUndefined()
  expect(rows('sessionState')[0]!.toolApprovals).toEqual({
    paths: ['/project', '.'],
    tools: ['write_file'],
  })
})

test('a filesystem-authorized prompt snapshot cannot cross into an unprivileged invocation', async () => {
  const { ctx, rows } = setup()
  const sessionId = 'session' as Id<'sessions'>
  rows('sessions').push({ _id: sessionId, ownerId: 'owner' })
  rows('sessionCache').push({
    _id: 'cache',
    sessionId,
    agentId,
    homeId: 'home',
    homeRevision: 0,
    filesystemAccess: true,
    workspaceRevision: '[]',
    items: [{ content: 'Previously read personal file' }],
  })
  expect(await getBySessionAgent(ctx, sessionId, agentId, true)).not.toBeNull()
  expect(await getBySessionAgent(ctx, sessionId, agentId, false)).toBeNull()
})

test('operation arguments cannot smuggle storage cleanup authority into home changes', async () => {
  const { ctx, rows } = setup()
  await expect(
    start(ctx, {
      kind: 'home',
      agentId,
      destination: '/new',
      copyFiles: true,
      // @ts-expect-error Home commands cannot carry upload cleanup authority.
      storageId: 'foreign-upload' as Id<'_storage'>,
    }),
  ).rejects.toThrow('Invalid arguments')
  expect(rows('agentFileOperations')).toHaveLength(0)
})

test('orphaned processing messages and watched jobs block home transitions', async () => {
  const { ctx, rows } = setup()
  rows('messages').push({
    _id: 'processing',
    sender: { type: 'agent', id: agentId },
    status: 'processing',
  })
  await expect(
    start(ctx, { kind: 'home', agentId, destination: '/new', copyFiles: true }),
  ).rejects.toThrow('pending messages')
  rows('messages').length = 0
  rows('shellJobs').push({ _id: 'job', agentId })
  await expect(
    start(ctx, { kind: 'home', agentId, destination: '/new', copyFiles: true }),
  ).rejects.toThrow('shell jobs')
})

test('library keeps assigned skills and filters assignments across pages and shared homes', async () => {
  const { ctx, rows } = setup()
  rows('agents').push({ _id: 'shared-agent', ownerId: 'owner', homeId: 'home' })
  rows('agentSkills').push({
    _id: 'assignment',
    ownerId: 'owner',
    homeId: 'home',
    skillId,
    name: 'review',
    description: 'An edited local description.',
  })
  rows('agentSkills').push({
    _id: 'foreign-assignment',
    ownerId: 'other',
    homeId: 'other-home',
    skillId,
    name: 'review',
    description: 'Foreign copy.',
  })
  for (let i = 0; i < 25; i++)
    rows('skills').push({
      _id: `extra-${i}`,
      ownerId: 'owner',
      name: `extra-${i}`,
      description: 'Extra skill',
      status: 'ready',
    })
  const args = {
    agentId: 'shared-agent' as Id<'agents'>,
    paginationOpts: { cursor: null, numItems: 20 },
  }
  const assignmentId = 'assignment' as Id<'agentSkills'>
  const added = await list(ctx, { ...args, assignment: 'added' })
  expect(added.page.map((skill) => skill.assignmentId)).toEqual([assignmentId])
  expect(added.page[0]!.description).toBe('An edited local description.')
  expect(added.isDone).toBe(true)
  const missing = await list(ctx, {
    ...args,
    assignment: 'added',
    search: 'extra',
  })
  expect(missing.page).toHaveLength(0)
  const all = await list(ctx, { ...args, search: ' REVIEW ' })
  expect(all.page.map((skill) => skill.assignmentId)).toEqual([assignmentId])
  const notAdded = await list(ctx, {
    ...args,
    assignment: 'not-added',
    search: 'review',
  })
  expect(notAdded.page).toHaveLength(0)
  const available = await list(ctx, {
    ...args,
    agentId,
    assignment: 'not-added',
    search: 'extra',
  })
  expect(available.page).toHaveLength(20)
  rows('agents').push({ _id: 'no-home', ownerId: 'owner' })
  const noHome = { ...args, agentId: 'no-home' as Id<'agents'> }
  expect(
    (await list(ctx, { ...noHome, assignment: 'added' })).page,
  ).toHaveLength(0)
  expect(
    (await list(ctx, { ...noHome, assignment: 'not-added' })).page,
  ).toHaveLength(20)
  await expect(
    list({ ...ctx, role: 'user' }, { ...args, assignment: 'added' }),
  ).rejects.toThrow('Forbidden')
  await expect(
    list(
      { ...ctx, userId: 'other' as Id<'users'> },
      { ...args, assignment: 'added' },
    ),
  ).rejects.toThrow('not found')
})
