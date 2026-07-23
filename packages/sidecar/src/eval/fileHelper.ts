import { fileBlock } from '@sb/core/workspace/blocks'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

import { assertInside, expandHome } from '../mcp/workspace/paths'

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
function resolveInside(root: string, filePath: string): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null

  const candidate = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath)
  assertInside(root, candidate)

  let target: string
  try {
    target = realpathSync(candidate)
  } catch {
    return null
  }
  assertInside(root, target)
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
): (filePath: string, wrap?: boolean) => string {
  const root = resolveRoot(workDir)
  if (!root) return () => ''

  return (filePath: string, wrap: boolean = true) => {
    const target = resolveInside(root, filePath)
    if (!target) return ''

    let content: string
    try {
      content = readFileSync(target, 'utf-8')
    } catch {
      return ''
    }
    if (content.length > MAX_FILE_BYTES) {
      content = `${content.slice(0, MAX_FILE_BYTES)}\n[truncated]`
    }
    return wrap ? fileBlock(filePath, content) : content
  }
}

/**
 * Builds the `fileExists(path)` helper: an existence check for a regular file
 * inside the workspace. Returns false for missing files, empty paths,
 * directories, paths that escape the workspace, or no bound workspace.
 */
export function createFileExistsHelper(
  workDir: string | undefined,
): (filePath: string) => boolean {
  const root = resolveRoot(workDir)
  if (!root) return () => false

  return (filePath: string) => {
    try {
      const target = resolveInside(root, filePath)
      return target !== null && statSync(target).isFile()
    } catch {
      return false
    }
  }
}
