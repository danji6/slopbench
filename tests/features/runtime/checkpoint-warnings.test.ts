import { CheckpointManager } from '@sb/sidecar/checkpoints/manager'
import { afterEach, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { checkpointFixture } from '~/tests/helpers/turn-checkpoints'

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})
const execute = promisify(execFile)
const fixture = () => checkpointFixture(cleanup)

test.each([false, true])(
  'captures symlink changes without following their targets (Git: %s)',
  async (git) => {
    const f = await fixture()
    if (git) await execute('git', ['init', '-q', f.root])
    const outside = path.join(f.base, 'outside')
    await writeFile(outside, 'untouched')
    await symlink(outside, path.join(f.root, 'alias'))
    await symlink('missing', path.join(f.root, 'deleted'))
    await symlink(f.base, path.join(f.root, 'directory'))
    if (git) await execute('git', ['-C', f.root, 'add', '.'])
    await f.manager.begin(f.begin)
    await rm(path.join(f.root, 'alias'))
    await symlink('missing', path.join(f.root, 'alias'))
    await rm(path.join(f.root, 'deleted'))
    await symlink(outside, path.join(f.root, 'added'))
    const result = await f.manager.finish(f.finish)
    expect(result.publication?.issues).toEqual([])
    expect(result.publication?.files.map((file) => file.path)).toEqual([
      'added',
      'alias',
      'deleted',
    ])
    await f.manager.restore(f.restore)
    expect(await readlink(path.join(f.root, 'alias'))).toBe(outside)
    expect(await readlink(path.join(f.root, 'deleted'))).toBe('missing')
    await expect(lstat(path.join(f.root, 'added'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await f.manager.restore({
      ...f.restore,
      revision: 1,
      direction: 'reapply',
      operationId: 'redo',
    })
    expect(await readlink(path.join(f.root, 'alias'))).toBe('missing')
    expect(await readlink(path.join(f.root, 'added'))).toBe(outside)
    expect(await readFile(outside, 'utf8')).toBe('untouched')
  },
)

test('omits uncaptured before-states instead of treating recovered files as additions', async () => {
  const f = await fixture()
  const target = path.join(f.root, 'oversized')
  await writeFile(target, '')
  await truncate(target, 33 * 1024 * 1024)
  await writeFile(path.join(f.root, 'healthy'), 'before')
  await f.manager.begin(f.begin)
  await writeFile(target, 'now small')
  await writeFile(path.join(f.root, 'healthy'), 'after')
  const result = await f.manager.finish(f.finish)
  expect(result.publication?.files.map((file) => file.path)).toEqual([
    'healthy',
  ])
  expect(result.publication?.issues.length).toBeGreaterThan(0)
  await f.manager.restore(f.restore)
  expect(await readFile(target, 'utf8')).toBe('now small')
  expect(await readFile(path.join(f.root, 'healthy'), 'utf8')).toBe('before')
})

test.skipIf(process.getuid?.() === 0)(
  'continues scanning after inaccessible directories and avoids false additions when access returns',
  async () => {
    const f = await fixture()
    const locked = path.join(f.root, 'a-locked')
    await mkdir(locked)
    await writeFile(path.join(locked, 'unreadable'), 'original')
    await writeFile(path.join(f.root, 'z-healthy'), 'before')
    await chmod(locked, 0o000)
    try {
      await f.manager.begin(f.begin)
    } finally {
      await chmod(locked, 0o755)
    }
    await writeFile(path.join(f.root, 'z-healthy'), 'after')
    const result = await f.manager.finish(f.finish)
    expect(result.publication?.files.map((file) => file.path)).toEqual([
      'z-healthy',
    ])
    expect(result.publication?.issues.join(' ')).toContain('EACCES')
    await f.manager.restore(f.restore)
    expect(await readFile(path.join(f.root, 'z-healthy'), 'utf8')).toBe(
      'before',
    )
    expect(await readFile(path.join(locked, 'unreadable'), 'utf8')).toBe(
      'original',
    )
  },
)

test.skipIf(process.getuid?.() === 0)(
  'skips unwritable files, persists partial progress and reapplies only reverted files',
  async () => {
    const f = await fixture()
    const locked = path.join(f.root, 'locked')
    const target = path.join(locked, 'file')
    const healthy = path.join(f.root, 'healthy')
    await mkdir(locked)
    await writeFile(target, 'before')
    await writeFile(healthy, 'before')
    await f.manager.begin(f.begin)
    await writeFile(target, 'after')
    await writeFile(healthy, 'after')
    await f.manager.finish(f.finish)
    await chmod(locked, 0o555)
    try {
      const result = await f.manager.restore(f.restore)
      expect(result.summary.state).toBe('reverted')
      expect(result.summary.issues.join(' ')).toContain('locked/file')
      expect(await readFile(target, 'utf8')).toBe('after')
      expect(await readFile(healthy, 'utf8')).toBe('before')
      expect((await f.manager.restore(f.restore)).summary.revision).toBe(1)
      // An unrelated edit to a skipped file must not be overwritten or conflict on reapply.
      await writeFile(target, 'manual')
      const restarted = new CheckpointManager(f.storage)
      const reapplied = await restarted.restore({
        ...f.restore,
        revision: 1,
        direction: 'reapply',
        operationId: 'redo',
      })
      expect(reapplied.conflicts).toEqual([])
      expect(await readFile(healthy, 'utf8')).toBe('after')
      expect(await readFile(target, 'utf8')).toBe('manual')
    } finally {
      await chmod(locked, 0o755)
    }
  },
)
