import type { SSEStreamingApi } from 'hono/streaming'

import type { ShellJobStream, ShellStreamEvent } from './registry'

const PING_MS = 15_000
const PING = Symbol('ping')

/** Replays the snapshot then pushes live events, with an idle keep-alive ping. */
export async function pumpShellJobStream(
  sse: SSEStreamingApi,
  stream: ShellJobStream,
  maxBytes?: number,
) {
  const { initial, status, exitCode, background, waiting, registered, events } =
    stream
  let aborted = false
  let sent = 0
  sse.onAbort(() => {
    aborted = true
    stream.unsubscribe()
  })

  const budgetSpent = () => maxBytes !== undefined && sent >= maxBytes

  try {
    if (initial.chunk) {
      sent += await writeChunk(sse, {
        text: initial.chunk,
        nextOffset: initial.nextOffset,
        bufferStart: initial.bufferStart,
      })
    }

    if (!registered || status !== 'running') {
      await sse.writeSSE({
        event: 'end',
        data: JSON.stringify({ status, exitCode }),
      })
      return
    }

    if (budgetSpent()) return

    await sse.writeSSE({
      event: 'meta',
      data: JSON.stringify({ background, waiting }),
    })

    let pending = events.next()
    while (!aborted && !budgetSpent()) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const ping = new Promise<typeof PING>((resolve) => {
        timer = setTimeout(() => resolve(PING), PING_MS)
      })
      let result: IteratorResult<ShellStreamEvent> | typeof PING
      try {
        result = await Promise.race([pending, ping])
      } finally {
        clearTimeout(timer)
      }

      if (result === PING) {
        await sse.write(': ping\n\n')
        continue
      }
      if (result.done) break
      pending = events.next()
      const { open, bytes } = await writeEvent(sse, result.value)
      sent += bytes
      if (!open) break
    }
  } finally {
    stream.unsubscribe()
    await events.return?.(undefined).catch(() => {})
  }
}

/** Writes a chunk frame and returns the payload byte count. */
async function writeChunk(
  sse: SSEStreamingApi,
  payload: { text: string; nextOffset: number; bufferStart?: number },
): Promise<number> {
  const data = JSON.stringify(payload)
  await sse.writeSSE({ event: 'chunk', data })
  return data.length
}

/** Writes one event. `open` is false once the `end` event is sent. */
async function writeEvent(
  sse: SSEStreamingApi,
  ev: ShellStreamEvent,
): Promise<{ open: boolean; bytes: number }> {
  if (ev.type === 'chunk') {
    const bytes = await writeChunk(sse, {
      text: ev.text,
      nextOffset: ev.nextOffset,
    })
    return { open: true, bytes }
  }
  if (ev.type === 'meta') {
    await sse.writeSSE({
      event: 'meta',
      data: JSON.stringify({ background: ev.background, waiting: ev.waiting }),
    })
    return { open: true, bytes: 0 }
  }

  await sse.writeSSE({
    event: 'end',
    data: JSON.stringify({ status: ev.status, exitCode: ev.exitCode }),
  })
  return { open: false, bytes: 0 }
}
