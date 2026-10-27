import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { assertAgentAvailable } from '@sb/convex/model/skills/access'
import { complete, fail } from '@sb/convex/model/skills/completion'
import { assignments } from '@sb/convex/model/skills/endpoints'
import { claimExecution } from '@sb/convex/model/skills/execution'
import { run } from '@sb/convex/model/skills/filesAction'
import { prepare } from '@sb/convex/model/skills/imports'
import { list } from '@sb/convex/model/skills/library'
import {
  deletionPreview,
  removeDeletedAssignment,
} from '@sb/convex/model/skills/libraryDeletion'
import { retry, start } from '@sb/convex/model/skills/operations'
import { setEnabled } from '@sb/convex/model/skills/preferences'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { completeFileOperation } from '~/tests/helpers/file-operations'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const skillId = 'review' as Id<'skills'>
const a = 'a' as Id<'agents'>
const b = 'b' as Id<'agents'>
const h1 = 'h1' as Id<'agentHomes'>
const h2 = 'h2' as Id<'agentHomes'>
const assignmentId = 'copy-h1' as Id<'agentSkills'>
const options = { cursor: null, numItems: 20 }

function setup() {
  const f = skillsDatabase()
  f.rows('skills').push({
    _id: skillId,
    ownerId: 'owner',
    name: 'review',
    description: 'Review',
    status: 'ready',
  })
  f.rows('agents').push(
    {
      _id: a,
      ownerId: 'owner',
      name: 'Alpha',
      homeId: h1,
      disabledSkillIds: [skillId],
    },
    { _id: b, ownerId: 'owner', name: 'Beta', homeId: h1 },
  )
  for (const homeId of [h1, h2]) {
    f.rows('agentHomes').push({
      _id: homeId,
      ownerId: 'owner',
      managed: true,
      originAgentId: a,
      path: `/${homeId}`,
      revision: 0,
    })
    f.rows('agentSkills').push({
      _id: `copy-${homeId}`,
      ownerId: 'owner',
      homeId,
      skillId,
      name: 'review',
      description: 'Local workflow',
    })
  }
  return f
}

