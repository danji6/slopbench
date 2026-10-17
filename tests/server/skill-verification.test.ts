import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { list } from '@sb/convex/model/skills/library'
import {
  removeMissingSkill,
  verificationTargets,
} from '@sb/convex/model/skills/verification'
import {
  checkLibraryPage,
  removeMissingSkills,
} from '@sb/convex/model/skills/verificationAction'
import type {
  RemoveMissingSkillArgs,
  SkillListArgs,
  VerifySkillIdsArgs,
} from '@sb/convex/types'
import { libraryRoot } from '@sb/sidecar/agent-files/storage'
import { verifyLibrary } from '@sb/sidecar/agent-files/verify-library'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { skillsDatabase } from '../helpers/skills-db'

let root: string
const previousData = process.env.CHAT_SIDECAR_DATA_DIR
const previousSecret = process.env.SIDECAR_SECRET
const originalFetch = globalThis.fetch
let unavailable = false

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'skill-verification-'))
  process.env.CHAT_SIDECAR_DATA_DIR = root
  process.env.SIDECAR_SECRET = 'verification-fixture'
  const { createApp } = await import('@sb/sidecar/main')
  const app = createApp(async (_c, next) => next())
  globalThis.fetch = (async (input, init) => {
    if (unavailable) throw new Error('Sidecar unavailable')
    const url = new URL(String(input))
    return app.request(new Request(`http://fixture${url.pathname}`, init))
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  if (previousData === undefined) delete process.env.CHAT_SIDECAR_DATA_DIR
  else process.env.CHAT_SIDECAR_DATA_DIR = previousData
  if (previousSecret === undefined) delete process.env.SIDECAR_SECRET
  else process.env.SIDECAR_SECRET = previousSecret
  await rm(root, { recursive: true, force: true })
})

function fixture() {
  const db = skillsDatabase()
  const action = {
    auth: { getUserIdentity: async () => ({ subject: 'owner' }) },
    runQuery: async (ref: FunctionReference<'query'>, args: unknown) => {
      switch (getFunctionName(ref)) {
        case 'users:_getRoleBySubject':
          return db.ctx.role
        case 'skills:list':
          return list(db.ctx, args as SkillListArgs)
        case 'skills:verificationTargets':
          return verificationTargets(db.ctx, args as VerifySkillIdsArgs)
        default:
          throw new Error(`Unexpected query ${getFunctionName(ref)}`)
      }
    },
    runMutation: async (ref: FunctionReference<'mutation'>, args: unknown) => {
      expect(getFunctionName(ref)).toBe('skills:_removeMissingSkill')
      return removeMissingSkill(db.ctx, args as RemoveMissingSkillArgs)
    },
  } as unknown as ActionCtx
  function skill(id: string, fields = {}) {
    db.rows('skills').push({
      _id: id,
      ownerId: 'owner',
      name: id,
      status: 'ready',
      description: 'Skill',
      ...fields,
    })
    return id as Id<'skills'>
  }
  return { ...db, action, skill }
}

async function bundle(id: string, content = 'Existing instructions') {
  const folder = path.join(libraryRoot('owner', id), id)
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, 'SKILL.md'), content)
  return folder
}

test('verification checks every page, skips busy entries and does not delete on discovery', async () => {
  const f = fixture()
  for (let i = 0; i < 45; i++) f.skill(`paged-${String(i).padStart(2, '0')}`)
  await bundle('paged-00')
  f.rows('skills')[1]!.operationId = 'active'
  f.rows('skills')[2]!.status = 'installing'
  let cursor: string | null = null
  let checked = 0
  let skipped = 0
  const missing: string[] = []
  while (true) {
    const page = await checkLibraryPage(f.action, {
      paginationOpts: { cursor, numItems: 20 },
    })
    checked += page.checked
    skipped += page.skipped
    missing.push(...page.missing.map((s) => s.name))
    if (page.isDone) break
    cursor = page.continueCursor
  }
  expect(checked).toBe(43)
  expect(skipped).toBe(2)
  expect(missing).toHaveLength(42)
  expect(missing).toContain('paged-44')
  expect(missing).not.toContain('paged-00')
  expect(f.rows('skills')).toHaveLength(45)
})

test('confirmed cleanup rechecks recovered bundles and removes only missing owned records', async () => {
  const f = fixture()
  const missing = f.skill('confirmed-missing')
  const recovered = f.skill('confirmed-recovered')
  f.skill('unconfirmed-missing')
  f.rows('agentSkills').push({
    _id: 'assignment',
    skillId: missing,
    homeId: 'home',
    ownerId: 'owner',
  })
  const page = await checkLibraryPage(f.action, {
    paginationOpts: { cursor: null, numItems: 20 },
  })
  expect(page.missing).toHaveLength(3)
  await bundle(recovered)
  const result = await removeMissingSkills(f.action, {
    skillIds: [missing, recovered],
  })
  expect(result.removed).toBe(1)
  expect(f.rows('skills').map((s) => s._id)).toEqual([
    recovered,
    'unconfirmed-missing',
  ])
  expect(f.rows('agentSkills')).toHaveLength(0)
  expect(
    await Bun.file(
      path.join(libraryRoot('owner', recovered), recovered, 'SKILL.md'),
    ).exists(),
  ).toBe(true)
})

