import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, open, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { openPromise } from 'yauzl'

import { inside } from './storage'

export async function extractSkillZip(filename: string, destination: string) {
  const archive = await openPromise(filename, {
    strictFileNames: true,
    validateEntrySizes: true,
  })

  const recordRoot = path.join(
    path.dirname(destination),
    `.zip-entries-${randomUUID()}`,
  )

  await mkdir(recordRoot)

  try {
    for await (const entry of archive.eachEntry()) {
      const name = entry.fileName
      if (
        name.split('/').some((part) => part === '..') ||
        name.includes('\\') ||
        /^[a-z]:/i.test(name)
      ) {
        throw new Error('Invalid ZIP entry path')
      }

      const target = path.resolve(destination, name)
      if (!inside(destination, target) || target === destination)
        throw new Error('ZIP entry escapes the bundle')

      const identity = createHash('sha256').update(target).digest('hex')
      const record = await open(path.join(recordRoot, identity), 'wx')
      await record.close()

      const unixMode = entry.externalFileAttributes >>> 16
      const type = unixMode & 0o170000
      if (type && type !== 0o100000 && type !== 0o040000)
        throw new Error('ZIP symlinks and special files are not supported')

      if (name.endsWith('/')) {
        await mkdir(target, { recursive: true })
        continue
      }

      await mkdir(path.dirname(target), { recursive: true })
      await pipeline(
        await archive.openReadStreamPromise(entry),
        createWriteStream(target, { flags: 'wx' }),
      )
      if (unixMode & 0o111) await chmod(target, 0o755)
    }
  } finally {
    archive.close()
    await rm(recordRoot, { recursive: true, force: true })
  }
}