async function withSidecar<T>(
  f: ReturnType<typeof setup>,
  body: (ctx: ActionCtx, calls: Record<string, unknown>[]) => Promise<T>,
  failCopy = false,
) {
  const fetch = globalThis.fetch
  const secret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'fixture-secret'
  const calls: Record<string, unknown>[] = []
  globalThis.fetch = (async (url, init) => {
    const input = JSON.parse(String(init?.body))
    calls.push({ ...input, route: new URL(String(url)).pathname })
    if (failCopy && input.kind === 'delete-assigned' && input.homeId === h2)
      return new Response('Disk unavailable', { status: 500 })
    return Response.json({ ok: true })
  }) as typeof globalThis.fetch
  const ctx = {
    runMutation: async (
      ref: Parameters<typeof getFunctionName>[0],
      args: never,
    ) => {
      switch (getFunctionName(ref)) {
        case 'skills:_claimExecution':
          return claimExecution(f.ctx, args)
        case 'skills:_complete':
          return complete(f.ctx, args)
        case 'skills:_fail':
          return fail(f.ctx, args)
        case 'skills:_removeDeletedAssignment':
          return removeDeletedAssignment(f.ctx, args)
        default:
          throw new Error('Unexpected mutation')
      }
    },
  } as unknown as ActionCtx
  try {
    return await body(ctx, calls)
  } finally {
    globalThis.fetch = fetch
    if (secret === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = secret
  }
}

test('preview includes shared and orphaned homes, disabled skills, and busy agent names', async () => {
  const f = setup()
  const preview = await deletionPreview(f.ctx, { skillId })
  expect(preview!.homes).toHaveLength(2)
  expect(preview!.homes[0]!.agents.map((agent) => agent.name)).toEqual([
    'Alpha',
    'Beta',
  ])
  expect(preview!.homes[1]!.agents).toEqual([])
  expect(preview!.blockers).toEqual([])
  f.rows('shellJobs').push({ _id: 'job', agentId: b })
  expect(
    (await deletionPreview(f.ctx, { skillId }))!.blockers.join(),
  ).toContain('Beta')
  for (const mode of ['keep-copies', 'delete-all'] as const)
    await expect(
      start(f.ctx, { kind: 'delete-library', mode, skillId }),
    ).rejects.toThrow('Beta')
  expect(f.rows('agentFileOperations')).toHaveLength(0)
  expect(f.rows('agentSkills')).toHaveLength(2)
  await expect(
    deletionPreview({ ...f.ctx, role: 'user' }, { skillId }),
  ).rejects.toThrow('Forbidden')
  await expect(
    deletionPreview(
      { ...f.ctx, userId: 'foreign' as Id<'users'> },
      { skillId },
    ),
  ).rejects.toThrow('not found')
})

test('delete all removes each shared-home copy once, then deletes the library and releases every lease', async () => {
  const f = setup()
  const operationId = await start(f.ctx, {
    kind: 'delete-library',
    mode: 'delete-all',
    skillId,
  })
  await expect(assertAgentAvailable(f.ctx, b)).rejects.toThrow('updated')
  await expect(
    start(f.ctx, { kind: 'duplicate', agentId: b, duplicateId: a }),
  ).rejects.toThrow('finish')
  await expect(
    start(f.ctx, { kind: 'assign', agentId: b, skillId }),
  ).rejects.toThrow('finish')
  await withSidecar(f, async (ctx, calls) => {
    await run(ctx, { operationId, attempt: 1 })
    const deletes = calls.filter((call) => call.kind)
    expect(deletes.map((call) => call.kind)).toEqual([
      'delete-assigned',
      'delete-assigned',
      'delete-library',
    ])
    expect(new Set(deletes.slice(0, 2).map((call) => call.homeId)).size).toBe(2)
    expect(
      calls.filter((call) => call.route === '/agent-files/lock'),
    ).toHaveLength(2)
    expect(
      calls.filter((call) => call.route === '/agent-files/unlock'),
    ).toHaveLength(2)
  })
  expect(f.rows('skills')).toHaveLength(0)
  expect(f.rows('agentSkills')).toHaveLength(0)
  expect((await f.ctx.db.get(operationId))?.state.phase).toBe('done')
  for (const home of f.rows('agentHomes'))
    expect(home.operationId).toBeUndefined()
})

test('keep copies retains catalogs, toggles, search, and independent removal without a library record', async () => {
  const f = setup()
  const operationId = await start(f.ctx, {
    kind: 'delete-library',
    mode: 'keep-copies',
    skillId,
  })
  await withSidecar(f, async (ctx, calls) => {
    await run(ctx, { operationId, attempt: 1 })
    expect(calls.filter((call) => call.kind).map((call) => call.kind)).toEqual([
      'delete-library',
    ])
  })
  expect(f.rows('skills')).toHaveLength(0)
  expect(f.rows('agentSkills')).toHaveLength(2)
  for (const assignment of [undefined, 'added'] as const) {
    const result = await list(f.ctx, {
      agentId: a,
      assignment,
      search: 'rev',
      paginationOpts: options,
    })
    expect(result.page).toHaveLength(1)
    expect(result.page[0]).toMatchObject({
      assignmentId,
      libraryAvailable: false,
      enabled: false,
      description: 'Local workflow',
    })
  }
  expect((await list(f.ctx, { paginationOpts: options })).page).toHaveLength(0)
  expect(
    (
      await assignments(f.ctx, {
        agentId: a,
        enabledOnly: true,
        paginationOpts: options,
      })
    ).page,
  ).toHaveLength(0)
  expect(
    (
      await assignments(f.ctx, {
        agentId: b,
        enabledOnly: true,
        paginationOpts: options,
      })
    ).page,
  ).toHaveLength(1)
  await setEnabled(f.ctx, { agentId: a, assignmentId, enabled: true })
  expect(
    (
      await assignments(f.ctx, {
        agentId: a,
        enabledOnly: true,
        paginationOpts: options,
      })
    ).page,
  ).toHaveLength(1)
  const remove = await start(f.ctx, {
    kind: 'delete-assigned',
    agentId: b,
    assignmentId,
  })
  const removal = await claimExecution(f.ctx, {
    operationId: remove,
    attempt: 1,
  })
  expect(removal).toMatchObject({ assignment: { name: 'review' }, skill: null })
  await completeFileOperation(f.ctx, { operationId: remove })
  expect(
    (await list(f.ctx, { agentId: a, paginationOpts: options })).page,
  ).toHaveLength(0)
})

test('failure keeps library data, releases locks, and retry resumes remaining copies', async () => {
  const f = setup()
  const operationId = await start(f.ctx, {
    kind: 'delete-library',
    mode: 'delete-all',
    skillId,
  })
  await withSidecar(
    f,
    async (ctx) => run(ctx, { operationId, attempt: 1 }),
    true,
  )
  expect(await f.ctx.db.get(skillId)).not.toBeNull()
  expect(f.rows('agentSkills').map((row) => row.homeId)).toEqual([h2])
  expect((await f.ctx.db.get(operationId))?.state.phase).toBe('failed')
  for (const home of f.rows('agentHomes'))
    expect(home.operationId).toBeUndefined()
  await retry(f.ctx, { operationId })
  await expect(
    removeDeletedAssignment(f.ctx, { operationId, attempt: 1, assignmentId }),
  ).rejects.toThrow('expired')
  await withSidecar(f, async (ctx, calls) => {
    await run(ctx, { operationId, attempt: 2 })
    expect(
      calls
        .filter((call) => call.kind === 'delete-assigned')
        .map((call) => call.homeId),
    ).toEqual([h2])
  })
  expect(await f.ctx.db.get(skillId)).toBeNull()
  expect(f.rows('agentSkills')).toHaveLength(0)
})

test('reimport does not replace an existing agent copy and all filters paginate without duplicates', async () => {
  const f = setup()
  await f.ctx.db.delete(skillId)
  const importing = await start(f.ctx, { kind: 'install', source: '/new' })
  await claimExecution(f.ctx, { operationId: importing, attempt: 1 })
  const newId = await prepare(f.ctx, {
    operationId: importing,
    attempt: 1,
    cursor: 0,
    metadata: { name: 'review', description: 'Reimported' },
  })
  expect(newId).not.toBe(skillId)
  await f.ctx.db.patch(newId!, { status: 'ready', operationId: undefined })
  await expect(
    start(f.ctx, { kind: 'assign', agentId: a, skillId: newId! }),
  ).rejects.toThrow('already assigned')
  for (let i = 0; i < 45; i++)
    f.rows('skills').push({
      _id: `skill-${i}`,
      ownerId: 'owner',
      name: `workflow-${String(i).padStart(2, '0')}`,
      description: '',
      status: 'ready',
    })
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const result = await list(f.ctx, {
      agentId: a,
      paginationOpts: { cursor, numItems: 7 },
    })
    ids.push(...result.page.map((row) => row._id))
    cursor = result.isDone ? null : result.continueCursor
  } while (cursor)
  expect(ids).toHaveLength(46)
  expect(new Set(ids).size).toBe(46)
  expect(ids).not.toContain(newId!)
  expect(
    (
      await list(f.ctx, {
        agentId: a,
        assignment: 'not-added',
        search: 'rev',
        paginationOpts: options,
      })
    ).page,
  ).toEqual([])
})
