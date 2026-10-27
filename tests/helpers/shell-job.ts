import type { ShellToolOutput } from '@sb/convex/types'

export const context = { sessionId: 'session-1', workspaceId: 'ws-1' }

export type Call = { path: string; body: unknown }

export type Frame = {
  chunk: string
  status?: 'running' | 'done' | 'killed' | 'timeout'
  exitCode?: number | null
  background?: boolean
  waiting?: boolean
  /** Silence before this frame's events arrive. */
  delayMs?: number
}

export type SseEvent = { event: string; data: string; delayMs?: number }

/** Expands frames into the SSE events the sidecar route would emit. */
export function framesToEvents(frames: Frame[]): SseEvent[] {
  const events: SseEvent[] = []
  let offset = 0
  for (const frame of frames) {
    const frameEvents: SseEvent[] = []
    if (frame.chunk) {
      offset += frame.chunk.length
      frameEvents.push({
        event: 'chunk',
        data: JSON.stringify({ text: frame.chunk, nextOffset: offset }),
      })
    }
    if (frame.background || frame.waiting !== undefined) {
      frameEvents.push({
        event: 'meta',
        data: JSON.stringify({
          background: frame.background ?? false,
          waiting: frame.waiting ?? false,
        }),
      })
    }
    if (frame.status && frame.status !== 'running') {
      frameEvents.push({
        event: 'end',
        data: JSON.stringify({
          status: frame.status,
          exitCode: frame.exitCode ?? null,
        }),
      })
    }
    if (frame.delayMs && frameEvents[0]) frameEvents[0].delayMs = frame.delayMs
    events.push(...frameEvents)
  }
  return events
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), {
    name: 'AbortError',
  })
}

export function waitForAbort(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) return
    if (signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/**
 * Sidecar stub: `openStream` replays a single connection's SSE events. When
 * the frames never terminate, the stream stays open until aborted (mirroring
 * a live job), so the deadline / abort paths can drive teardown.
 */
export function mockSidecar(frames: Frame[]) {
  const calls: Call[] = []
  const queries: Record<string, string>[] = []
  let streamCount = 0

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    calls.push({ path, body })
    if (path === '/shell/start') return { jobId: 'job-1', mode: 'pipe' } as T
    if (path === '/shell/kill') return { ok: true } as T
    throw new Error(`Unexpected path ${path}`)
  }

  async function* openStream(
    _path: string,
    query: Record<string, string>,
    signal?: AbortSignal,
  ): AsyncGenerator<SseEvent> {
    streamCount += 1
    queries.push(query)
    const events = framesToEvents(frames)
    for (const event of events) {
      if (event.delayMs) await sleep(event.delayMs)
      if (signal?.aborted) throw abortError()
      yield event
    }
    // No terminal event scripted: keep the connection open until torn down.
    if (!events.some((e) => e.event === 'end')) {
      await waitForAbort(signal)
      throw abortError()
    }
  }

  return { post, openStream, calls, queries, streams: () => streamCount }
}

export async function collect(generator: AsyncGenerator<ShellToolOutput>) {
  const outputs: ShellToolOutput[] = []
  for await (const output of generator) outputs.push(output)
  return outputs
}

export const fast = { pollIntervalMs: 1 }
