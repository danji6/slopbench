import type { McpRuntimeScope } from '@sb/core/types'
import type { McpOperationStatus } from '@sb/core/types/mcp-operation'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import path from 'node:path'

import { assertPlainPath } from '../../agent-files/storage'

export type OperationRecord = McpOperationStatus & {
  scope: McpRuntimeScope
  fingerprint: string
  updatedAt: number
}

/** Journals dispatch before execution and retains canonical results until acknowledgement. */
export class McpOperationStore {
  constructor(private readonly root: string) {}

  private filename(id: string, suffix: string) {
    const key = createHash('sha256').update(id).digest('hex')
    return path.join(this.root, `${key}.${suffix}`)
  }

  async initialize() {
    await assertPlainPath(this.root)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
  }

  async records() {
    const names = await readdir(this.root)
    const records: OperationRecord[] = []
    for (const name of names) {
      if (name.endsWith('.tmp')) {
        await rm(path.join(this.root, name))
        continue
      }
      if (!name.endsWith('.json')) continue
      const filename = path.join(this.root, name)
      await assertPlainPath(filename)
      records.push(JSON.parse(await readFile(filename, 'utf8')))
    }
    return records
  }

  async save(record: OperationRecord) {
    await this.atomic(this.filename(record.id, 'json'), JSON.stringify(record))
  }

  async result(id: string) {
    const filename = this.filename(id, 'result')
    await assertPlainPath(filename)
    return readFile(filename)
  }

  async saveResult(id: string, text: string) {
    const data = JSON.stringify(text)
    await this.atomic(this.filename(id, 'result'), data)
    return Buffer.byteLength(data)
  }

  async resultSize(id: string) {
    try {
      return (await stat(this.filename(id, 'result'))).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }

  async acknowledge(id: string) {
    await rm(this.filename(id, 'result'), { force: true })
  }

  async forget(id: string) {
    await this.acknowledge(id)
    await rm(this.filename(id, 'json'), { force: true })
  }

  private async atomic(filename: string, data: string) {
    await assertPlainPath(filename)
    const temporary = `${filename}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(data)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, filename)
    const directory = await open(this.root, 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
}
