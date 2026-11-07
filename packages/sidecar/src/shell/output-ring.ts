export const MAX_BUFFER_CHARS = 1_000_000

export type ChunkListener = (chunk: string) => void

export type RingSnapshot = { text: string; start: number; end: number }

export type RingSubscription = {
  initial: RingSnapshot
  unsubscribe: () => void
}

/**
 * Scrollback buffer addressed by absolute character offsets to let readers
 * detect gaps after the head is dropped.
 */
export class OutputRing {
  private buffer = ''
  private startOffset = 0
  private listeners = new Set<ChunkListener>()

  get endOffset(): number {
    return this.startOffset + this.buffer.length
  }

  append(text: string) {
    this.buffer += text
    if (this.buffer.length > MAX_BUFFER_CHARS) {
      const drop = this.buffer.length - MAX_BUFFER_CHARS
      this.buffer = this.buffer.slice(drop)
      this.startOffset += drop
    }
    for (const listener of this.listeners) listener(text)
  }

  read(from: number, limit?: number): RingSnapshot {
    const bufferEnd = this.endOffset
    const start = Math.min(Math.max(from, this.startOffset), bufferEnd)
    const end = Math.min(bufferEnd, start + (limit ?? this.buffer.length))
    return {
      text: this.buffer.slice(start - this.startOffset, end - this.startOffset),
      start,
      end,
    }
  }

  subscribe(from: number, onChunk: ChunkListener): RingSubscription {
    const initial = this.read(from)
    this.listeners.add(onChunk)
    return { initial, unsubscribe: () => this.listeners.delete(onChunk) }
  }
}
