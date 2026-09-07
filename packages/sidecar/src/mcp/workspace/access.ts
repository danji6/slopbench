import {
  type CheckedPath,
  approvalPathSyntaxError,
  isPathAllowed,
  isPathForbidden,
} from '@sb/core/workspace/path-policy'
import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

import { assertInside } from './paths'

export type PathGrant = { absolutePath: string; explicitGit: boolean }

/** Resolve symlinks before interpreting subsequent `..` segments. */
export async function canonicalPath(candidate: string): Promise<string> {
  let current = path.parse(candidate).root
  for (const segment of candidate.slice(current.length).split(path.sep)) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      current = path.dirname(current)
      continue
    }
    current = path.join(current, segment)
    try {
      await lstat(current)
    } catch (error) {
      if (isMissing(error)) continue
      throw error
    }
    // Resolve each segment separately. Bun may normalize `link/..` too early.
    // A dangling symlink must fail here instead of becoming a new file.
    current = await realpath(current)
  }
  return current
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

export function pathCandidate(root: string, input: string): string {
  return path.isAbsolute(input) ? input : `${root}${path.sep}${input}`
}

export function isOutside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
}

export function displayPath(root: string, target: string): string {
  return isOutside(root, target)
    ? target
    : path.relative(root, target).split(path.sep).join('/') || '.'
}

/** Invalid or unavailable entries confer no permissions. */
export async function resolvePathGrants(
  root: string,
  entries: string[],
): Promise<PathGrant[]> {
  const grants: PathGrant[] = []
  for (const entry of entries) {
    if (approvalPathSyntaxError(entry)) continue
    try {
      const absolutePath = await canonicalPath(pathCandidate(root, entry))
      grants.push({ absolutePath, explicitGit: isPathForbidden(entry) })
    } catch {
      // Resolution failures never establish a grant
    }
  }
  return grants
}

export async function inspectPath(
  root: string,
  input: string,
  grants: PathGrant[],
): Promise<CheckedPath> {
  const absolutePath = await canonicalPath(pathCandidate(root, input))
  const forbidden = isPathForbidden(input) || isPathForbidden(absolutePath)
  const allowed = grants.some(
    (grant) =>
      (!forbidden || grant.explicitGit) &&
      isPathAllowed(absolutePath.split(path.sep).join('/'), [
        grant.absolutePath.split(path.sep).join('/'),
      ]),
  )
  return {
    path: displayPath(root, absolutePath),
    absolutePath,
    inputPath: displayPath(root, path.resolve(root, input)),
    outside: isOutside(root, absolutePath),
    forbidden,
    allowed,
  }
}

/** File tools may leave the workspace only through an explicit grant. */
export async function resolveToolPath(
  root: string,
  input: string,
  allowedPaths: string[] = [],
) {
  const grants = await resolvePathGrants(root, allowedPaths)
  const target = await inspectPath(root, input, grants)
  if (target.outside && !target.allowed)
    throw new Error(
      'Path escapes the configured workspace, add an explicit path approval to access it',
    )
  return {
    absolutePath: target.absolutePath,
    relativePath: target.path,
    external: target.outside,
  }
}

/** Restore only the original canonical checkpoint target, never a substituted symlink. */
export async function assertCheckpointTarget(
  root: string,
  target: string,
  external: boolean,
) {
  const current = await canonicalPath(target)
  if (current !== target)
    throw new Error('Checkpoint target changed through a symlink')
  if (!external) assertInside(root, current)
}
