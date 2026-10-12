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
  rmdir,
} from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { assertPlainPath, isMissing } from './storage'

type CreatedEntry = {
  target: string
  temporary?: string
  inode: string
  device: string
  directory: boolean
}

/** Publishes a staged home without replacing existing files; journals rollback incrementally. */
export async function publishTree(
  source: string,
  target: string,
  operation: string,
) {
  const journal = path.join(operation, 'created.ndjson')
  await rollback(journal)
  await assertNoConflicts(source, target)
  try {
    await publishEntries(source, target, journal)
  } catch (error) {
    await rollback(journal)
    throw error
  }
}

async function assertNoConflicts(source: string, target: string) {
  await assertPlainPath(target)
  const input = await lstat(source)

  let existing
  try {
    existing = await lstat(target)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  if (existing && (!input.isDirectory() || !existing.isDirectory()))
    throw new Error(`Destination already exists: ${target}`)

  if (input.isDirectory()) {
    for await (const entry of await opendir(source))
      await assertNoConflicts(
        path.join(source, entry.name),
        path.join(target, entry.name),
      )
  }
}

async function publishEntries(source: string, target: string, journal: string) {
  const info = await lstat(source)
  if (!info.isDirectory())
    return publishFile(source, target, journal, info.mode)

  let created = false
  try {
    await mkdir(target)
    created = true
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'EEXIST'
    )) {
      throw error
    }
  }

  if (created) await recordCreated(journal, target, true)

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
  journal: string,
  mode: number,
) {
  await assertPlainPath(target)
  const temporary = path.join(
    path.dirname(target),
    `.${APP_ID}-${randomUUID()}`,
  )
  const file = await open(temporary, 'wx', (mode & 0o777) | 0o600)
  await file.close()
  await recordCreated(journal, target, false, temporary)
  await pipeline(createReadStream(source), createWriteStream(temporary))
  // Hard-linking from a sibling temporary file is atomic and refuses existing targets
  await link(temporary, target)
  await rm(temporary)
}

async function recordCreated(
  journal: string,
  target: string,
  directory: boolean,
  temporary?: string,
) {
  const info = await lstat(temporary ?? target, { bigint: true })
  const entry: CreatedEntry = {
    target,
    temporary,
    directory,
    inode: info.ino.toString(),
    device: info.dev.toString(),
  }
  await appendFile(journal, `${JSON.stringify(entry)}\n`)
}

/** Removes only entries bearing this operation's recorded inode; preserves unrelated data. */
async function rollback(journal: string) {
  for await (const entry of reverseJournal(journal)) {
    await removeOwned(entry.target, entry)
    if (entry.temporary) {
      await removeOwned(entry.temporary, entry)
    }
  }
  await rm(journal, { force: true })
}

async function removeOwned(target: string, entry: CreatedEntry) {
  await assertPlainPath(target)

  let info
  try {
    info = await lstat(target, { bigint: true })
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }

  if (
    info.ino.toString() !== entry.inode ||
    info.dev.toString() !== entry.device
  ) {
    throw new Error(`Interrupted publish conflicts with ${target}`)
  }

  if (entry.directory) {
    await rmdir(target)
  } else {
    await rm(target)
  }
}

/** Streams the journal backwards so children are removed before parents. */
async function* reverseJournal(filename: string): AsyncGenerator<CreatedEntry> {
  let file
  try {
    file = await open(filename, 'r')
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }

  try {
    let position = (await file.stat()).size
    let pending: Buffer = Buffer.alloc(0)
    while (position > 0) {
      const length = Math.min(position, 64 * 1024)
      position -= length
      const bytes = Buffer.alloc(length)
      await file.read(bytes, 0, length, position)
      const combined = Buffer.concat([bytes, pending])
      let end = combined.length
      for (let i = combined.length - 1; i >= 0; i--) {
        if (combined[i] !== 10) continue
        if (i + 1 < end) {
          yield JSON.parse(
            combined.subarray(i + 1, end).toString('utf8'),
          ) as CreatedEntry
        }
        end = i
      }
      pending = Buffer.from(combined.subarray(0, end))
    }
    if (pending.length)
      yield JSON.parse(pending.toString('utf8')) as CreatedEntry
  } finally {
    await file.close()
  }
}
