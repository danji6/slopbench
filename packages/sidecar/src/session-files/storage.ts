import { parseScopedPath } from '@cv/core/workspace/scoped-path'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import {
  assertPlainPath,
  dataRoot,
  identifier,
  inside,
  isMissing,
} from '../agent-files/storage'

export function sessionDirectory(sessionId: string) {
  return path.join(dataRoot(), 'sessions', identifier(sessionId))
}

export function sessionTombstone(sessionId: string) {
  return path.join(dataRoot(), 'deleted-sessions', identifier(sessionId))
}

export async function assertSessionDirectoryLive(sessionId: string) {
  const tombstone = sessionTombstone(sessionId)
  try {
    await lstat(tombstone)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  throw new Error('The session directory has been deleted')
}

export async function ensureSessionDirectory(sessionId: string) {
  await assertSessionDirectoryLive(sessionId)
  const directory = sessionDirectory(sessionId)
  await ensurePlainDirectory(directory)
  return directory
}

export async function ensurePlainDirectory(directory: string) {
  await assertPlainPath(directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if ((await realpath(directory)) !== directory)
    throw new Error('Directory changed through a symlink')
}

export function sessionFilePath(sessionId: string, value: string) {
  const parsed = parseScopedPath(value)
  if (parsed.scope !== 'session' || !parsed.explicit)
    throw new Error('Use a session:// file path')
  if (parsed.path.split(/[\\/]/).includes('..'))
    throw new Error('Session file paths cannot contain traversal')
  const root = sessionDirectory(sessionId)
  const target = path.resolve(root, parsed.path.replaceAll('\\', '/'))
  if (target === root || !inside(root, target))
    throw new Error('Choose a file inside the session directory')
  return target
}

export async function assertRegularFile(target: string) {
  await assertPlainPath(target)
  const stat = await lstat(target)
  if (!stat.isFile() || stat.nlink !== 1)
    throw new Error('Only regular files without hard links are supported')
  return stat
}
