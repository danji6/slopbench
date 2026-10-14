import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { fail } from '@sb/convex/model/skills/completion'
import * as Endpoints from '@sb/convex/model/skills/endpoints'
import { claimExecution } from '@sb/convex/model/skills/execution'
import { run } from '@sb/convex/model/skills/filesAction'
import { bindHome, ensureHome } from '@sb/convex/model/skills/homes'
import { invalidateHomeCaches } from '@sb/convex/model/skills/invalidation'
import { start } from '@sb/convex/model/skills/operations'
import { cleanupRecords } from '@sb/convex/model/skills/removal'
import { lockAgent, unlockAgent } from '@sb/sidecar/agent-files/access'
import { resolveDestination } from '@sb/sidecar/agent-files/destination'
import { homeInfo, runFileOperation } from '@sb/sidecar/agent-files/operations'
import { libraryRoot, managedHome } from '@sb/sidecar/agent-files/storage'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { completeFileOperation as complete } from '../helpers/file-operations'
import { skillsDatabase } from '../helpers/skills-db'

const agentId = 'agent' as Id<'agents'>
const skillId = 'review' as Id<'skills'>

async function fixture(
  check: (fixture: ReturnType<typeof skillsDatabase>) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'home-lifecycle-'))
  const previousData = process.env.CHAT_SIDECAR_DATA_DIR
  const previousSecret = process.env.SIDECAR_SECRET
  const previousFetch = globalThis.fetch
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
  process.env.SIDECAR_SECRET = 'fixture-secret'
  const db = skillsDatabase()
  db.rows('agents').push({
    _id: agentId,
    ownerId: 'owner',
    name: 'Agent',
  })
  db.rows('skills').push({
    _id: skillId,
    ownerId: 'owner',
    name: 'review',
    description: 'Review code',
    status: 'ready',
  })
  const library = path.join(libraryRoot('owner', skillId), 'review')
  await mkdir(library, { recursive: true })
  await writeFile(
    path.join(library, 'SKILL.md'),
    '---\nname: review\ndescription: Review code\n---\nPristine instructions',
  )
  globalThis.fetch = (async (url, init) => {
    const input = JSON.parse(String(init?.body))
    const route = new URL(String(url)).pathname
    if (route === '/agent-files/lock') {
      await lockAgent(input.agentId, input.token)
      return Response.json({ ok: true })
    }
    if (route === '/agent-files/unlock') {
      unlockAgent(input.agentId, input.token)
      return Response.json({ ok: true })
    }
    if (route === '/agent-files/destination')
      return Response.json(await resolveDestination(input))
    if (route === '/agent-files/operation')
      return Response.json(await runFileOperation(input))
    if (route === '/agent-files/home')
      return Response.json(await homeInfo(input))
    throw new Error(`Unexpected sidecar route: ${route}`)
  }) as typeof fetch
  try {
    await check(db)
  } finally {
    globalThis.fetch = previousFetch
    if (previousData === undefined) delete process.env.CHAT_SIDECAR_DATA_DIR
    else process.env.CHAT_SIDECAR_DATA_DIR = previousData
    if (previousSecret === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = previousSecret
    await rm(root, { recursive: true, force: true })
  }
}

function actionContext({ ctx }: ReturnType<typeof skillsDatabase>): ActionCtx {
  const handlers = {
    'skills:_agent': Endpoints.agent,
    'skills:_assignments': Endpoints.assignments,
    'skills:_claimExecution': claimExecution,
    'skills:_reserveDestination': Endpoints.reserveDestination,
    'skills:_copyAssignments': Endpoints.copyAssignments,
    'skills:_complete': complete,
    'skills:_fail': fail,
  }
  const invoke = async (
    reference: Parameters<typeof getFunctionName>[0],
    args: unknown,
  ) => {
    const name = getFunctionName(reference)
    const handler = handlers[name as keyof typeof handlers]
    if (!handler) throw new Error(`Unexpected backend endpoint: ${name}`)
    return (
      handler as (context: typeof ctx, args: unknown) => Promise<unknown>
    )(ctx, args)
  }
  return { runQuery: invoke, runMutation: invoke } as unknown as ActionCtx
}

