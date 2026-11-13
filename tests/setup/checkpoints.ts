import * as checkpoints from '@cv/sidecar/checkpoints/manager'
import { CheckpointStorage } from '@cv/sidecar/checkpoints/storage'
import { afterAll, beforeAll, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Installs a real checkpoint manager with storage scoped to the test file. */
export function setupCheckpoints(): void {
  let root: string
  let restore: (() => void) | undefined

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'test-checkpoints-'))
    const manager = new checkpoints.CheckpointManager(
      new CheckpointStorage(root),
    )
    const spy = spyOn(checkpoints, 'checkpoints').mockReturnValue(manager)
    restore = () => spy.mockRestore()
  })

  afterAll(async () => {
    restore?.()
    if (root) await rm(root, { recursive: true, force: true })
  })
}
