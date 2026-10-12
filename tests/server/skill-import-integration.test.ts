import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { complete, fail } from '@sb/convex/model/skills/completion'
import { run } from '@sb/convex/model/skills/filesAction'
import {
  continueImport,
  finish,
  prepare,
} from '@sb/convex/model/skills/imports'
import { retry, running, start } from '@sb/convex/model/skills/operations'
import type {
  CompleteAgentFileArgs,
  FinishSkillImportArgs,
  PrepareSkillImportArgs,
} from '@sb/convex/types'
import { agentFilesRoutes } from '@sb/sidecar/agent-files/routes'
import { libraryRoot } from '@sb/sidecar/agent-files/storage'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { skillsDatabase } from '../helpers/skills-db'

let root: string
const previousData = process.env.CHAT_SIDECAR_DATA_DIR
const previousSecret = process.env.SIDECAR_SECRET
const originalFetch = globalThis.fetch
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'skill-import-integration-'))
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
  process.env.SIDECAR_SECRET = 'fixture-secret'
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.startsWith('/agent-files/')) {
      return agentFilesRoutes.request(
        new Request(
          `http://fixture${url.pathname.slice('/agent-files'.length)}`,
          init,
        ),
      )
    }
    return originalFetch(input, init)
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

function fixtureAction(fixture: ReturnType<typeof skillsDatabase>) {
  const { ctx, db } = fixture
  return {
    runQuery: async (_reference: unknown, args: { operationId: string }) => {
      const operation = await db.get(args.operationId)
      return operation
        ? {
            operation: structuredClone(operation),
            agent: null,
            skill: operation.skillId
              ? await db.get(String(operation.skillId))
              : null,
          }
        : null
    },
    runMutation: async (reference: unknown, args: unknown) => {
      switch (getFunctionName(reference as FunctionReference<'mutation'>)) {
        case 'skills:_running':
          return running(
            ctx,
            args as { operationId: Id<'agentFileOperations'> },
          )
        case 'skills:_prepareImportSkill':
          return prepare(ctx, args as PrepareSkillImportArgs)
        case 'skills:_finishImportSkill':
          return finish(ctx, args as FinishSkillImportArgs)
        case 'skills:_continueImport':
          return continueImport(
            ctx,
            args as { operationId: Id<'agentFileOperations'>; cursor: number },
          )
        case 'skills:_complete':
          return complete(ctx, args as CompleteAgentFileArgs)
        case 'skills:_fail':
          return fail(
            ctx,
            args as { operationId: Id<'agentFileOperations'>; message: string },
          )
        default:
          throw new Error('Unexpected fixture mutation')
      }
    },
  } as unknown as ActionCtx
}

async function drain(
  fixture: ReturnType<typeof skillsDatabase>,
  id: Id<'agentFileOperations'>,
) {
  for (
    let i = 0;
    i < 10 && (await fixture.db.get(id))?.status === 'queued';
    i++
  )
    await run(fixtureAction(fixture), id)
}

async function writeSkill(directory: string, name: string) {
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test ${name}.\nUnindented description continuation.\n---\nInstructions.`,
  )
}

test('repository import installs all pages, skips duplicate copies, keeps resources, and retries only failures', async () => {
  const fixture = skillsDatabase()
  const source = path.join(root, 'repository')
  for (let i = 0; i < 25; i++)
    await writeSkill(path.join(source, 'skills', `skill-${i}`), `skill-${i}`)
  await writeSkill(path.join(source, '.agents', 'skills', 'copy'), 'skill-5')
  const failed = path.join(source, 'broken')
  await mkdir(failed)
  await writeFile(path.join(failed, 'SKILL.md'), 'Broken frontmatter')
  await writeFile(
    path.join(source, 'skills', 'skill-8', 'resource.bin'),
    Buffer.from([0, 1, 255]),
  )
  fixture.rows('skills').push({
    _id: 'existing',
    ownerId: 'owner',
    name: 'skill-0',
    description: 'Existing pristine skill',
    status: 'ready',
  })
  const operationId = await start(fixture.ctx, { kind: 'install', source })
  await drain(fixture, operationId)
  const op = await fixture.db.get(operationId)
  expect(op?.status).toBe('failed')
  expect(op?.importSummary).toEqual({ installed: 24, skipped: 2, failed: 1 })
  expect(op?.error).not.toContain(' at ')
  expect(fixture.rows('skills')).toHaveLength(25)
  const installed = fixture
    .rows('skills')
    .find((skill) => skill.name === 'skill-8')!
  expect(
    await readFile(
      path.join(libraryRoot('owner', installed._id), 'skill-8', 'resource.bin'),
    ),
  ).toEqual(Buffer.from([0, 1, 255]))
  expect((await fixture.db.get('existing'))?.description).toBe(
    'Existing pristine skill',
  )
  await writeSkill(failed, 'repaired')
  await retry(fixture.ctx, { operationId })
  await drain(fixture, operationId)
  expect((await fixture.db.get(operationId))?.status).toBe('done')
  expect((await fixture.db.get(operationId))?.importSummary).toEqual({
    installed: 1,
    skipped: 26,
    failed: 0,
  })
  expect(fixture.rows('skills')).toHaveLength(26)
})

test('a failed bundle copy leaves other installs usable and a retry retains prior copied customizations', async () => {
  const fixture = skillsDatabase()
  await fixture.db.insert('agentFileOperations', { status: 'done' })
  const source = path.join(root, 'copy-failure')
  await writeSkill(path.join(source, 'one'), 'one')
  await writeSkill(path.join(source, 'two'), 'two')
  await symlink(
    '/missing-resource',
    path.join(source, 'two', 'unsupported-link'),
  )
  const operationId = await start(fixture.ctx, { kind: 'install', source })
  await drain(fixture, operationId)
  expect((await fixture.db.get(operationId))?.importSummary).toEqual({
    installed: 1,
    skipped: 0,
    failed: 1,
  })
  const one = fixture.rows('skills').find((skill) => skill.name === 'one')!
  const bundle = path.join(libraryRoot('owner', one._id), 'one')
  await writeFile(path.join(bundle, 'retained.txt'), 'Retain on retry')
  await rm(path.join(source, 'two', 'unsupported-link'))
  await retry(fixture.ctx, { operationId })
  await drain(fixture, operationId)
  expect((await fixture.db.get(operationId))?.status).toBe('done')
  expect(await readFile(path.join(bundle, 'retained.txt'), 'utf8')).toBe(
    'Retain on retry',
  )
  const two = fixture.rows('skills').find((skill) => skill.name === 'two')!
  expect(
    (
      await stat(path.join(libraryRoot('owner', two._id), 'two', 'SKILL.md'))
    ).isFile(),
  ).toBe(true)
})
