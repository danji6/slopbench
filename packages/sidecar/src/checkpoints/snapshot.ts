import ignore, { type Ignore } from 'ignore'
import {
  type ExecFileOptionsWithStringEncoding,
  execFile,
} from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { assertPlainPath, isMissing } from '../agent-files/storage'
import { isOutside } from '../mcp/workspace/access'
import { type CheckpointStorage } from './storage'
import type { FileState, Snapshot } from './types'

const execute = promisify(execFile)
const EXCLUDED = new Set([
  '.git',
  'node_modules',
  '.venv',
  '__pycache__',
  '.cache',
])
const MAX_FILES = 50_000
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_CAPTURE_BYTES = 512 * 1024 * 1024

type IgnoreSource = { root: string; rules: Ignore }
type ScanContext = {
  storageRoot: string
  paths: Set<string>
  issues: string[]
  visited: number
  excluded: string[]
}

export function excludedPath(target: string) {
  return target.split(path.sep).some((segment) => EXCLUDED.has(segment))
}

/** Enumerates tracked and unignored files without truncating silently. */
export async function snapshot(
  storage: CheckpointStorage,
  roots: string[],
  explicit: string[] = [],
) {
  const context: ScanContext = {
    storageRoot: storage.root,
    paths: new Set(),
    issues: [],
    visited: 0,
    excluded: [],
  }

  for (const root of roots) {
    try {
      await assertPlainPath(root)
      const indexed = await gitFiles(root, context)
      if (!indexed) await walk(root, [], context)
    } catch (error) {
      context.issues.push(`${root}: ${String(error)}`)
    }
  }
  for (const target of explicit) {
    context.paths.add(target)
  }

  const files: Snapshot = {}
  const unavailable: string[] = []
  let total = 0
  for (const target of [...context.paths].sort()) {
    if (!isOutside(storage.root, target)) continue
    if (total > MAX_CAPTURE_BYTES) {
      unavailable.push(target)
      continue
    }
    try {
      const state = await captureFile(storage, target)
      if (!state) continue
      total += state.size
      if (total > MAX_CAPTURE_BYTES)
        throw new Error('Snapshot byte budget exceeded')
      files[target] = state
    } catch (error) {
      context.issues.push(`${target}: ${String(error)}`)
      unavailable.push(target)
    }
  }

  return {
    files,
    unavailable,
    issues: [...new Set(context.issues)]
      .slice(0, 100)
      .concat(
        context.issues.length > 100
          ? [
              `${context.issues.length - 100} additional capture issues omitted.`,
            ]
          : [],
      ),
    excluded: context.excluded,
  }
}

async function walk(root: string, parents: IgnoreSource[], scan: ScanContext) {
  const sources = await readIgnore(root, parents)
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (++scan.visited > MAX_FILES)
      throw new Error('Snapshot file budget exceeded')

    const target = path.join(root, entry.name)

    const ignored = sources.reduce((previous, { root: base, rules }) => {
      const relative = path.relative(base, target).split(path.sep).join('/')
      const result = rules.test(relative + (entry.isDirectory() ? '/' : ''))
      return result.ignored ? true : result.unignored ? false : previous
    }, false)

    const checkpointStore = !isOutside(scan.storageRoot, target)

    if (ignored || EXCLUDED.has(entry.name) || checkpointStore) {
      scan.excluded.push(target)
      continue
    }
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await walk(target, sources, scan)
    else if (entry.isFile()) scan.paths.add(target)
  }
}

async function readIgnore(root: string, parents: IgnoreSource[]) {
  const filename = path.join(root, '.gitignore')
  try {
    await assertPlainPath(filename)
    const rules = ignore().add(await readFile(filename, 'utf8'))
    return [...parents, { root, rules }]
  } catch (error) {
    if (isMissing(error)) return parents
    throw error
  }
}

async function gitFiles(root: string, scan: ScanContext): Promise<boolean> {
  try {
    const options = {
      cwd: root,
      encoding: 'utf8' as const,
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }
    // Explicit capture roots inside ignored directories use their own ignore rules
    if (await ignoredGitRoot(root, options)) return false

    const { stdout } = await execute(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      options,
    )
    const ignored = await execute(
      'git',
      [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '-z',
      ],
      options,
    )
    scan.excluded.push(
      ...ignored.stdout
        .split('\0')
        .filter(Boolean)
        .map((relative) => path.resolve(root, relative)),
    )

    for (const relative of stdout.split('\0').filter(Boolean)) {
      const target = path.resolve(root, relative)
      const checkpointStore = !isOutside(scan.storageRoot, target)
      if (isOutside(root, target) || excludedPath(target) || checkpointStore)
        continue
      if (scan.paths.size >= MAX_FILES)
        throw new Error('Snapshot file budget exceeded')
      scan.paths.add(target)
    }
    return true
  } catch (error) {
    const notRepository = (error as { stderr?: string }).stderr?.includes(
      'not a git repository',
    )
    if (notRepository || (error as NodeJS.ErrnoException).code === 'ENOENT')
      return false
    throw error
  }
}

async function ignoredGitRoot(
  root: string,
  options: ExecFileOptionsWithStringEncoding,
) {
  try {
    await execute('git', ['check-ignore', '-q', '--', root + path.sep], options)
    return true
  } catch (error) {
    if ((error as { code?: number }).code === 1) return false
    throw error
  }
}

/** Reads exact bytes while rejecting links and files that change during capture. */
export async function captureFile(
  storage: CheckpointStorage,
  target: string,
): Promise<FileState | undefined> {
  await assertPlainPath(target)
  let info
  try {
    info = await lstat(target)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }

  if (!info.isFile() || info.nlink > 1)
    throw new Error('Unsupported file type or hard link')
  if (info.size > MAX_FILE_BYTES)
    throw new Error('File exceeds snapshot byte budget')

  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat()
    if (before.size > MAX_FILE_BYTES)
      throw new Error('File exceeds snapshot byte budget')

    const bytes = Buffer.alloc(before.size + 1)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    const after = await file.stat()

    const changed =
      before.size !== bytesRead ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== info.ino
    if (changed) throw new Error('File changed during snapshot')

    return {
      hash: await storage.blob(bytes.subarray(0, bytesRead)),
      size: bytesRead,
      mode: before.mode & 0o777,
    }
  } finally {
    await file.close()
  }
}

export function sameFile(left?: FileState, right?: FileState) {
  return left?.hash === right?.hash && left?.mode === right?.mode
}
