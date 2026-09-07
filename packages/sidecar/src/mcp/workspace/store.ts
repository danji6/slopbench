import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = process.env.CHAT_SIDECAR_DATA_DIR
if (!DATA_DIR) throw new Error('Sidecar data directory must be set.')

const STORE_PATH =
  process.env.CHAT_WORKSPACE_STORE ?? path.join(DATA_DIR, 'workspaces.json')

const CHECKPOINT_DIR =
  process.env.CHAT_WORKSPACE_CHECKPOINTS ?? path.join(DATA_DIR, 'checkpoints')

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
  external: boolean
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

type FileSnapshot = { existed: boolean; content?: string }

/** Reads the current file state used both to detect no-ops and to checkpoint. */
export async function readSnapshot(
  absolutePath: string,
): Promise<FileSnapshot> {
  try {
    const targetStat = await stat(absolutePath)
    if (!targetStat.isFile()) throw new Error('Path is not a file')
    return { existed: true, content: await readFile(absolutePath, 'utf-8') }
  } catch (error) {
    // Only a missing file may be checkpointed without its previous contents
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return { existed: false }
    }
    throw error
  }
}

export async function createCheckpoint(input: {
  sessionId: string
  workspaceId: string
  absolutePath: string
  relativePath: string
  external: boolean
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
    external: input.external,
    existed: input.snapshot.existed,
    contentPath,
    createdAt: Date.now(),
  }
  await updateStore((state) => {
    state.checkpoints.push(checkpoint)
  })
  return checkpoint
}

export async function withFileQueue<T>(filePath: string, fn: () => Promise<T>) {
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

export async function readStore(): Promise<StoreState> {
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

export async function updateStore<T>(
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
