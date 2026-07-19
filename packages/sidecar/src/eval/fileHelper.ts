import { fileBlock } from '@sb/core/workspace/blocks'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { assertInside, expandHome } from '../mcp/workspace/paths'

const MAX_FILE_BYTES = 50_000

/**
 * Builds the `file(path, wrap)` helper exposed to dynamic prompt blocks:
 * - Reads are confined to the workspace root (throws if outside the workspace).
 * - A missing file or no bound workspace returns ''.
 * - `wrap` wraps the content in a `<file path="...">` block.
 */
export function createFileHelper(
  workDir: string | undefined,
): (filePath: string, wrap?: boolean) => string {
  if (!workDir) return () => ''

  let root: string
  try {
    root = realpathSync(path.resolve(expandHome(workDir)))
  } catch {
    return () => ''
  }

  return (filePath: string, wrap: boolean = true) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return ''

    const candidate = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(root, filePath)
    assertInside(root, candidate)

    let target: string
    try {
      target = realpathSync(candidate)
    } catch {
      return ''
    }
    assertInside(root, target)

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
