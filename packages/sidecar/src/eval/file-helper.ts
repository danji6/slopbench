import type { ReadFileOptions } from '@sb/core/interpreter/types'
import { fileBlock } from '@sb/core/workspace/blocks'
import {
  type ScopedPath,
  parseScopedPath,
} from '@sb/core/workspace/scoped-path'
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

import { utf8PrefixLength } from '../files/read-text'
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

  let target = path.parse(candidate).root
  const raw = path.isAbsolute(filePath)
    ? filePath
    : `${root}${path.sep}${filePath}`
  for (const segment of raw.slice(target.length).split(path.sep)) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      target = path.dirname(target)
      continue
    }
    try {
      target = realpathSync(path.join(target, segment))
    } catch {
      return null
    }
  }
  assertSources(roots, target)
  return target
}

/**
 * Builds the `readFile(path, options)` helper exposed to dynamic prompt blocks:
 * - Reads are confined to the workspace root (throws if outside the workspace).
 * - A missing file or no bound workspace returns ''.
 * - `wrap` wraps the content in a `<file path="...">` block.
 */
export function createFileHelper(
  workDir: string | undefined,
  workDirs?: string[],
  agentDir?: string,
): (filePath: string, options?: ReadFileOptions) => string {
  return (filePath, options) => {
    if (options && Object.keys(options).some((key) => key !== 'wrap')) {
      throw new Error('Unsupported file option')
    }
    const target = scopedTarget(
      { workDir, workDirs, agentDir },
      parseScopedPath(filePath),
    )
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
    return options?.wrap === false ? content : fileBlock(filePath, content)
  }
}

/** Reads only regular files and caps allocation before reading. */
function readBoundedFile(target: string): string {
  const fd = openSync(target, 'r')
  try {
    if (!fstatSync(fd).isFile()) return ''
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    const count = readSync(fd, buffer, 0, buffer.length, 0)
    const trunc = buffer.subarray(0, Math.min(count, MAX_FILE_BYTES))
    const text = buffer.subarray(0, utf8PrefixLength(trunc)).toString('utf8')
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
  agentDir?: string,
): (filePath: string) => boolean {
  return (filePath) => {
    const parsed = parseScopedPath(filePath)
    try {
      const target = scopedTarget({ workDir, workDirs, agentDir }, parsed)
      return target !== null && statSync(target).isFile()
    } catch {
      return false
    }
  }
}

type HelperRoots = { workDir?: string; workDirs?: string[]; agentDir?: string }

function scopedTarget(input: HelperRoots, parsed: ScopedPath) {
  const personal = parsed.scope === 'agent'
  const root = resolveRoot(personal ? input.agentDir : input.workDir)
  if (!root) {
    if (!personal && resolveRoot(input.agentDir)) {
      throw new Error(
        'No project workspace. Use an agent:// path for personal files.',
      )
    }
    return null
  }

  const roots = parsed.explicit
    ? [root]
    : (input.workDirs ?? [root]).filter(
        (source) => resolveRoot(source) === source,
      )
  const target = resolveInside(root, parsed.path, roots)
  const home = resolveRoot(input.agentDir)

  if (target && home && !personal) {
    const relative = path.relative(home, target)
    const insidePersonalHome =
      !relative ||
      (!path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`))
    if (insidePersonalHome) {
      throw new Error('Agent personal files require an agent:// path')
    }
  }

  return target
}

function assertSources(roots: string[], target: string) {
  const insideConfiguredSource = roots.some((root) => {
    const relative = path.relative(root, target)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) // prettier-ignore
  })
  if (!insideConfiguredSource) {
    throw new Error('Path escapes the configured workspace sources')
  }
}
