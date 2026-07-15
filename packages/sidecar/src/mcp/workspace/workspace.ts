import {
  applyEdits,
  createUnifiedDiff,
  detectLineEnding,
  isUnchangedWrite,
  normalizeToLf,
  restoreLineEndings,
  stripBom,
} from '@sb/core/workspace/edit'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { z } from 'zod'

import { runCommand } from './command'
import { expandHome } from './paths'

const DATA_DIR = process.env.CHAT_SIDECAR_DATA_DIR
if (!DATA_DIR) throw new Error('Sidecar data directory must be set.')

const STORE_PATH =
  process.env.CHAT_WORKSPACE_STORE ?? path.join(DATA_DIR, 'workspaces.json')

const CHECKPOINT_DIR =
  process.env.CHAT_WORKSPACE_CHECKPOINTS ?? path.join(DATA_DIR, 'checkpoints')

const MAX_READ_BYTES = 50_000

const WORKSPACE_INSTRUCTIONS_FILE = 'AGENTS.md'
const MAX_WORKSPACE_INSTRUCTIONS_BYTES = 64_000

export const bindWorkspaceSchema = z.object({
  sessionId: z.string(),
  root: z.string().min(1),
})

export const clearWorkspaceSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string().optional(),
})

export const restoreCheckpointSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
})

export const readWorkspaceInstructionsSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
})

export const previewDiffSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  filePath: z.string(),
  content: z.string().optional(),
  edits: z
    .array(z.object({ oldText: z.string(), newText: z.string() }))
    .optional(),
})

export type WorkspaceRef = {
  workspaceId: string
  label: string
}

type WorkspaceRecord = WorkspaceRef & {
  sessionId: string
  root: string
  createdAt: number
  updatedAt: number
}

type CheckpointRecord = {
  checkpointId: string
  sessionId: string
  workspaceId: string
  relativePath: string
  absolutePath: string
  existed: boolean
  contentPath?: string
  createdAt: number
}

type StoreState = {
  workspaces: Record<string, WorkspaceRecord>
  checkpoints: CheckpointRecord[]
}

const defaultState: StoreState = { workspaces: {}, checkpoints: [] }
const fileQueues = new Map<string, Promise<void>>()
let storeQueue = Promise.resolve()

export async function bindWorkspace(
  input: z.infer<typeof bindWorkspaceSchema>,
) {
  const root = await realpath(path.resolve(expandHome(input.root)))
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) throw new Error('Workspace must be a directory')

  return updateStore((state) => {
    const existing = Object.values(state.workspaces).find(
      (item) => item.sessionId === input.sessionId,
    )
    const workspaceId = existing?.workspaceId ?? randomUUID()
    const now = Date.now()

    state.workspaces[workspaceId] = {
      workspaceId,
      sessionId: input.sessionId,
      root,
      label: path.basename(root) || root,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    const record = state.workspaces[workspaceId]
    return { workspaceId, label: record.label, path: record.root }
  })
}

export async function clearWorkspace(
  input: z.infer<typeof clearWorkspaceSchema>,
) {
  await updateStore((state) => {
    for (const [workspaceId, workspace] of Object.entries(state.workspaces)) {
      if (
        workspace.sessionId === input.sessionId &&
        (!input.workspaceId || input.workspaceId === workspaceId)
      ) {
        delete state.workspaces[workspaceId]
      }
    }
    state.checkpoints = state.checkpoints.filter(
      (checkpoint) => checkpoint.sessionId !== input.sessionId,
    )
  })
  return { ok: true }
}

export async function readWorkspaceFile(input: {
  sessionId: string
  workspaceId: string
  filePath: string
  offset?: number
  limit?: number
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const target = await resolveExistingFile(workspace.root, input.filePath)
  const buffer = await readFile(target.absolutePath)
  const raw = buffer.toString('utf-8')
  const lines = raw.split(/\r?\n/)
  const offset = Math.max(1, input.offset ?? 1)
  const start = offset - 1
  const selected =
    input.limit && input.limit > 0
      ? lines.slice(start, start + input.limit)
      : lines.slice(start)

  let content = selected.join('\n')
  let truncated = false
  if (content.length > MAX_READ_BYTES) {
    content = `${content.slice(0, MAX_READ_BYTES)}\n[truncated]`
    truncated = true
  }

  return {
    path: target.relativePath,
    content,
    totalLines: lines.length,
    offset,
    truncated,
  }
}

export async function readWorkspaceInstructions(
  input: z.infer<typeof readWorkspaceInstructionsSchema>,
) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const target = await resolveOptionalWorkspaceInstructions(workspace.root)
  if (!target) return null

  const buffer = await readFile(target.absolutePath)
  const raw = buffer.toString('utf-8')
  const { content, truncated } = capUtf8Content(
    raw,
    MAX_WORKSPACE_INSTRUCTIONS_BYTES,
  )

  return {
    path: target.relativePath,
    content,
    truncated,
  }
}

