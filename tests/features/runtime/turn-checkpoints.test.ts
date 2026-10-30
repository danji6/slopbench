import { CheckpointManager } from '@sb/sidecar/checkpoints/manager'
import { captureFile } from '@sb/sidecar/checkpoints/snapshot'
import { CheckpointStorage, digest } from '@sb/sidecar/checkpoints/storage'
import type { RestoreJournal } from '@sb/sidecar/checkpoints/types'
import { afterEach, describe, expect, test } from 'bun:test'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  chmod,
  mkdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { checkpointFixture } from '~/tests/helpers/turn-checkpoints'

const execute = promisify(execFile)
const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

const fixture = () => checkpointFixture(cleanup)

describe('turn checkpoints', () => {
  test('captures net file and shell edits in non-Git folders and preserves bytes through undo/redo', async () => {
    const f = await fixture()
    await writeFile(
      path.join(f.root, 'existing.txt'),
      Buffer.from('\ufeffold\r\n'),
    )
    await writeFile(path.join(f.root, 'deleted.bin'), Buffer.from([0, 255, 8]))
    await f.manager.begin(f.begin)
    await writeFile(path.join(f.root, 'existing.txt'), 'new\n')
    await execute(
      'sh',
      ['-c', 'printf "created\\n" > created.txt; rm deleted.bin'],
      { cwd: f.root },
    )
    const result = await f.manager.finish(f.finish)
    expect(result.released).toBe(true)
    expect(result.publication?.files).toHaveLength(3)
    expect(
      result.publication?.files.find((file) => file.path === 'created.txt'),
    ).toMatchObject({ kind: 'added', additions: 1, deletions: 0 })
    expect(
      result.publication?.files.find((file) => file.path === 'deleted.bin')
        ?.binary,
    ).toBe(true)
    await f.manager.restore(f.restore)
    expect(await readFile(path.join(f.root, 'existing.txt'))).toEqual(
      Buffer.from('\ufeffold\r\n'),
    )
    expect(await Bun.file(path.join(f.root, 'created.txt')).exists()).toBe(
      false,
    )
    expect(await readFile(path.join(f.root, 'deleted.bin'))).toEqual(
      Buffer.from([0, 255, 8]),
    )
    const redone = await f.manager.restore({
      ...f.restore,
      operationId: 'redo',
      revision: 1,
      direction: 'reapply',
    })
    expect(redone.summary.state).toBe('applied')
    expect(await readFile(path.join(f.root, 'created.txt'), 'utf8')).toBe(
      'created\n',
    )
    expect(
      (
        await f.manager.restore({
          ...f.restore,
          operationId: 'redo',
          revision: 1,
          direction: 'reapply',
        })
      ).summary.revision,
    ).toBe(2)
  })

  test('rejects the entire restore on a conflict and preserves unrelated edits', async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, 'a'), 'before')
    await writeFile(path.join(f.root, 'b'), 'before')
    await f.manager.begin(f.begin)
    await writeFile(path.join(f.root, 'a'), 'after')
    await writeFile(path.join(f.root, 'b'), 'after')
    await f.manager.finish(f.finish)
    await writeFile(path.join(f.root, 'b'), 'manual')
    await writeFile(path.join(f.root, 'unrelated'), 'manual')
    expect((await f.manager.restore(f.restore)).conflicts).toEqual(['b'])
    expect(await readFile(path.join(f.root, 'a'), 'utf8')).toBe('after')
    await writeFile(path.join(f.root, 'b'), 'after')
    await f.manager.restore(f.restore)
    expect(await readFile(path.join(f.root, 'unrelated'), 'utf8')).toBe(
      'manual',
    )
  })

  test('ignores generated files but captures explicit ignored targets and omits net-zero changes', async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, '.gitignore'), 'ignored/\n')
    await mkdir(path.join(f.root, 'ignored'))
    const target = path.join(f.root, 'ignored', 'explicit')
    await writeFile(target, 'before')
    await writeFile(path.join(f.root, 'same'), 'same')
    await f.manager.begin(f.begin)
    await f.manager.write('session', f.begin.workspace, async () => {
      await f.manager.trackFile('session', target, f.begin.workspace)
      await writeFile(target, 'after')
    })
    await writeFile(path.join(f.root, 'ignored', 'generated'), 'skip')
    await writeFile(path.join(f.root, 'same'), 'changed')
    await writeFile(path.join(f.root, 'same'), 'same')
    const result = await f.manager.finish(f.finish)
    expect(result.publication?.files.map((file) => file.path)).toEqual([
      'ignored/explicit',
    ])
  })

  test('keeps parent and child deltas disjoint and queues overlapping writers', async () => {
    const f = await fixture()
    await f.manager.begin(f.begin)
    expect(
      await f.manager.begin({
        ...f.begin,
        groupId: 'other',
        participantId: 'other',
        sessionId: 'other',
      }),
    ).toEqual({ queued: true })
    await f.manager.begin({ ...f.begin, participantId: 'child' })
    await writeFile(path.join(f.root, 'early'), 'early')
    const parent = await f.manager.finish(f.finish)
    expect(parent.released).toBe(false)
    await writeFile(path.join(f.root, 'late'), 'late')
    const child = await f.manager.finish({
      ...f.finish,
      participantId: 'child',
      checkpointId: 'child-turn',
      root: false,
    })
    expect(child.publication?.files.map((file) => file.path)).toEqual(['late'])
    expect(child.released).toBe(true)
    expect(
      await f.manager.begin({
        ...f.begin,
        groupId: 'other',
        participantId: 'other',
        sessionId: 'other',
      }),
    ).toEqual({ queued: false })
  })

  test('restores permissions and rejects substituted symlinks', async () => {
    const f = await fixture()
    const target = path.join(f.root, 'script')
    await writeFile(target, 'same')
    await chmod(target, 0o644)
    await f.manager.begin(f.begin)
    await chmod(target, 0o755)
    await f.manager.finish(f.finish)
    await f.manager.restore(f.restore)
    expect((await captureFile(f.storage, target))?.mode).toBe(0o644)
    await f.manager.restore({
      ...f.restore,
      direction: 'reapply',
      operationId: 'redo',
      revision: 1,
    })
    const outside = path.join(f.base, 'outside')
    await writeFile(outside, 'untouched')
    await rm(target)
    await symlink(outside, target)
    await expect(
      f.manager.restore({ ...f.restore, revision: 2, operationId: 'again' }),
    ).rejects.toThrow('symlink')
    expect(await readFile(outside, 'utf8')).toBe('untouched')
  })

  test('recovers interrupted writes before serving another operation and fails closed on corrupt storage', async () => {
    const f = await fixture()
    const target = path.join(f.root, 'file')
    await writeFile(target, 'before')
    const before = await captureFile(f.storage, target)
    await writeFile(target, 'after')
    const after = await captureFile(f.storage, target)
    const journal: RestoreJournal = {
      version: 1,
      checkpointId: 'interrupted',
      operationId: 'operation',
      roots: [f.root],
      original: [{ target, path: 'file', before, after }],
      committed: false,
    }
    await f.storage.save('journals', 'interrupted', journal)
    const restarted = new CheckpointManager(f.storage)
    await restarted.read('none')
    expect(await readFile(target, 'utf8')).toBe('before')
    await writeFile(
      path.join(f.storage.root, 'journals', digest('corrupt')),
      '{',
    )
    const corrupt = new CheckpointManager(f.storage)
    await expect(corrupt.begin(f.begin)).rejects.toThrow()
  })

  test('rolls back all writes when committing restored state fails', async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, 'a'), 'before')
    await writeFile(path.join(f.root, 'b'), 'before')
    await f.manager.begin(f.begin)
    await writeFile(path.join(f.root, 'a'), 'after')
    await writeFile(path.join(f.root, 'b'), 'after')
    await f.manager.finish(f.finish)
    const originalSave = f.storage.save.bind(f.storage)
    let injected = false
    f.storage.save = async (kind, id, value) => {
      if (kind === 'checkpoints' && !injected) {
        injected = true
        throw new Error('Disk failure')
      }
      return originalSave(kind, id, value)
    }
    await expect(f.manager.restore(f.restore)).rejects.toThrow('Disk failure')
    expect(await readFile(path.join(f.root, 'a'), 'utf8')).toBe('after')
    expect(await readFile(path.join(f.root, 'b'), 'utf8')).toBe('after')
  })
  test('keeps a shell-created file new when a file tool edits it later', async () => {
    const f = await fixture()
    await f.manager.begin(f.begin)
    const target = path.join(f.root, 'new.txt')
    await writeFile(target, 'shell content')
    await f.manager.write('session', f.begin.workspace, async () => {
      await f.manager.trackFile('session', target, f.begin.workspace)
      await writeFile(target, 'tool content')
    })
    const result = await f.manager.finish(f.finish)
    expect(result.publication?.files[0].kind).toBe('added')
    await f.manager.restore(f.restore)
    expect(await Bun.file(target).exists()).toBe(false)
  })

  test('honors Git ignores and tracked ignored files without changing the real index', async () => {
    const f = await fixture()
    await execute('git', ['init', '-q', f.root])
    await writeFile(path.join(f.root, '.gitignore'), '*.log\n')
    await writeFile(path.join(f.root, 'tracked.log'), 'before')
    await writeFile(path.join(f.root, 'ignored.log'), 'before')
    await execute('git', ['-C', f.root, 'add', '-f', 'tracked.log'])
    const index = await readFile(path.join(f.root, '.git', 'index'))
    await f.manager.begin(f.begin)
    await writeFile(path.join(f.root, 'tracked.log'), 'after')
    await writeFile(path.join(f.root, 'ignored.log'), 'after')
    await writeFile(path.join(f.root, 'new.txt'), 'new')
    const result = await f.manager.finish(f.finish)
    expect(result.publication?.files.map((file) => file.path).sort()).toEqual([
      'new.txt',
      'tracked.log',
    ])
    await f.manager.restore(f.restore)
    expect(await readFile(path.join(f.root, '.git', 'index'))).toEqual(index)
    expect(await readFile(path.join(f.root, 'ignored.log'), 'utf8')).toBe(
      'after',
    )
  })

  test('queues overlapping roots fairly and releases a cancelled waiter', async () => {
    const f = await fixture()
    await f.manager.begin(f.begin)
    const second = {
      ...f.begin,
      groupId: 'second',
      participantId: 'second',
      sessionId: 'second',
    }
    const third = {
      ...f.begin,
      groupId: 'third',
      participantId: 'third',
      sessionId: 'third',
    }
    expect((await f.manager.begin(second)).queued).toBe(true)
    expect((await f.manager.begin(third)).queued).toBe(true)
    await f.manager.finish(f.finish)
    expect((await f.manager.begin(third)).queued).toBe(true)
    await f.manager.finish({
      groupId: 'second',
      participantId: 'second',
      checkpointId: 'cancelled',
      root: true,
    })
    expect((await f.manager.begin(third)).queued).toBe(false)
  })

  test('holds pending children that have not started and releases their cancellation', async () => {
    const f = await fixture()
    await f.manager.begin(f.begin)
    const result = await f.manager.finish({
      ...f.finish,
      pendingParticipants: ['not-started'],
    })
    expect(result.released).toBe(false)
    const child = await f.manager.finish({
      ...f.finish,
      participantId: 'not-started',
      checkpointId: 'cancelled-child',
      root: false,
    })
    expect(child.released).toBe(true)
    expect(child.publication?.files).toEqual([])
  })

  test('recovers a sealed baseline after a crash without duplicating its changes', async () => {
    const f = await fixture()
    await f.manager.begin(f.begin)
    await f.manager.begin({ ...f.begin, participantId: 'child' })
    await writeFile(path.join(f.root, 'early'), 'early')
    const save = f.storage.save.bind(f.storage)
    let injected = false
    f.storage.save = async (kind, id, value) => {
      const group = value as {
        pendingCheckpoint?: string
        baseline?: Record<string, unknown>
      }
      if (
        kind === 'groups' &&
        !group.pendingCheckpoint &&
        group.baseline?.[path.join(f.root, 'early')] &&
        !injected
      ) {
        injected = true
        throw new Error('Interrupted group commit')
      }
      return save(kind, id, value)
    }
    await expect(f.manager.finish(f.finish)).rejects.toThrow(
      'Interrupted group commit',
    )
    f.storage.save = save
    const restarted = new CheckpointManager(f.storage)
    await writeFile(path.join(f.root, 'late'), 'late')
    const result = await restarted.finish({
      ...f.finish,
      participantId: 'child',
      checkpointId: 'child-after-restart',
      root: false,
    })
    expect(result.publication?.files.map((file) => file.path)).toEqual(['late'])
    expect(result.publication?.issues.join(' ')).toContain('restarted')
  })
  test('keeps restarted reservations while an owned shell process is still alive', async () => {
    const f = await fixture()
    await f.manager.begin(f.begin)
    const child = spawn(
      'sh',
      ['-c', 'read value; printf "%s" "$value" > late.txt'],
      { cwd: f.root, stdio: ['pipe', 'ignore', 'ignore'] },
    )
    await once(child, 'spawn')
    try {
      await f.manager.write('session', f.begin.workspace, () =>
        f.manager.trackJob('session', child.pid),
      )
      const frozen = await f.manager.finish(f.finish)
      expect(frozen.released).toBe(false)
      const restarted = new CheckpointManager(f.storage)
      expect(
        (await restarted.settle(f.begin.groupId, 'background')).released,
      ).toBe(false)
      const exited = once(child, 'close')
      child.stdin.end('finished\n')
      await exited
      const settled = await restarted.settle(f.begin.groupId, 'background')
      expect(settled.released).toBe(true)
      expect(settled.publication?.files.map((file) => file.path)).toEqual([
        'late.txt',
      ])
    } finally {
      child.kill('SIGKILL')
    }
  })

  test('reports an oversized after-state without falsely presenting a deletion', async () => {
    const f = await fixture()
    const target = path.join(f.root, 'growing.bin')
    await writeFile(target, 'original')
    await f.manager.begin(f.begin)
    await truncate(target, 33 * 1024 * 1024)
    const result = await f.manager.finish(f.finish)
    expect(result.publication?.files).toEqual([])
    expect(result.publication?.issues.join(' ')).toContain('byte budget')
    await expect(f.manager.restore(f.restore)).rejects.toThrow('incomplete')
  })
  test('does not attribute a later writer to a child finalized twice', async () => {
    const f = await fixture()
    await f.manager.begin(f.begin)
    await f.manager.begin({ ...f.begin, participantId: 'child' })
    await writeFile(path.join(f.root, 'child.txt'), 'child')
    const child = {
      ...f.finish,
      participantId: 'child',
      checkpointId: 'early-child',
      root: false,
    }
    expect((await f.manager.finish(child)).publication).toBeUndefined()
    await f.manager.finish(f.finish)
    await writeFile(path.join(f.root, 'other-turn.txt'), 'other')
    expect((await f.manager.finish(child)).publication).toBeUndefined()
  })

  test('excludes its own snapshot store when it lives inside the project', async () => {
    const f = await fixture()
    const storage = new CheckpointStorage(path.join(f.root, 'snapshots'))
    const manager = new CheckpointManager(storage)
    await writeFile(path.join(f.root, 'file.txt'), 'before')
    await manager.begin(f.begin)
    await writeFile(path.join(f.root, 'file.txt'), 'after')
    const result = await manager.finish(f.finish)
    expect(result.publication?.files.map((file) => file.path)).toEqual([
      'file.txt',
    ])
    await expect(
      manager.trackFile('session', path.join(storage.root, 'manifest')),
    ).rejects.toThrow('checkpoint store')
  })

  test('retires finished shell identities before their process IDs can be reused', async () => {
    const f = await fixture()
    await f.manager.begin(f.begin)
    await f.manager.write('session', f.begin.workspace, () =>
      f.manager.trackJob('session', process.pid),
    )
    expect((await f.manager.finish(f.finish)).released).toBe(false)
    await f.manager.finishJob('session', process.pid)
    expect((await f.manager.settle('group', 'background')).released).toBe(true)
  })
})
