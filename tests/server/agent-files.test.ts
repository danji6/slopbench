import {
  lockAgent,
  unlockAgent,
  withAgentFiles,
} from '@sb/sidecar/agent-files/access'
import { publishTree } from '@sb/sidecar/agent-files/merge'
import { readSkillMetadata } from '@sb/sidecar/agent-files/metadata'
import { homeInfo, runFileOperation } from '@sb/sidecar/agent-files/operations'
import {
  libraryRoot,
  managedHome,
  operationRoot,
} from '@sb/sidecar/agent-files/storage'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let root: string
let source: string
const owner = 'owner'
const skillId = 'review'
const previousData = process.env.CHAT_SIDECAR_DATA_DIR
const metadata =
  '---\nname: code-review\ndescription: Review code changes.\n---\nFollow the checklist.\n'

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-files-'))
  process.env.CHAT_SIDECAR_DATA_DIR = path.join(root, 'data')
  source = path.join(root, 'source')
  await mkdir(path.join(source, 'scripts'), { recursive: true })
  await writeFile(path.join(source, 'SKILL.md'), metadata)
  await writeFile(
    path.join(source, 'scripts', 'check.sh'),
    '#!/bin/sh\necho check\n',
  )
  await chmod(path.join(source, 'scripts', 'check.sh'), 0o755)
})
afterAll(async () => {
  if (previousData === undefined) {
    delete process.env.CHAT_SIDECAR_DATA_DIR
  } else {
    process.env.CHAT_SIDECAR_DATA_DIR = previousData
  }
  await rm(root, { recursive: true, force: true })
})