export async function writeWorkspaceFile(input: {
  sessionId: string
  workspaceId: string
  filePath: string
  content: string
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const target = await resolveWritablePath(workspace.root, input.filePath)

  return withFileQueue(target.absolutePath, async () => {
    const snapshot = await readSnapshot(target.absolutePath)

    // Reject empty diffs
    if (
      snapshot.existed &&
      isUnchangedWrite(snapshot.content ?? '', input.content)
    ) {
      throw new Error(
        `No changes made to ${target.relativePath}. The file already contains this content.`,
      )
    }

    const checkpoint = await createCheckpoint({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      snapshot,
    })

    await mkdir(path.dirname(target.absolutePath), { recursive: true })
    await writeFile(target.absolutePath, input.content, 'utf-8')

    return {
      path: target.relativePath,
      bytes: Buffer.byteLength(input.content),
      checkpointId: checkpoint.checkpointId,
      diff: capDiff(
        createUnifiedDiff(
          target.relativePath,
          normalizeToLf(stripBom(snapshot.content ?? '').text),
          normalizeToLf(stripBom(input.content).text),
        ),
      ),
    }
  })
}

export async function editWorkspaceFile(input: {
  sessionId: string
  workspaceId: string
  filePath: string
  edits: Array<{ oldText: string; newText: string }>
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const target = await resolveExistingFile(workspace.root, input.filePath)

  return withFileQueue(target.absolutePath, async () => {
    const snapshot = await readSnapshot(target.absolutePath)
    const { bom, text } = stripBom(snapshot.content ?? '')
    const ending = detectLineEnding(text)
    const baseContent = normalizeToLf(text)
    const newContent = applyEdits(baseContent, input.edits, target.relativePath)

    const checkpoint = await createCheckpoint({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      snapshot,
    })

    await writeFile(
      target.absolutePath,
      bom + restoreLineEndings(newContent, ending),
      'utf-8',
    )

    return {
      path: target.relativePath,
      edits: input.edits.length,
      checkpointId: checkpoint.checkpointId,
      diff: capDiff(
        createUnifiedDiff(target.relativePath, baseContent, newContent),
      ),
    }
  })
}

/** Simulate a unified diff for the given input. */
export async function previewWorkspaceDiff(
  input: z.infer<typeof previewDiffSchema>,
): Promise<{ diff: string }> {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)

  try {
    if (input.edits?.length) {
      const target = await resolveExistingFile(workspace.root, input.filePath)
      const snapshot = await readSnapshot(target.absolutePath)
      const baseContent = normalizeToLf(stripBom(snapshot.content ?? '').text)
      const newContent = applyEdits(
        baseContent,
        input.edits,
        target.relativePath,
      )

      return {
        diff: capDiff(
          createUnifiedDiff(target.relativePath, baseContent, newContent),
        ),
      }
    }

    if (input.content !== undefined) {
      const target = await resolveWritablePath(workspace.root, input.filePath)
      const snapshot = await readSnapshot(target.absolutePath)
      const baseContent = normalizeToLf(stripBom(snapshot.content ?? '').text)
      const newContent = normalizeToLf(stripBom(input.content).text)

      return {
        diff: capDiff(
          createUnifiedDiff(target.relativePath, baseContent, newContent),
        ),
      }
    }
  } catch {
    // No-op, client will use a fallback
  }

  return { diff: '' }
}

export async function runWorkspaceCommand(input: {
  sessionId: string
  workspaceId: string
  command: string
  timeout?: number
  signal?: AbortSignal
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  return runCommand(
    input.command,
    workspace.root,
    input.timeout ?? 30,
    input.signal,
  )
}

const MAX_GLOB_MATCHES = 256
const GLOB_CHARS = /[*?[\]{}]/

const SAFE_DEVICE_PATHS = new Set([
  '/dev/null',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/tty',
])

/**
 * Check which paths are ignored by git, or live outside the
 * workspace root, including `~` and `$VAR`-based paths that cannot
 * be resolved statically. Globs are expanded (e.g. `cat .env*`).
 */
export async function checkFlaggedPaths(input: {
  sessionId: string
  workspaceId: string
  paths: string[]
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const flagged = new Set<string>()
  const inside = new Set<string>()

  for (const candidate of input.paths) {
    if (candidate.startsWith('~') || isVariablePath(candidate)) {
      flagged.add(candidate)
      continue
    }

    const absolute = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(workspace.root, candidate)
    const relative = path.relative(workspace.root, absolute)

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      if (!SAFE_DEVICE_PATHS.has(absolute)) flagged.add(absolute)
      continue
    }

    if (relative) inside.add(relative.split(path.sep).join('/'))
    if (GLOB_CHARS.test(candidate)) {
      for (const match of await expandGlob(workspace.root, candidate))
        inside.add(match)
    }
  }

  if (inside.size > 0) {
    for (const ignored of await gitCheckIgnore(workspace.root, [...inside]))
      flagged.add(ignored)
  }

  return { flagged: [...flagged] }
}

/** Paths like `$HOME/.ssh` expand at runtime and cannot be verified. */
function isVariablePath(candidate: string) {
  return /\$[A-Za-z_{]/.test(candidate) && candidate.includes('/')
}

async function expandGlob(root: string, pattern: string): Promise<string[]> {
  try {
    const matches = await glob(pattern, { cwd: root, dot: true })
    return matches
      .slice(0, MAX_GLOB_MATCHES)
      .map((match) => match.split(path.sep).join('/'))
  } catch {
    // Invalid patterns expand to nothing
    return []
  }
}

function gitCheckIgnore(root: string, paths: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn('git', ['check-ignore', '-z', '--stdin'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 10_000,
    })

    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.on('close', () => resolve(stdout.split('\0').filter(Boolean)))
    child.on('error', () => resolve([]))

    child.stdin.write(paths.join('\0') + '\0')
    child.stdin.end()
  })
}

export async function restoreLatestCheckpoint(
  input: z.infer<typeof restoreCheckpointSchema>,
) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  return updateStore(async (state) => {
    const checkpoint = [...state.checkpoints]
      .reverse()
      .find(
        (item) =>
          item.sessionId === input.sessionId &&
          item.workspaceId === input.workspaceId,
      )

    if (!checkpoint) throw new Error('No checkpoint to restore')
    assertInside(workspace.root, checkpoint.absolutePath)

    if (!checkpoint.existed) {
      await rm(checkpoint.absolutePath, { force: true })
    } else if (checkpoint.contentPath) {
      const content = await readFile(checkpoint.contentPath, 'utf-8')
      await mkdir(path.dirname(checkpoint.absolutePath), { recursive: true })
      await writeFile(checkpoint.absolutePath, content, 'utf-8')
    }

    state.checkpoints = state.checkpoints.filter(
      (item) => item.checkpointId !== checkpoint.checkpointId,
    )
    return {
      restored: checkpoint.relativePath,
      checkpointId: checkpoint.checkpointId,
    }
  })
}

