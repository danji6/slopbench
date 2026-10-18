import { afterEach, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rebuildDataDirectory } from '~/scripts/runner/prune-data'

const temporary: string[] = []
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'prune-data-'))
  temporary.push(root)
  const data = join(root, 'data')
  const files = {
    'convex.sqlite3': 'old database',
    'convex.sqlite3-wal': 'old wal',
    'convex.sqlite3-shm': 'old shm',
    'convex.sqlite3-journal': 'old rollback journal',
    'storage/modules/old': 'old modules',
    'sidecar/skills/owner/skill/review/SKILL.md': 'library instructions',
    'sidecar/skills/owner/skill/review/tool.bin': 'binary resource',
    'sidecar/agents/owner/agent/skills/review/SKILL.md': 'agent edits',
    'sidecar/agent-operations/op/done.json': 'operation receipt',
    'other-state/cache': 'application state',
  }
  for (const [name, value] of Object.entries(files)) {
    const target = join(data, name)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, value)
  }
  return { root, data, files }
}

test('prune preserves application files in both the active directory and full backup', async () => {
  const { root, data, files } = await fixture()
  await mkdir(`${data}.bak`)
  await symlink('../other-state/cache', join(data, 'sidecar', 'link'))
  const backup = await rebuildDataDirectory(data, async () => {
    expect(await Bun.file(join(data, 'convex.sqlite3')).exists()).toBe(false)
    expect(await Bun.file(join(data, 'storage/modules/old')).exists()).toBe(
      false,
    )
    expect(await readFile(join(data, 'other-state/cache'), 'utf8')).toBe(
      'application state',
    )
    await writeFile(join(data, 'convex.sqlite3'), 'rebuilt database')
  })
  expect(backup).toBe(join(root, 'data.bak-1'))
  for (const [name, value] of Object.entries(files)) {
    expect(await readFile(join(backup, name), 'utf8')).toBe(value)
    if (name.startsWith('sidecar/') || name.startsWith('other-state/'))
      expect(await readFile(join(data, name), 'utf8')).toBe(value)
  }
  expect(await readlink(join(data, 'sidecar/link'))).toBe(
    '../other-state/cache',
  )
  expect(await readFile(join(data, 'convex.sqlite3'), 'utf8')).toBe(
    'rebuilt database',
  )
  await writeFile(join(data, 'other-state/cache'), 'new state')
  expect(await readFile(join(backup, 'other-state/cache'), 'utf8')).toBe(
    'application state',
  )
})

test('failed rebuild restores the complete original directory, including sidecar files', async () => {
  const { data, files } = await fixture()
  await expect(
    rebuildDataDirectory(data, async () => {
      await writeFile(join(data, 'partial'), 'incomplete rebuild')
      throw new Error('import failed')
    }),
  ).rejects.toThrow('import failed')
  for (const [name, value] of Object.entries(files))
    expect(await readFile(join(data, name), 'utf8')).toBe(value)
  expect(await Bun.file(join(data, 'partial')).exists()).toBe(false)
})

test('prune also works before any sidecar storage exists', async () => {
  const { data } = await fixture()
  await rm(join(data, 'sidecar'), { recursive: true })
  await rebuildDataDirectory(data, async () => {
    await writeFile(join(data, 'convex.sqlite3'), 'new')
  })
  expect(await readFile(join(data, 'convex.sqlite3'), 'utf8')).toBe('new')
})
