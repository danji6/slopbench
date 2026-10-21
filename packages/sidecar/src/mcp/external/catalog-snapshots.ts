import type { McpDefinition } from '@sb/core/types/mcp-catalog'
import { createHash, randomUUID } from 'node:crypto'

type Snapshot = { tools: McpDefinition[]; expires: number; bytes: number }

/** Holds short-lived, immutable discovery pages; capacity failures are explicit. */
export class CatalogSnapshots {
  private snapshots = new Map<string, Snapshot>()

  create(tools: McpDefinition[]) {
    this.prune()
    const bytes = Buffer.byteLength(JSON.stringify(tools))
    const used = [...this.snapshots.values()].reduce(
      (sum, item) => sum + item.bytes,
      0,
    )
    if (this.snapshots.size >= 16 || used + bytes > 128 * 1024 * 1024) {
      throw new Error(
        'MCP discovery snapshot capacity reached; retry after pending refreshes finish',
      )
    }
    const id = randomUUID()
    this.snapshots.set(id, { tools, bytes, expires: Date.now() + 300_000 })
    return {
      id,
      count: tools.length,
      fingerprint: createHash('sha256')
        .update(JSON.stringify(tools))
        .digest('hex'),
    }
  }

  page(id: string, cursor: number) {
    this.prune()
    const snapshot = this.snapshots.get(id)
    if (!snapshot)
      throw new Error('MCP discovery snapshot expired; refresh again')
    if (cursor > snapshot.tools.length)
      throw new Error('Invalid MCP catalog cursor')
    const tools: McpDefinition[] = []
    let bytes = 0
    while (cursor < snapshot.tools.length && tools.length < 32) {
      const tool = snapshot.tools[cursor]
      const size = Buffer.byteLength(JSON.stringify(tool))
      if (tools.length && bytes + size > 256 * 1024) break
      tools.push(tool)
      bytes += size
      cursor++
    }
    return {
      tools,
      nextCursor: cursor === snapshot.tools.length ? null : cursor,
    }
  }

  delete(id: string) {
    this.snapshots.delete(id)
  }

  private prune() {
    for (const [id, item] of this.snapshots) {
      if (item.expires < Date.now()) this.snapshots.delete(id)
    }
  }
}

export const catalogSnapshots = new CatalogSnapshots()
