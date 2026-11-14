import { lookup } from 'mime-types'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import {
  link,
  lstat,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import {
  assertPlainPath,
  dataRoot,
  identifier,
  isMissing,
} from '../agent-files/storage'
import {
  assertRegularFile,
  ensurePlainDirectory,
  sessionFilePath,
} from './storage'

type Transfer = { sessionId: string; operationId: string; path: string }
type Copy = Transfer & { url: string; byteLength: number }
type Publish = Transfer & { url: string; filename?: string }

function transferDirectory(operationId: string) {
  return path.join(dataRoot(), 'attachment-transfers', identifier(operationId))
}

function stagedFile(operationId: string) {
  return path.join(transferDirectory(operationId), 'bytes')
}

export async function removeTransfer(operationId: string) {
  const directory = transferDirectory(operationId)
  await assertPlainPath(directory)
  await rm(directory, { recursive: true, force: true })
}

export async function stageCopy(input: Copy, signal: AbortSignal) {
  sessionFilePath(input.sessionId, input.path)
  const stage = stagedFile(input.operationId)
  await ensurePlainDirectory(path.dirname(stage))
  if (await lstat(stage).catch(missing)) return

  const response = await fetch(input.url, { signal, redirect: 'error' })
  if (!response.ok || !response.body)
    throw new Error('Attachment download failed')

  const partial = `${stage}.partial`
  await rm(partial, { force: true })
  try {
    await streamFile(response.body, partial, input.byteLength, signal)
    await rename(partial, stage)
  } finally {
    await rm(partial, { force: true })
  }
}

async function streamFile(
  body: ReadableStream<Uint8Array>,
  target: string,
  expected: number,
  signal: AbortSignal,
) {
  let size = 0
  const counter = new Transform({
    transform(chunk: Buffer, _, done) {
      size += chunk.length
      if (size > expected) done(new Error('Attachment size changed'))
      else done(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>),
    counter,
    createWriteStream(target, {
      flags: 'wx',
      mode: 0o600,
    }),
    { signal },
  )
  if (size !== expected) throw new Error('Attachment download was incomplete')
}

export async function commitCopy(input: Transfer) {
  const target = sessionFilePath(input.sessionId, input.path)
  const stage = stagedFile(input.operationId)

  await assertPlainPath(stage)
  await ensurePlainDirectory(path.dirname(target))
  await assertPlainPath(target)

  const existing = await lstat(target).catch(missing)
  if (existing) {
    const staged = await lstat(stage)
    if (existing.ino === staged.ino && existing.dev === staged.dev) return
    throw new Error('The destination file already exists')
  }

  await link(stage, target)
}

export async function rollbackCopy(input: Transfer) {
  const staged = stagedFile(input.operationId)
  await assertPlainPath(staged)
  const stage = await lstat(staged).catch(missing)
  if (!stage) return

  const target = sessionFilePath(input.sessionId, input.path)
  try {
    await assertPlainPath(target)
  } catch {
    // An unsafe replacement should never be opened or removed by cleanup.
    return
  }

  const existing = await lstat(target).catch(missing)
  if (existing && existing.ino === stage.ino && existing.dev === stage.dev)
    await rm(target)
}

export async function publishSnapshot(input: Publish, signal: AbortSignal) {
  const source = sessionFilePath(input.sessionId, input.path)
  const stage = stagedFile(input.operationId)
  const filename = attachmentName(input.filename ?? path.basename(source))
  const mediaType = lookup(filename) || 'application/octet-stream'
  const previous = await uploadedSnapshot(input.operationId)
  if (previous) return previous

  await ensurePlainDirectory(path.dirname(stage))
  if (!(await lstat(stage).catch(missing))) {
    const partial = `${stage}.partial`
    await rm(partial, { force: true })
    try {
      await snapshot(source, partial, signal)
      await rename(partial, stage)
    } finally {
      await rm(partial, { force: true })
    }
  }

  const storageId = await upload(stage, input.url, mediaType, signal)
  const result = { storageId, filename, mediaType }
  const receipt = `${stage}.json`

  await rm(`${receipt}.partial`, { force: true })
  await writeFile(`${receipt}.partial`, JSON.stringify(result), {
    flag: 'wx',
    mode: 0o600,
  })
  await rename(`${receipt}.partial`, receipt)

  return result
}

type UploadedSnapshot = {
  storageId: string
  filename: string
  mediaType: string
}

export async function uploadedSnapshot(operationId: string) {
  const receipt = `${stagedFile(operationId)}.json`
  await assertPlainPath(receipt)
  const record = await readFile(receipt, 'utf8').catch(missing)
  return record ? (JSON.parse(record) as UploadedSnapshot) : undefined
}

async function snapshot(source: string, target: string, signal: AbortSignal) {
  const expected = await assertRegularFile(source)
  const handle = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    assertUnchanged(expected, await handle.stat())
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      createWriteStream(target, {
        flags: 'wx',
        mode: 0o600,
      }),
      { signal },
    )
    assertUnchanged(expected, await handle.stat())
    assertUnchanged(expected, await assertRegularFile(source))
  } catch (error) {
    await rm(target, { force: true })
    throw error
  } finally {
    await handle.close()
  }
}

function assertUnchanged(
  before: Awaited<ReturnType<typeof assertRegularFile>>,
  after: typeof before,
) {
  const changed =
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    after.nlink !== 1
  if (!after.isFile() || changed)
    throw new Error('The source file changed while publishing')
}

async function upload(
  stage: string,
  url: string,
  type: string,
  signal: AbortSignal,
) {
  const { size } = await lstat(stage)
  const stream = createReadStream(stage)
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    body: Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
    duplex: 'half',
    headers: { 'content-type': type, 'content-length': String(size) },
    redirect: 'error',
    signal,
  }
  try {
    const response = await fetch(url, init)
    if (!response.ok) throw new Error('Attachment upload failed')
    const body = (await response.json()) as { storageId?: string }
    if (!body.storageId)
      throw new Error('Attachment upload returned no storage ID')
    return body.storageId
  } finally {
    stream.destroy()
  }
}

export function attachmentName(name: string) {
  if (
    !name.trim() ||
    name === '.' ||
    name === '..' ||
    /[/\\:\p{Cc}]/u.test(name)
  )
    throw new Error('Choose a valid attachment filename')
  return name
}

export function missing(error: unknown) {
  if (!isMissing(error)) throw error
  return undefined
}
