import { type ShellJobStatus } from './job-protocol'
import { type ShellStreamEvent } from './job-protocol'

/** Buffers a shell's live output/status into an async iterator for the SSE route. */
export class ShellJobSubscriber {
  private pendingChunk = ''
  private pendingMeta: { background: boolean; waiting: boolean } | null = null
  private ended: { status: ShellJobStatus; exitCode: number | null } | null =
    null
  private wake: (() => void) | null = null
  private cancelled = false

  constructor(private offset: number) {}

  readonly onChunk = (chunk: string) => {
    this.pendingChunk += chunk
    this.signal()
  }

  onMeta(background: boolean, waiting: boolean) {
    this.pendingMeta = { background, waiting }
    this.signal()
  }

  onEnd(status: ShellJobStatus, exitCode: number | null) {
    this.ended = { status, exitCode }
    this.signal()
  }

  cancel() {
    this.cancelled = true
    this.signal()
  }

  private signal() {
    if (this.wake) {
      const wake = this.wake
      this.wake = null
      wake()
    }
  }

  async *events(): AsyncGenerator<ShellStreamEvent> {
    while (true) {
      if (this.pendingChunk) {
        const text = this.pendingChunk
        this.pendingChunk = ''
        this.offset += text.length
        yield { type: 'chunk', text, nextOffset: this.offset }
        continue
      }
      if (this.pendingMeta) {
        const { background, waiting } = this.pendingMeta
        this.pendingMeta = null
        yield { type: 'meta', background, waiting }
        continue
      }
      if (this.ended) {
        yield { type: 'end', ...this.ended }
        return
      }
      if (this.cancelled) return
      await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }
}