describe('personal homes and independent skills', () => {
  test('installs complete bundles including binaries exceeding the former file cap', async () => {
    const binary = await open(path.join(source, 'model.bin'), 'w')
    await binary.truncate(26 * 1024 * 1024)
    await binary.close()
    for (let i = 0; i < 501; i++)
      await writeFile(path.join(source, `resource-${i}`), 'resource')
    const result = await runFileOperation({
      id: 'install',
      kind: 'install',
      ownerId: owner,
      skillId,
      source,
    })
    expect(result).toEqual({
      name: 'code-review',
      description: 'Review code changes.',
    })
    const installed = path.join(libraryRoot(owner, skillId), 'code-review')
    expect((await stat(path.join(installed, 'model.bin'))).size).toBe(
      26 * 1024 * 1024,
    )
    expect(
      (await stat(path.join(installed, 'scripts', 'check.sh'))).mode & 0o111,
    ).not.toBe(0)
    expect(
      await runFileOperation({
        id: 'install',
        kind: 'install',
        ownerId: owner,
        skillId,
        source,
      }),
    ).toEqual(result)
  })

  test('copies are independent and delete/reassign restores all pristine files', async () => {
    for (const agentId of ['a', 'b'])
      await runFileOperation({
        id: `assign-${agentId}`,
        kind: 'assign',
        ownerId: owner,
        agentId,
        skillId,
        name: 'code-review',
      })
    const a = path.join(
      managedHome(owner, 'a'),
      '.agents',
      'skills',
      'code-review',
    )
    const b = path.join(
      managedHome(owner, 'b'),
      '.agents',
      'skills',
      'code-review',
    )
    await writeFile(path.join(a, 'SKILL.md'), 'customized')
    await writeFile(path.join(a, 'added.txt'), 'extra')
    expect(await readFile(path.join(b, 'SKILL.md'), 'utf8')).toBe(metadata)
    await runFileOperation({
      id: 'delete-a',
      kind: 'delete-assigned',
      ownerId: owner,
      agentId: 'a',
      name: 'code-review',
    })
    await runFileOperation({
      id: 'restore-a',
      kind: 'assign',
      ownerId: owner,
      agentId: 'a',
      skillId,
      name: 'code-review',
    })
    expect(await readFile(path.join(a, 'SKILL.md'), 'utf8')).toBe(metadata)
    await expect(stat(path.join(a, 'added.txt'))).rejects.toThrow()
    expect(
      await runFileOperation({
        id: 'restore-a',
        kind: 'assign',
        ownerId: owner,
        agentId: 'a',
        skillId,
        name: 'code-review',
      }),
    ).toEqual({ ok: true })
  })

  test('carry-over preserves the old home and never overwrites destination conflicts', async () => {
    const home = await homeInfo({
      ownerId: owner,
      agentId: 'move',
      revision: 0,
    })
    await writeFile(path.join(home.path, 'notes.md'), 'personal notes')
    const target = path.join(root, 'custom-home')
    await mkdir(target)
    await writeFile(path.join(target, 'notes.md'), 'existing')
    await runFileOperation({
      id: 'prepare-move',
      kind: 'prepare-home',
      ownerId: owner,
      agentId: 'move',
      destination: target,
      copyFiles: true,
    })
    await expect(
      runFileOperation({
        id: 'publish-move',
        kind: 'publish-home',
        ownerId: owner,
        homeOperationId: 'prepare-move',
      }),
    ).rejects.toThrow('already exists')
    expect(await readFile(path.join(target, 'notes.md'), 'utf8')).toBe(
      'existing',
    )
    expect(await readFile(path.join(home.path, 'notes.md'), 'utf8')).toBe(
      'personal notes',
    )
    await rm(path.join(target, 'notes.md'))
    await runFileOperation({
      id: 'publish-move',
      kind: 'publish-home',
      ownerId: owner,
      homeOperationId: 'prepare-move',
    })
    expect(await readFile(path.join(target, 'notes.md'), 'utf8')).toBe(
      'personal notes',
    )
  })

  test('fresh home receives pristine assignments without carrying customized files', async () => {
    const home = managedHome(owner, 'a')
    await writeFile(path.join(home, 'notes.md'), 'keep at original location')
    await writeFile(
      path.join(home, '.agents', 'skills', 'code-review', 'SKILL.md'),
      'modified',
    )
    const destination = path.join(root, 'fresh-home')
    await mkdir(destination)
    await runFileOperation({
      id: 'prepare-fresh',
      kind: 'prepare-home',
      ownerId: owner,
      agentId: 'a',
      destination,
      copyFiles: false,
    })
    await runFileOperation({
      id: 'stage-fresh',
      kind: 'stage-home-skill',
      ownerId: owner,
      skillId,
      name: 'code-review',
      homeOperationId: 'prepare-fresh',
    })
    await runFileOperation({
      id: 'publish-fresh',
      kind: 'publish-home',
      ownerId: owner,
      homeOperationId: 'prepare-fresh',
    })
    expect(
      await readFile(
        path.join(destination, '.agents', 'skills', 'code-review', 'SKILL.md'),
        'utf8',
      ),
    ).toBe(metadata)
    await expect(stat(path.join(destination, 'notes.md'))).rejects.toThrow()
    expect(await readFile(path.join(home, 'notes.md'), 'utf8')).toBe(
      'keep at original location',
    )
  })

  test('duplication carries customized files into an independent managed home', async () => {
    await runFileOperation({
      id: 'duplicate-a',
      kind: 'duplicate',
      ownerId: owner,
      agentId: 'a',
      destination: 'copy',
    })
    const duplicate = managedHome(owner, 'copy')
    expect(
      await readFile(
        path.join(duplicate, '.agents', 'skills', 'code-review', 'SKILL.md'),
        'utf8',
      ),
    ).toBe('modified')
    await writeFile(path.join(duplicate, 'notes.md'), 'changed in duplicate')
    expect(
      await readFile(path.join(managedHome(owner, 'a'), 'notes.md'), 'utf8'),
    ).toBe('keep at original location')
  })

  test('rejects symlink substitutions and homes inside app storage', async () => {
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, path.join(managedHome(owner, 'a'), 'escape'))
    await expect(
      runFileOperation({
        id: 'unsafe-copy',
        kind: 'duplicate',
        ownerId: owner,
        agentId: 'a',
        destination: 'unsafe',
      }),
    ).rejects.toThrow('Symlink')
    await expect(
      homeInfo({
        ownerId: owner,
        agentId: 'a',
        revision: 0,
        path: libraryRoot(owner, skillId),
      }),
    ).rejects.toThrow('storage')
  })
})

test('metadata discovery reads a prefix without rejecting a large skill body', async () => {
  const body = path.join(root, 'large-skill')
  await mkdir(body)
  await writeFile(
    path.join(body, 'SKILL.md'),
    metadata + 'instructions\n'.repeat(30_000),
  )
  expect(await readSkillMetadata(body)).toEqual({
    name: 'code-review',
    description: 'Review code changes.',
  })
})

