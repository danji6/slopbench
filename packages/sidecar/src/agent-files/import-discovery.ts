import { SKILL_PAGE_SIZE } from '@sb/core/skills/types'
import type {
  SkillImportCandidate,
  SkillImportPage,
} from '@sb/core/skills/types'
import { errorMessage } from '@sb/core/utils/errors'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, opendir, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { expandHome } from '../mcp/workspace/paths'
import { readSkillMetadata } from './metadata'
import type { FileOperation } from './operations'
import { assertPlainPath, inside, isMissing, operationRoot } from './storage'
import { stripUploadHeader } from './upload'
import { extractSkillZip } from './zip'

/** Stores a streamed discovery manifest, so repository imports never need one huge response. */
export async function discoverImport(input: FileOperation) {
  if (!input.fileUrl && !input.source)
    throw new Error('Choose a directory or uploaded ZIP')

  const root = operationRoot(input.id)
  const source = input.fileUrl
    ? await extractImport(input, root)
    : await realpath(path.resolve(expandHome(input.source ?? '')))

  await assertPlainPath(source)
  if (!(await stat(source)).isDirectory())
    throw new Error('Choose a directory containing skills')
  if (inside(source, root))
    throw new Error('Import source cannot contain sidecar operation storage')

  const temporary = path.join(root, 'skills.tmp')
  const writer = createWriteStream(temporary)
  const completed = pipeline(Readable.from(discoveryLines(source)), writer)
  await completed
  await rename(temporary, path.join(root, 'skills.jsonl'))
  return { ok: true }
}

async function* discoveryLines(source: string): AsyncGenerator<string> {
  for await (const candidate of discoverSkills(source)) {
    yield `${JSON.stringify(candidate)}\n`
  }
}

/** Walks regular directories without following symlinks or Git's internal object store. */
async function* discoverSkills(
  root: string,
): AsyncGenerator<SkillImportCandidate> {
  await assertPlainPath(root)
  try {
    const manifest = await stat(path.join(root, 'SKILL.md'))
    if (manifest.isFile()) yield { path: root }
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  for await (const entry of await opendir(root)) {
    if (entry.isDirectory() && entry.name !== '.git')
      yield* discoverSkills(path.join(root, entry.name))
  }
}

async function extractImport(input: FileOperation, root: string) {
  const staging = path.join(root, 'bundle')
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  const archive = path.join(root, 'upload.zip')

  const response = await fetch(input.fileUrl!, { redirect: 'error' })
  if (!response.ok || !response.body)
    throw new Error('Could not download the uploaded skills')

  const download = Readable.fromWeb(
    response.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  )

  if (input.ticket) {
    await pipeline(
      download,
      stripUploadHeader(input.ticket),
      createWriteStream(archive),
    )
  } else {
    await pipeline(download, createWriteStream(archive))
  }
  await extractSkillZip(archive, staging)
  await rm(archive, { force: true })

  return staging
}

/** Returns a bounded page and a byte cursor into the durable discovery manifest. */
export async function importPage(
  id: string,
  cursor: number,
): Promise<SkillImportPage> {
  const filename = path.join(operationRoot(id), 'skills.jsonl')
  await assertPlainPath(filename)
  const size = (await stat(filename)).size
  const stream = createReadStream(filename, { start: cursor, highWaterMark: 16_384 }) // prettier-ignore
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  const entries: SkillImportPage['entries'] = []
  let nextCursor = cursor

  try {
    for await (const line of lines) {
      nextCursor += Buffer.byteLength(line) + 1
      const candidate = JSON.parse(line) as SkillImportCandidate
      entries.push({ ...(await candidateMetadata(candidate)), nextCursor })
      if (entries.length === SKILL_PAGE_SIZE) break
    }
  } finally {
    lines.close()
    stream.destroy()
  }

  return { entries, nextCursor, isDone: nextCursor >= size }
}

async function candidateMetadata(
  candidate: SkillImportCandidate,
): Promise<SkillImportCandidate> {
  try {
    return {
      path: candidate.path,
      metadata: await readSkillMetadata(candidate.path),
    }
  } catch (error) {
    return {
      path: candidate.path,
      error: errorMessage(error) ?? 'Invalid skill manifest',
    }
  }
}