async function assign(f: ReturnType<typeof skillsDatabase>) {
  const created = await ensureHome(f.ctx, (await f.ctx.db.get(agentId))!)
  await f.ctx.db.patch(created._id, { path: managedHome('owner', agentId) })
  const home = (await f.ctx.db.get(created._id))!
  await f.ctx.db.insert('agentSkills', {
    homeId: home._id,
    ownerId: 'owner' as Id<'users'>,
    skillId,
    name: 'review',
    description: 'Review code',
  })
  return home
}

test('durable initialization recreates a missing shared managed home with all pristine assignments', async () => {
  await fixture(async (f) => {
    const home = await assign(f)
    const other = 'other' as Id<'agents'>
    f.rows('agents').push({ _id: other, ownerId: 'owner', name: 'Other' })
    await bindHome(f.ctx, other, home)
    const operationId = await start(f.ctx, { kind: 'ensure', agentId: other })
    await run(actionContext(f), { operationId, attempt: 1 })
    expect((await f.ctx.db.get(operationId))?.state.phase).toBe('done')
    expect((await f.ctx.db.get(agentId))?.homeId).toBe(home._id)
    expect((await f.ctx.db.get(other))?.homeId).toBe(home._id)
    expect(f.rows('agentHomes')).toHaveLength(1)
    expect(
      await readFile(
        path.join(home.path!, '.agents/skills/review/SKILL.md'),
        'utf8',
      ),
    ).toContain('Pristine instructions')
  })
})

test('durable folder changes recover a missing custom source and carry its assignment records forward', async () => {
  await fixture(async (f) => {
    const home = await assign(f)
    const custom = await mkdtemp(path.join(tmpdir(), 'custom-home-recovery-'))
    try {
      await f.ctx.db.patch(home._id, {
        managed: false,
        path: `${custom}-missing-source`,
      })
      await bindHome(f.ctx, agentId, (await f.ctx.db.get(home._id))!)
      const operationId = await start(f.ctx, {
        kind: 'home',
        agentId,
        destination: custom,
        copyFiles: true,
      })
      await run(actionContext(f), { operationId, attempt: 1 })
      expect((await f.ctx.db.get(operationId))?.state.phase).not.toBe('failed')
      await invalidateHomeCaches(f.ctx, {
        operationId,
        attempt: 1,
        cursor: null,
      })
      expect((await f.ctx.db.get(operationId))?.state.phase).toBe('done')
      expect(
        (await f.ctx.db.get((await f.ctx.db.get(agentId))!.homeId!))?.path,
      ).toBe(custom)
      expect(
        await readFile(
          path.join(custom, '.agents/skills/review/SKILL.md'),
          'utf8',
        ),
      ).toContain('Pristine instructions')
      expect(f.rows('agentSkills')).toHaveLength(2)
    } finally {
      await rm(custom, { recursive: true, force: true })
    }
  })
})

test('durable managed-folder deletion detaches the agent and removes its assignments after disk cleanup', async () => {
  await fixture(async (f) => {
    const home = await assign(f)
    await mkdir(home.path!, { recursive: true })
    await writeFile(path.join(home.path!, 'note.txt'), 'User file')
    const operationId = await start(f.ctx, {
      kind: 'detach',
      agentId,
      removeFolder: true,
    })
    await run(actionContext(f), { operationId, attempt: 1 })
    expect((await f.ctx.db.get(operationId))?.state.phase).not.toBe('failed')
    await invalidateHomeCaches(f.ctx, {
      operationId,
      attempt: 1,
      cursor: null,
    })
    await cleanupRecords(f.ctx, { operationId, attempt: 1 })
    expect((await f.ctx.db.get(agentId))?.homeId).toBeUndefined()
    await expect(readFile(path.join(home.path!, 'note.txt'))).rejects.toThrow()
    expect(f.rows('agentSkills')).toHaveLength(0)
    expect(f.rows('agentHomes')).toHaveLength(0)
  })
})