test('home locks cover simultaneous operations across different sessions', async () => {
  let release!: () => void
  const active = withAgentFiles(
    'busy',
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  const token = `${Date.now() + 30_000}:operation`
  await expect(lockAgent('busy', token)).rejects.toThrow('Wait')
  release()
  await active
  await lockAgent('busy', token)
  await expect(withAgentFiles('busy', async () => {})).rejects.toThrow(
    'updated',
  )
  unlockAgent('busy', token)
  await withAgentFiles('busy', async () => {})
})

test('managed home authority rejects a substituted directory symlink', async () => {
  const outside = path.join(root, 'substitute')
  await mkdir(outside)
  const target = managedHome(owner, 'substituted')
  await symlink(outside, target)
  await expect(
    homeInfo({ ownerId: owner, agentId: 'substituted', revision: 0 }),
  ).rejects.toThrow('Symlink')
})

test('a publish interrupted before its acknowledgement preserves customized copies on retry', async () => {
  const operation = {
    id: 'recover-publish',
    kind: 'assign' as const,
    ownerId: owner,
    agentId: 'recover',
    skillId,
    name: 'code-review',
  }
  await runFileOperation(operation)
  const copy = path.join(
    managedHome(owner, 'recover'),
    '.agents/skills/code-review/SKILL.md',
  )
  await writeFile(copy, 'customized after publish')
  await rm(path.join(operationRoot(operation.id), 'done.json'))
  expect(await runFileOperation(operation)).toEqual({ ok: true })
  expect(await readFile(copy, 'utf8')).toBe('customized after publish')
})

test('interrupted home publishes reconcile their journal and preserve unrelated destination files', async () => {
  const staged = path.join(root, 'journal-source')
  const destination = path.join(root, 'journal-target')
  const operation = path.join(root, 'journal-operation')
  await mkdir(staged)
  await mkdir(destination)
  await mkdir(operation)
  await writeFile(path.join(staged, 'notes.md'), 'copied notes')
  await publishTree(staged, destination, operation)
  await writeFile(path.join(destination, 'unrelated.md'), 'keep this file')
  await publishTree(staged, destination, operation)
  expect(await readFile(path.join(destination, 'notes.md'), 'utf8')).toBe(
    'copied notes',
  )
  expect(await readFile(path.join(destination, 'unrelated.md'), 'utf8')).toBe(
    'keep this file',
  )
})

test('availability checks never create missing folders, and managed selections stay missing until preparation', async () => {
  const { inspectHome } = await import('@sb/sidecar/agent-files/home-state')
  const { resolveDestination } =
    await import('@sb/sidecar/agent-files/destination')
  const input = { ownerId: owner, agentId: 'uninitialized', revision: 0 }
  expect((await inspectHome(input)).exists).toBe(false)
  const destination = await resolveDestination(input)
  expect(destination.path).toBe(managedHome(owner, input.agentId))
  await expect(stat(destination.path)).rejects.toThrow()
})

test('changing a deleted custom source restores pristine skills even when carry-over was requested', async () => {
  const missing = path.join(root, 'deleted-custom-home')
  const destination = path.join(root, 'recovered-home')
  await mkdir(destination)
  const prepared = await runFileOperation({
    id: 'recover-deleted-custom',
    kind: 'prepare-home',
    ownerId: owner,
    agentId: 'recover-custom',
    homePath: missing,
    destination,
    copyFiles: true,
  })
  expect(prepared).toEqual({
    path: destination,
    unchanged: false,
    sourceMissing: true,
  })
  await runFileOperation({
    id: 'recover-deleted-skill',
    kind: 'stage-home-skill',
    ownerId: owner,
    skillId,
    name: 'code-review',
    homeOperationId: 'recover-deleted-custom',
  })
  await runFileOperation({
    id: 'publish-recovered-custom',
    kind: 'publish-home',
    ownerId: owner,
    homeOperationId: 'recover-deleted-custom',
  })
  expect(
    await readFile(
      path.join(destination, '.agents/skills/code-review/SKILL.md'),
      'utf8',
    ),
  ).toBe(metadata)
  await expect(stat(missing)).rejects.toThrow()
})

test('a deleted managed home can be recreated for a shared member using its original storage identity', async () => {
  const original = 'deleted-managed-origin'
  const destination = managedHome(owner, original)
  const result = await runFileOperation({
    id: 'recover-managed-home',
    kind: 'prepare-home',
    ownerId: owner,
    agentId: 'shared-member',
    originAgentId: original,
    homePath: destination,
    destinationOriginAgentId: original,
    destination,
    copyFiles: false,
  })
  expect(result).toEqual({
    path: destination,
    unchanged: false,
    sourceMissing: true,
  })
  await runFileOperation({
    id: 'stage-recovered-managed',
    kind: 'stage-home-skill',
    ownerId: owner,
    skillId,
    name: 'code-review',
    homeOperationId: 'recover-managed-home',
  })
  await runFileOperation({
    id: 'publish-recovered-managed',
    kind: 'publish-home',
    ownerId: owner,
    homeOperationId: 'recover-managed-home',
  })
  expect(
    await readFile(
      path.join(destination, '.agents/skills/code-review/SKILL.md'),
      'utf8',
    ),
  ).toBe(metadata)
})