export async function requireWorkspace(sessionId: string, workspaceId: string) {
  const state = await readStore()
  const workspace = state.workspaces[workspaceId]
  if (!workspace || workspace.sessionId !== sessionId) {
    throw new Error('Workspace is not configured for this session')
  }
  return { ...workspace, root: await realpath(workspace.root) }
}

export async function resolveExistingFile(root: string, filePath: string) {
  const absolutePath = await resolveWorkspacePath(root, filePath, true)
  const fileStat = await stat(absolutePath)
  if (!fileStat.isFile()) throw new Error('Path is not a file')
  return { absolutePath, relativePath: toRelativePath(root, absolutePath) }
}

/** Resolve an existing file or directory, reporting which kind it is. */
export async function resolveExistingPath(root: string, filePath: string) {
  const absolutePath = await resolveWorkspacePath(root, filePath, true)
  const pathStat = await stat(absolutePath)
  return {
    absolutePath,
    relativePath: toRelativePath(root, absolutePath),
    isDirectory: pathStat.isDirectory(),
    isFile: pathStat.isFile(),
  }
}

async function resolveOptionalWorkspaceInstructions(root: string) {
  try {
    return await resolveExistingFile(root, WORKSPACE_INSTRUCTIONS_FILE)
  } catch (err) {
    if (isMissingPathError(err) || isNotFileError(err)) return null
    throw err
  }
}

