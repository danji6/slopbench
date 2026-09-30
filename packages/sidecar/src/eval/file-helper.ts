import { fileBlock } from '@sb/core/workspace/blocks'
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

import { expandHome } from '../mcp/workspace/paths'

const MAX_FILE_BYTES = 50_000

/** Resolve a workspace root to its real path, or `null` when unavailable. */
function resolveRoot(workDir: string | undefined): string | null {
  if (!workDir) return null
  try {
    return realpathSync(path.resolve(expandHome(workDir)))
  } catch {
    return null
  }
}

/**
 * Resolve a workspace-relative or absolute path to an existing real path
 * confined to `root`. Returns `null` when the path is empty or does not exist,
 * and throws (via `assertInside`) when it escapes the workspace.
 */
function resolveInside(
  root: string,
  filePath: string,
  roots: string[],
): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null

  const candidate = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath)
  assertSources(roots, candidate)

  let target: string
  try {
    target = realpathSync(candidate)
  } catch {
    return null
  }
  assertSources(roots, target)
  return target
}

/**
 * Builds the `readFile(path, wrap)` helper exposed to dynamic prompt blocks:
 * - Reads are confined to the workspace root (throws if outside the workspace).
 * - A missing file or no bound workspace returns ''.
 * - `wrap` wraps the content in a `<file path="...">` block.
 */
export function createFileHelper(
  workDir: string | undefined,
  workDirs?: string[],
): (filePath: string, wrap?: boolean) => string {
  const root = resolveRoot(workDir)
  if (!root) return () => ''
  const roots = (workDirs ?? [root]).filter(
    (source) => resolveRoot(source) === source,
  )

  return (filePath: string, wrap: boolean = true) => {
    const target = resolveInside(root, filePath, roots)
    if (!target) return ''

    let content: string
    try {
      content = readBoundedFile(target)
    } catch {
      return ''
    }
    if (content.length > MAX_FILE_BYTES) {
      content = `${content.slice(0, MAX_FILE_BYTES)}\n[truncated]`
    }
    return wrap ? fileBlock(filePath, content) : content
  }
}

/** Reads only regular files and caps allocation before reading. */
function readBoundedFile(target: string): string {
  const fd = openSync(target, 'r')
  try {
    if (!fstatSync(fd).isFile()) return ''
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    const count = readSync(fd, buffer, 0, buffer.length, 0)
    const text = buffer
      .subarray(0, Math.min(count, MAX_FILE_BYTES))
      .toString('utf8')
    return count > MAX_FILE_BYTES ? text + '\n[truncated]' : text
  } finally {
    closeSync(fd)
  }
}

/**
 * Builds the `fileExists(path)` helper: an existence check for a regular file
 * inside the workspace. Returns false for missing files, empty paths,
 * directories, paths that escape the workspace, or no bound workspace.
 */
export function createFileExistsHelper(
  workDir: string | undefined,
  workDirs?: string[],
): (filePath: string) => boolean {
  const root = resolveRoot(workDir)
  if (!root) return () => false
  const roots = (workDirs ?? [root]).filter(
    (source) => resolveRoot(source) === source,
  )

  return (filePath: string) => {
    try {
      const target = resolveInside(root, filePath, roots)
      return target !== null && statSync(target).isFile()
    } catch {
      return false
    }
  }
}

function assertSources(roots: string[], target: string) {
  if (
    !roots.some((root) => {
      const rel = path.relative(root, target)
      return (
        rel !== '..' &&
        !rel.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(rel)
      )
    })
  )
    throw new Error('Path escapes the configured workspace sources')
}
