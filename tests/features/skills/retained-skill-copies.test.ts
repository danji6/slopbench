import { readSkillMetadata } from '@sb/sidecar/agent-files/metadata'
import { runFileOperation } from '@sb/sidecar/agent-files/operations'
import {
  libraryRoot,
  managedHome,
  operationRoot,
} from '@sb/sidecar/agent-files/storage'
import { afterAll, beforeAll, expect, test } from 'bun:test'
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

let root: string
const previousData = process.env.CHAT_SIDECAR_DATA_DIR
const ownerId = 'owner'
const name = 'code-review'
const skillId = 'original'
const content =
  '---\nname: code-review\ndescription: Agent edited workflow.\n---\nLocal instructions.'

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'retained-skills-'))
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
  const source = path.join(root, 'bundle')
  await mkdir(source)
  await writeFile(path.join(source, 'SKILL.md'), content)
  await runFileOperation({
    id: 'install',
    kind: 'install',
    ownerId,
    skillId,
    source,
  })
  await runFileOperation({
    id: 'assign',
    kind: 'assign',
    ownerId,
    skillId,
    agentId: 'a',
    name,
  })
  await writeFile(
    path.join(managedHome(ownerId, 'a'), 'skills', name, 'edited.txt'),
    'Agent notes',
  )
  await runFileOperation({
    id: 'remove-library',
    kind: 'delete-library',
    ownerId,
    skillId,
  })
})

afterAll(async () => {
  if (previousData === undefined) delete process.env.CHAT_SIDECAR_DATA_DIR
  else process.env.CHAT_SIDECAR_DATA_DIR = previousData
  await rm(root, { recursive: true, force: true })
})

test('retained copies remain readable and duplication preserves their edits without a library bundle', async () => {
  await expect(stat(libraryRoot(ownerId, skillId))).rejects.toThrow()
  const skill = path.join(managedHome(ownerId, 'a'), 'skills', name)
  expect((await readSkillMetadata(skill)).description).toBe(
    'Agent edited workflow.',
  )
  await runFileOperation({
    id: 'duplicate',
    kind: 'duplicate',
    ownerId,
    agentId: 'a',
    destination: 'b',
  })
  expect(
    await readFile(
      path.join(managedHome(ownerId, 'b'), 'skills', name, 'edited.txt'),
      'utf8',
    ),
  ).toBe('Agent notes')
})

test('a fresh home can stage a retained copy from its current home and preserve agent edits', async () => {
  const destination = path.join(root, 'fresh-home')
  await mkdir(destination)
  await runFileOperation({
    id: 'prepare',
    kind: 'prepare-home',
    ownerId,
    agentId: 'a',
    destination,
    copyFiles: false,
  })
  const staging = {
    id: 'stage',
    kind: 'stage-home-skill' as const,
    ownerId,
    agentId: 'a',
    skillId,
    name,
    homeOperationId: 'prepare',
    sourceHome: { originAgentId: 'a' },
  }
  await runFileOperation(staging)
  await runFileOperation(staging)
  await runFileOperation({
    id: 'publish',
    kind: 'publish-home',
    ownerId,
    agentId: 'a',
    homeOperationId: 'prepare',
  })
  expect(
    await readFile(path.join(destination, 'skills', name, 'SKILL.md'), 'utf8'),
  ).toBe(content)
  expect(
    await readFile(
      path.join(destination, 'skills', name, 'edited.txt'),
      'utf8',
    ),
  ).toBe('Agent notes')
  expect(
    await readFile(
      path.join(managedHome(ownerId, 'a'), 'skills', name, 'edited.txt'),
      'utf8',
    ),
  ).toBe('Agent notes')
})

test('missing retained sources fail clearly and assigned removal rejects symlinks and tolerates missing targets', async () => {
  const input = {
    id: 'missing-stage',
    kind: 'stage-home-skill' as const,
    ownerId,
    agentId: 'a',
    name: 'absent',
    homeOperationId: 'missing-prepare',
    sourceHome: { originAgentId: 'a' },
  }
  await mkdir(path.join(operationRoot('missing-prepare'), 'home'), {
    recursive: true,
  })
  await expect(runFileOperation(input)).rejects.toThrow('cannot be restored')
  const external = path.join(root, 'external')
  await mkdir(external)
  await writeFile(path.join(external, 'keep.txt'), 'untouched')
  await symlink(
    external,
    path.join(managedHome(ownerId, 'a'), 'skills', 'linked'),
  )
  await expect(
    runFileOperation({
      id: 'linked-delete',
      kind: 'delete-assigned',
      ownerId,
      agentId: 'a',
      name: 'linked',
    }),
  ).rejects.toThrow()
  expect(await readFile(path.join(external, 'keep.txt'), 'utf8')).toBe(
    'untouched',
  )
  const deletion = {
    id: 'missing-delete',
    kind: 'delete-assigned' as const,
    ownerId,
    agentId: 'a',
    name: 'absent',
  }
  expect(await runFileOperation(deletion)).toEqual({ ok: true })
  expect(await runFileOperation(deletion)).toEqual({ ok: true })
})