async function resolveWritablePath(root: string, filePath: string) {
  const absolutePath = await resolveWorkspacePath(root, filePath, false)
  return { absolutePath, relativePath: toRelativePath(root, absolutePath) }
}

async function resolveWorkspacePath(
  root: string,
  filePath: string,
  mustExist: boolean,
) {
  const rootReal = await realpath(root)
  const candidate = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(rootReal, filePath)

  assertInside(rootReal, candidate)

  if (mustExist) {
    const targetReal = await realpath(candidate)
    assertInside(rootReal, targetReal)
    return targetReal
  }

  try {
    const targetReal = await realpath(candidate)
    assertInside(rootReal, targetReal)
  } catch (err) {
    if (!isMissingPathError(err)) throw err
  }

  const parentReal = await nearestExistingParent(candidate)
  assertInside(rootReal, parentReal)
  return candidate
}

async function nearestExistingParent(filePath: string): Promise<string> {
  let current = path.dirname(filePath)
  while (true) {
    try {
      return await realpath(current)
    } catch {
      const next = path.dirname(current)
      if (next === current) throw new Error('No writable parent directory')
      current = next
    }
  }
}

function isMissingPathError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function isNotFileError(error: unknown) {
  return error instanceof Error && error.message === 'Path is not a file'
}

function assertInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    return
  }
  throw new Error('Path escapes the configured workspace')
}

function toRelativePath(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join('/')
}

const MAX_DIFF_BYTES = 50_000

function capDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_BYTES) return diff
  return `${diff.slice(0, MAX_DIFF_BYTES)}\n[diff truncated]`
}

function capUtf8Content(content: string, maxBytes: number) {
  if (Buffer.byteLength(content, 'utf-8') <= maxBytes) {
    return { content, truncated: false }
  }

  let capped = content.slice(0, maxBytes)
  while (Buffer.byteLength(capped, 'utf-8') > maxBytes) {
    capped = capped.slice(0, -1)
  }

  return { content: `${capped}\n[truncated]`, truncated: true }
}

type FileSnapshot = { existed: boolean; content?: string }

/** Reads the current file state used both to detect no-ops and to checkpoint. */
async function readSnapshot(absolutePath: string): Promise<FileSnapshot> {
  try {
    const targetStat = await stat(absolutePath)
    if (!targetStat.isFile()) return { existed: false }
    return { existed: true, content: await readFile(absolutePath, 'utf-8') }
  } catch {
    // Missing files are valid for create/overwrite checkpoints
    return { existed: false }
  }
}

async function createCheckpoint(input: {
  sessionId: string
  workspaceId: string
  absolutePath: string
  relativePath: string
  snapshot: FileSnapshot
}) {
  const checkpointId = randomUUID()
  await mkdir(CHECKPOINT_DIR, { recursive: true })

  let contentPath: string | undefined
  if (input.snapshot.existed && input.snapshot.content !== undefined) {
    contentPath = path.join(CHECKPOINT_DIR, `${checkpointId}.txt`)
    await writeFile(contentPath, input.snapshot.content, 'utf-8')
  }

  const checkpoint: CheckpointRecord = {
    checkpointId,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    relativePath: input.relativePath,
    absolutePath: input.absolutePath,
    existed: input.snapshot.existed,
    contentPath,
    createdAt: Date.now(),
  }
  await updateStore((state) => {
    state.checkpoints.push(checkpoint)
  })
  return checkpoint
}

async function withFileQueue<T>(filePath: string, fn: () => Promise<T>) {
  const current = fileQueues.get(filePath) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = current.then(() => next)
  fileQueues.set(filePath, queued)
  await current
  try {
    return await fn()
  } finally {
    release()
    if (fileQueues.get(filePath) === queued) fileQueues.delete(filePath)
  }
}

async function readStore(): Promise<StoreState> {
  try {
    return JSON.parse(await readFile(STORE_PATH, 'utf-8')) as StoreState
  } catch {
    return { ...defaultState, workspaces: {}, checkpoints: [] }
  }
}

async function writeStore(state: StoreState) {
  const dir = path.dirname(STORE_PATH)
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `workspaces-${randomUUID()}.json.tmp`)
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
  await rename(tmp, STORE_PATH)
}

async function updateStore<T>(
  fn: (state: StoreState) => T | Promise<T>,
): Promise<T> {
  const run = storeQueue.then(async () => {
    const state = await readStore()
    const result = await fn(state)
    await writeStore(state)
    return result
  })
  storeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
