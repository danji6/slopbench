import type { ShellJobStatus } from '@sb/core/shell/job-protocol'
import { OutputRing } from '@sb/sidecar/shell/output-ring'

import { waitForAbort } from './shell-job'

type Frame = { text?: string; status?: ShellJobStatus; exitCode?: number }
type ReadInput = { offset: number; limit?: number; tailChars?: number }

/** Uses the real output ring with deterministic snapshots and live frames. */
export function pageSidecar(
  initial = '',
  initialStatus: ShellJobStatus = 'done',
) {
  const ring = new OutputRing()
  ring.append(initial)
  let status = initialStatus
  let exitCode: number | null = status === 'running' ? null : 0
  let closed = 0
  const frames: Frame[] = []
  const offsets: number[] = []
  const reads: ReadInput[] = []

  const post = async <T>(path: string, value: unknown): Promise<T> => {
    if (path === '/shell/kill') {
      status = 'killed'
      return {} as T
    }
    if (path !== '/shell/poll') throw new Error(`Unexpected path ${path}`)
    const input = value as ReadInput
    reads.push(input)
    const page = ring.read(input.offset, input.limit)
    const end = ring.read(Number.MAX_SAFE_INTEGER).end
    const tail = ring.read(Math.max(0, end - (input.tailChars ?? 0)))
    return {
      chunk: page.text,
      nextOffset: page.end,
      bufferStart: page.start,
      bufferEnd: end,
      status,
      exitCode,
      waiting: false,
      term: tail.text,
      termOffset: tail.start,
    } as T
  }

  async function* openStream(
    _path: string,
    query: Record<string, string>,
    signal?: AbortSignal,
  ) {
    const offset = Number(query.offset)
    offsets.push(offset)
    try {
      const initial = ring.read(offset)
      if (initial.text)
        yield {
          event: 'chunk',
          data: JSON.stringify({ text: initial.text, nextOffset: initial.end }),
        }
      for (const frame of frames.splice(0)) {
        if (frame.status) {
          status = frame.status
          exitCode = frame.exitCode ?? 0
        }
        if (frame.text) {
          ring.append(frame.text)
          yield {
            event: 'chunk',
            data: JSON.stringify({
              text: frame.text,
              nextOffset: ring.read(Number.MAX_SAFE_INTEGER).end,
            }),
          }
        }
      }
      if (status !== 'running') {
        yield { event: 'end', data: JSON.stringify({ status, exitCode }) }
        return
      }
      await waitForAbort(signal)
    } finally {
      closed += 1
    }
  }

  return {
    post,
    openStream,
    frames,
    offsets,
    reads,
    ring,
    closed: () => closed,
  }
}
