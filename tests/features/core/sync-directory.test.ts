import { syncDirectory } from '@sb/core/fs/sync-directory'
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
const sync = mock(async () => {})
const close = mock(async () => {})
const handle: Pick<FileHandle, 'sync' | 'close'> = { sync, close }
let open: ReturnType<typeof spyOn<typeof fs, 'open'>>

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  open = spyOn(fs, 'open').mockResolvedValue(handle as FileHandle)
})

afterEach(() => {
  open.mockRestore()
  sync.mockReset()
  close.mockReset()
  Object.defineProperty(process, 'platform', platformDescriptor)
})

test('skips opening directories on Windows, where flushing them fails', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  open.mockRejectedValue(
    Object.assign(new Error('Not permitted'), { code: 'EPERM' }),
  )

  await syncDirectory('checkpoint-directory')

  expect(open).not.toHaveBeenCalled()
})

test('syncs directory entries and closes the handle on supported platforms', async () => {
  await syncDirectory('checkpoint-directory')

  expect(open).toHaveBeenCalledWith('checkpoint-directory', 'r')
  expect(sync).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)
})

test('propagates sync failures and still closes the directory handle', async () => {
  const failure = Object.assign(new Error('Disk failure'), { code: 'EIO' })
  sync.mockRejectedValue(failure)

  await expect(syncDirectory('checkpoint-directory')).rejects.toBe(failure)
  expect(close).toHaveBeenCalledTimes(1)
})

test('propagates directory open failures on supported platforms', async () => {
  const failure = Object.assign(new Error('Not permitted'), { code: 'EPERM' })
  open.mockRejectedValue(failure)

  await expect(syncDirectory('checkpoint-directory')).rejects.toBe(failure)
  expect(sync).not.toHaveBeenCalled()
})
