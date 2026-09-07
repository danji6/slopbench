import type { PathCheckResult } from '@sb/core/workspace/path-policy'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { glob } from 'tinyglobby'

import { inspectPath, pathCandidate, resolvePathGrants } from './access'

const MAX_GLOB_MATCHES = 256
const GLOB_CHARS = /[*?[\]{}]/
const SAFE_DEVICE_PATHS = new Set([
  '/dev/null',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/tty',
])

/** Resolve paths against allowlist grants and identify sensitive paths that still need approval. */
export async function checkPaths(
  root: string,
  input: { paths: string[]; allowedPaths?: string[]; literal?: boolean },
): Promise<PathCheckResult> {
  const grants = await resolvePathGrants(root, input.allowedPaths ?? [])

  const result: PathCheckResult = {
    flagged: [],
    uncovered: [],
    resolved: [],
    complete: true,
  }

  for (const candidate of input.paths) {
    try {
      if (!input.literal && (/^~/.test(candidate) || /\$/.test(candidate)))
        throw new Error('Dynamic path')
      const candidates = input.literal
        ? [candidate]
        : await expandCandidate(root, candidate)
      for (const value of candidates) {
        // These special devices retain their existing shell exemption
        if (!input.literal && SAFE_DEVICE_PATHS.has(path.resolve(root, value)))
          continue
        result.resolved.push(await inspectPath(root, value, grants))
      }
    } catch {
      result.complete = false
      result.flagged.push(candidate)
      result.uncovered.push(candidate)
    }
  }
  await flagSensitivePaths(root, result, Boolean(input.literal))
  result.flagged = [...new Set(result.flagged)]
  result.uncovered = [...new Set(result.uncovered)]
  return result
}

async function flagSensitivePaths(
  root: string,
  result: PathCheckResult,
  literal: boolean,
) {
  const inside = result.resolved
    .filter((item) => !item.outside)
    .flatMap((item) => [item.path, item.inputPath])

  const ignored = literal
    ? new Set<string>()
    : await gitCheckIgnore(root, inside)
  if (ignored === null) result.complete = false

  for (const item of result.resolved) {
    if (
      item.outside ||
      item.forbidden ||
      ignored?.has(item.path) ||
      ignored?.has(item.inputPath)
    ) {
      result.flagged.push(item.path)
      if (!item.allowed) result.uncovered.push(item.path)
    }
  }
}

async function expandCandidate(
  root: string,
  candidate: string,
): Promise<string[]> {
  if (!GLOB_CHARS.test(candidate)) return [candidate]

  const matches = await glob(pathCandidate(root, candidate), {
    dot: true,
    onlyFiles: false,
    followSymbolicLinks: false,
  })
  if (matches.length > MAX_GLOB_MATCHES)
    throw new Error('Too many glob matches')

  // An unmatched pattern is still a possible literal operand
  return matches.length ? matches : [candidate]
}

function gitCheckIgnore(
  root: string,
  paths: string[],
): Promise<Set<string> | null> {
  if (!paths.length) return Promise.resolve(new Set())
  return new Promise((resolve) => {
    const child = spawn('git', ['check-ignore', '-z', '--stdin'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.stdin.on('error', () => {})
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code === 0 || code === 1)
        resolve(new Set(stdout.split('\0').filter(Boolean)))
      else if (stderr.includes('not a git repository')) resolve(new Set())
      else resolve(null)
    })
    child.stdin.end(paths.join('\0') + '\0')
  })
}