test('connection failures cannot remove library or assignment records', async () => {
  const f = fixture()
  const id = f.skill('offline')
  unavailable = true
  try {
    await expect(
      checkLibraryPage(f.action, {
        paginationOpts: { cursor: null, numItems: 20 },
      }),
    ).rejects.toThrow('Sidecar unavailable')
    await expect(
      removeMissingSkills(f.action, { skillIds: [id] }),
    ).rejects.toThrow('Sidecar unavailable')
  } finally {
    unavailable = false
  }
  expect(f.rows('skills')).toHaveLength(1)
})

test('ownership, admin role, page bounds and active operations protect cleanup', async () => {
  const f = fixture()
  const other = f.skill('other-owner', { ownerId: 'another-owner' })
  await expect(
    removeMissingSkills(f.action, { skillIds: [other] }),
  ).rejects.toThrow('not found')
  await expect(
    verificationTargets(f.ctx, { skillIds: Array(21).fill(other) }),
  ).rejects.toThrow('at most 20')
  const id = f.skill('busy', { operationId: 'operation' })
  expect(
    (await removeMissingSkills(f.action, { skillIds: [id] })).removed,
  ).toBe(0)
  expect(
    await removeMissingSkill(f.ctx, {
      skillId: id,
      ownerId: 'owner' as Id<'users'>,
    }),
  ).toBe(false)
  const reinstalled = f.skill('reinstalled', {
    importOperationId: 'new-import',
  })
  expect(
    await removeMissingSkill(f.ctx, {
      skillId: reinstalled,
      ownerId: 'owner' as Id<'users'>,
    }),
  ).toBe(false)
  f.ctx.role = 'user'
  await expect(
    checkLibraryPage(f.action, {
      paginationOpts: { cursor: null, numItems: 20 },
    }),
  ).rejects.toThrow('Forbidden')
  await expect(
    removeMissingSkills(f.action, { skillIds: [id] }),
  ).rejects.toThrow('Forbidden')
})

test('cleanup refuses assignments in transitioning homes or active agents', async () => {
  const f = fixture()
  const id = f.skill('assigned-busy')
  f.rows('agentHomes').push({ _id: 'home', operationId: 'transition' })
  f.rows('agents').push({ _id: 'agent', ownerId: 'owner', homeId: 'home' })
  f.rows('agentSkills').push({ _id: 'assignment', skillId: id, homeId: 'home' })
  await expect(
    removeMissingSkills(f.action, { skillIds: [id] }),
  ).rejects.toThrow('folder operation')
  f.rows('agentHomes')[0]!.operationId = undefined
  f.rows('streams').push({ _id: 'stream', agentId: 'agent' })
  await expect(
    removeMissingSkills(f.action, { skillIds: [id] }),
  ).rejects.toThrow('turns and tools')
  expect(f.rows('skills')).toHaveLength(1)
  expect(f.rows('agentSkills')).toHaveLength(1)
})

test('verification treats unsafe paths and non-file manifests as errors, preserving malformed files', async () => {
  const folder = await bundle(
    'malformed',
    'Malformed frontmatter still represents data',
  )
  expect(
    await verifyLibrary({
      ownerId: 'owner',
      skills: [{ skillId: 'malformed', name: 'malformed' }],
    }),
  ).toEqual({ missing: [] })
  const symlinkFolder = path.join(libraryRoot('owner', 'linked'), 'linked')
  await mkdir(path.dirname(symlinkFolder), { recursive: true })
  await symlink(folder, symlinkFolder)
  await expect(
    verifyLibrary({
      ownerId: 'owner',
      skills: [{ skillId: 'linked', name: 'linked' }],
    }),
  ).rejects.toThrow('Symlink')
  const directory = path.join(
    libraryRoot('owner', 'directory'),
    'directory',
    'SKILL.md',
  )
  await mkdir(directory, { recursive: true })
  await expect(
    verifyLibrary({
      ownerId: 'owner',
      skills: [{ skillId: 'directory', name: 'directory' }],
    }),
  ).rejects.toThrow('regular file')
  await expect(
    verifyLibrary({
      ownerId: 'owner',
      skills: [{ skillId: 'missing', name: '../escape' }],
    }),
  ).rejects.toThrow('identity')
})
