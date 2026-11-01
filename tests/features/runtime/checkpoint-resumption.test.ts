import { CheckpointManager } from '@sb/sidecar/checkpoints/manager'
import { digest } from '@sb/sidecar/checkpoints/storage'
import { afterEach, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { checkpointFixture } from '~/tests/helpers/turn-checkpoints'

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

test('resumes a restarted capture without losing its baseline or external file reservation', async () => {
  const f = await checkpointFixture(cleanup)
  const local = path.join(f.root, 'local.txt')
  const external = path.join(f.base, 'approved.txt')
  await writeFile(local, 'original local')
  await writeFile(external, 'original external')
  await f.manager.begin(f.begin)
  await f.manager.write('session', f.begin.workspace, async () => {
    await f.manager.trackFile('session', external, f.begin.workspace)
    await writeFile(external, 'before restart')
    await writeFile(local, 'before restart')
  })

  const restarted = new CheckpointManager(f.storage)
  await expect(
    restarted.write('session', f.begin.workspace, async () => {}),
  ).rejects.toThrow('capture was interrupted')
  expect(await restarted.begin(f.begin)).toEqual({ queued: false })
  await restarted.write('session', f.begin.workspace, async () => {
    await restarted.trackFile('session', external, f.begin.workspace)
    await writeFile(external, 'after restart')
    await writeFile(local, 'after restart')
  })
  expect(
    await restarted.begin({
      ...f.begin,
      groupId: 'other',
      participantId: 'other',
      sessionId: 'other',
    }),
  ).toEqual({ queued: true })
  const finished = await restarted.finish(f.finish)
  expect(finished.released).toBe(true)
  expect(finished.publication?.issues.join(' ')).toContain('restarted')
  const checkpoint = await restarted.read(f.finish.checkpointId)
  for (const [target, original] of [
    [local, 'original local'],
    [external, 'original external'],
  ]) {
    const file = checkpoint?.files.find((file) => file.target === target)
    expect(file?.before?.hash).toBe(digest(original!))
    expect(file?.after?.hash).toBe(digest('after restart'))
  }
  await restarted.restore({ ...f.restore, allowedPaths: [external] })
  expect(await readFile(local, 'utf8')).toBe('original local')
  expect(await readFile(external, 'utf8')).toBe('original external')
})

test('waits for inherited shell processes before resuming and retires their identities', async () => {
  const f = await checkpointFixture(cleanup)
  await f.manager.begin(f.begin)
  const child = spawn('sh', ['-c', 'read value'], {
    cwd: f.root,
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  await once(child, 'spawn')
  try {
    await f.manager.write('session', f.begin.workspace, () =>
      f.manager.trackJob('session', child.pid),
    )
    const restarted = new CheckpointManager(f.storage)
    expect(await restarted.begin(f.begin)).toEqual({ queued: true })
    await expect(
      restarted.write('session', f.begin.workspace, async () => {}),
    ).rejects.toThrow('capture was interrupted')
    const exited = once(child, 'close')
    child.stdin.end('finished\n')
    await exited

    expect(await restarted.begin(f.begin)).toEqual({ queued: false })
    await restarted.write('session', f.begin.workspace, () =>
      writeFile(path.join(f.root, 'resumed.txt'), 'resumed'),
    )
    expect((await restarted.finish(f.finish)).released).toBe(true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'close')
      child.kill('SIGKILL')
      await exited
    }
  }
})
