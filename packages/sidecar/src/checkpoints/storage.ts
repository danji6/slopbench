import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import { assertPlainPath, dataRoot, isMissing } from '../agent-files/storage'

export const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex')

/** Writes checkpoint records durably before acknowledging their transition. */
export class CheckpointStorage {
  constructor(readonly root = path.join(dataRoot(), 'turn-checkpoints')) {}

  private filename(kind: string, id: string) {
    return path.join(this.root, kind, digest(id))
  }

  async read<T>(kind: string, id: string): Promise<T | undefined> {
    const filename = this.filename(kind, id)
    await assertPlainPath(filename)
    try {
      return JSON.parse(await readFile(filename, 'utf8')) as T
    } catch (error) {
      if (isMissing(error)) return undefined
      throw new Error(`Cannot read checkpoint ${kind}: ${String(error)}`, {
        cause: error,
      })
    }
  }

  async records<T>(kind: string): Promise<T[]> {
    const directory = path.join(this.root, kind)
    await assertPlainPath(directory)
    let names: string[]
    try {
      names = await readdir(directory)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const records: T[] = []
    for (const name of names) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue
      const filename = path.join(directory, name)
      await assertPlainPath(filename)
      records.push(JSON.parse(await readFile(filename, 'utf8')))
    }
    return records
  }

  async save(kind: string, id: string, value: unknown) {
    await this.atomic(
      this.filename(kind, id),
      Buffer.from(JSON.stringify(value)),
    )
  }

  async remove(kind: string, id: string) {
    const filename = this.filename(kind, id)
    await assertPlainPath(filename)
    await rm(filename, { force: true })
  }

  async blob(bytes: Buffer) {
    const hash = digest(bytes)
    const filename = this.filename('blobs', hash)
    await assertPlainPath(filename)
    try {
      await readFile(filename)
    } catch (error) {
      if (!isMissing(error)) throw error
      await this.atomic(filename, bytes)
    }
    return hash
  }

  async bytes(hash: string) {
    const filename = this.filename('blobs', hash)
    await assertPlainPath(filename)
    const bytes = await readFile(filename)
    if (digest(bytes) !== hash) throw new Error('Checkpoint blob is corrupt')
    return bytes
  }

  async collectBlobs(referenced: Set<string>) {
    const directory = path.join(this.root, 'blobs')
    await assertPlainPath(directory)
    const retained = new Set([...referenced].map(digest))
    let names: string[]
    try {
      names = await readdir(directory)
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    for (const name of names) {
      if (/^[a-f0-9]{64}$/.test(name) && !retained.has(name)) {
        await rm(path.join(directory, name))
      }
    }
  }

  private async atomic(filename: string, bytes: Buffer) {
    await assertPlainPath(filename)
    const directory = path.dirname(filename)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${filename}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, filename)
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}
