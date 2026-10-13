import { APP_ID } from '@sb/core/const'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  appendFile,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  rm,
} from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'

import { assertPlainPath, isMissing } from './storage'

type CreatedEntry = {
  target: string
  temporary: string
  inode: string
  device: string
}
type Journal = { path: string; entries: Map<string, CreatedEntry> }

/** Resumes an additive copy without deleting or replacing destination contents. */
export async function publishTree(
  source: string,
  target: string,
  operation: string,
) {
  const journal = await readJournal(path.join(operation, 'created.ndjson'))
  await assertNoConflicts(source, target, journal)
  await publishEntries(source, target, journal)
}

/** Rejects every existing file except this operation's already published inode. */
async function assertNoConflicts(
  source: string,
  target: string,
  journal: Journal,
) {
  await assertPlainPath(target)
  const input = await lstat(source)
  const existing = await existingEntry(target)
  if (existing && (!input.isDirectory() || !existing.isDirectory())) {
    if (!input.isFile() || !matches(existing, journal.entries.get(target))) {
      throw new Error(`Destination already exists: ${target}`)
    }
  }
  if (input.isDirectory()) {
    for await (const entry of await opendir(source)) {
      await assertNoConflicts(
        path.join(source, entry.name),
        path.join(target, entry.name),
        journal,
      )
    }
  }
}

async function publishEntries(
  source: string,
  target: string,
  journal: Journal,
) {
  await assertPlainPath(target)
  const info = await lstat(source)
  if (!info.isDirectory())
    return publishFile(source, target, journal, info.mode)

  let created = false
  try {
    await mkdir(target)
    created = true
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
      throw error
    if (!(await lstat(target)).isDirectory())
      throw new Error(`Destination already exists: ${target}`, { cause: error })
  }
  for await (const entry of await opendir(source)) {
    await publishEntries(
      path.join(source, entry.name),
      path.join(target, entry.name),
      journal,
    )
  }
  if (created) await chmod(target, (info.mode & 0o777) | 0o700)
}

async function publishFile(
  source: string,
  target: string,
  journal: Journal,
  mode: number,
) {
  const prior = journal.entries.get(target)
  const existing = await existingEntry(target)
  if (existing) {
    if (!matches(existing, prior))
      throw new Error(`Destination already exists: ${target}`)
    // Preserve edits made after publication, including the acknowledgement gap
    return
  }

  const temporary = path.join(
    path.dirname(target),
    `.${APP_ID}-${randomUUID()}`,
  )
  const file = await open(temporary, 'wx', (mode & 0o777) | 0o600)
  try {
    await pipeline(
      createReadStream(source),
      createWriteStream(temporary, { fd: file.fd, autoClose: false }),
    )
    await file.sync()
    const info = await file.stat({ bigint: true })
    const entry = {
      target,
      temporary,
      inode: info.ino.toString(),
      device: info.dev.toString(),
    }
    await appendFile(journal.path, `${JSON.stringify(entry)}\n`)
    journal.entries.set(target, entry)
    // A sibling hard link publishes atomically and refuses any raced-in destination
    await assertPlainPath(target)
    await link(temporary, target)
  } finally {
    await file.close()
    await rm(temporary, { force: true })
  }
}

function matches(
  info: Awaited<ReturnType<typeof existingEntry>>,
  entry?: CreatedEntry,
) {
  return (
    !!info &&
    info.isFile() &&
    !!entry &&
    info.ino.toString() === entry.inode &&
    info.dev.toString() === entry.device
  )
}

async function existingEntry(target: string) {
  try {
    return await lstat(target, { bigint: true })
  } catch (error) {
    if (!isMissing(error)) throw error
    return null
  }
}

/** Reads only the operation's journal; copied files are never rollback targets. */
async function readJournal(filename: string): Promise<Journal> {
  const journal: Journal = { path: filename, entries: new Map() }
  let file
  try {
    file = await open(filename, 'r')
  } catch (error) {
    if (!isMissing(error)) throw error
    return journal
  }
  try {
    const lines = createInterface({
      input: file.createReadStream(),
      crlfDelay: Infinity,
    })
    for await (const line of lines) {
      if (!line) continue
      const entry = JSON.parse(line) as CreatedEntry
      journal.entries.set(entry.target, entry)
    }
  } finally {
    await file.close()
  }
  return journal
}
