import { extractErrorMessage } from '../../errors'
import type { ShellJobStatus, ShellToolOutput } from '../../types'
import { type ShellStreamEvent, openShellStream } from '../sidecar'
import { type ShellJobContext } from './shellContracts'
import { type PostSidecar } from './shellContracts'
import { type ShellJobOptions } from './shellContracts'
import { type ShellJobResume } from './shellContracts'
import { raceNextEvent } from './shellDeadlines'
import { runningPart } from './shellOutput'
import { TermOutputAccumulator } from './shellOutput'
import { finalOutput } from './shellOutput'
import { stillRunningOutput } from './shellOutput'
import { lostOutput } from './shellOutput'

export const POLL_INTERVAL_MS = 400

export const HEARTBEAT_MS = 5000

export const MAX_POLL_FAILURES = 3

export type WatchOptions = ShellJobOptions & {
  post: PostSidecar
  waitDeadline?: number
  detachOnBackground?: boolean
  seed?: ShellJobResume
}

export type WatchState = {
  output: TermOutputAccumulator
  offset: number
  lastYield: number
  /** True when the sidecar reports that the terminal is waiting for input. */
  waiting: boolean
}

/** Result of consuming a single SSE connection. */
export type ConnResult = 'ended' | 'reconnect'

export async function* watchJob(
  context: ShellJobContext,
  jobId: string,
  options: WatchOptions,
): AsyncGenerator<ShellToolOutput> {
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const output = new TermOutputAccumulator(options.seed)
  const state: WatchState = {
    output,
    offset: output.termEnd,
    lastYield: Date.now(),
    waiting: false,
  }
  let failures = 0

  while (true) {
    if (windowElapsed(options)) {
      yield runningPart(jobId, state)
      return
    }
    if (options.abortSignal?.aborted) {
      await killQuietly(context, jobId, options.post)
      yield finalOutput(jobId, 'killed', null, state.output)
      return
    }

    try {
      const result = yield* consumeConnection(context, jobId, options, state)
      if (result === 'ended') return
      failures = 0
      await sleep(interval)
    } catch (error) {
      if (options.abortSignal?.aborted) {
        await killQuietly(context, jobId, options.post)
        yield finalOutput(jobId, 'killed', null, state.output)
        return
      }
      if (isJobNotFound(error)) {
        yield lostOutput(jobId, state.output)
        return
      }
      failures += 1
      if (failures >= MAX_POLL_FAILURES) throw error
      await sleep(interval)
    }
  }
}

/**
 * Consumes one SSE connection. Yields preliminary/end parts. Returns
 * `ended` on a end condition (exit, detach, deadline) or `reconnect`
 * when the server closed the stream without an end event.
 */
export async function* consumeConnection(
  context: ShellJobContext,
  jobId: string,
  options: WatchOptions,
  state: WatchState,
): AsyncGenerator<ShellToolOutput, ConnResult> {
  const openStream = options.openStream ?? openShellStream
  // Own controller to reliably cancel the underlying fetch on teardown,
  // even when it is blocked on a stalled read
  const ac = new AbortController()
  const onUserAbort = () => ac.abort()
  if (options.abortSignal?.aborted) {
    ac.abort()
  } else {
    options.abortSignal?.addEventListener('abort', onUserAbort, { once: true })
  }

  const events = openStream(
    '/shell/stream',
    { sessionId: context.sessionId, jobId, offset: String(state.offset) },
    ac.signal,
  )

  try {
    // The first event is processed without a deadline race to make sure
    // the current output is always included
    const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS
    const deadline = earliest(options.waitDeadline, options.windowDeadline)
    let pending = events.next()
    let step = await pending
    while (true) {
      if (step.done) return 'reconnect'

      const outcome = handleStreamEvent(step.value, jobId, state, options)
      if (outcome.part) yield outcome.part
      if (outcome.done) return 'ended'

      pending = events.next()
      // Heartbeats keep racing the same pending event
      let raced = await raceNextEvent(
        pending,
        state.lastYield,
        deadline,
        heartbeatMs,
      )
      while (raced === 'heartbeat') {
        state.lastYield = Date.now()
        yield runningPart(jobId, state)
        raced = await raceNextEvent(
          pending,
          state.lastYield,
          deadline,
          heartbeatMs,
        )
      }
      if (raced === 'deadline') {
        // Leave it for the next watcher
        yield windowElapsed(options)
          ? runningPart(jobId, state)
          : stillRunningOutput(jobId, state.output)
        return 'ended'
      }
      step = raced.result
    }
  } finally {
    options.abortSignal?.removeEventListener('abort', onUserAbort)
    ac.abort()
    await events.return?.(undefined).catch(() => {})
  }
}

export function windowElapsed({ windowDeadline }: ShellJobOptions): boolean {
  return windowDeadline !== undefined && Date.now() >= windowDeadline
}

export function earliest(
  ...deadlines: (number | undefined)[]
): number | undefined {
  const set = deadlines.filter((deadline) => deadline !== undefined)
  return set.length ? Math.min(...set) : undefined
}

export type EventOutcome = { part?: ShellToolOutput; done?: boolean }

export function handleStreamEvent(
  event: ShellStreamEvent,
  jobId: string,
  state: WatchState,
  options: WatchOptions,
): EventOutcome {
  if (event.event === 'chunk') {
    const { text, nextOffset } = JSON.parse(event.data) as {
      text: string
      nextOffset?: number
    }
    state.output.append(text)
    state.offset =
      typeof nextOffset === 'number' ? nextOffset : state.offset + text.length
    state.lastYield = Date.now()
    return { part: runningPart(jobId, state) }
  }
  if (event.event === 'meta') {
    const { background, waiting } = JSON.parse(event.data) as {
      background: boolean
      waiting?: boolean
    }
    if (options.detachOnBackground && background) {
      return { part: stillRunningOutput(jobId, state.output), done: true }
    }
    const nextWaiting = waiting ?? false
    if (nextWaiting === state.waiting) return {}
    state.waiting = nextWaiting
    state.lastYield = Date.now()
    return { part: runningPart(jobId, state) }
  }
  if (event.event === 'end') {
    const { status, exitCode } = JSON.parse(event.data) as {
      status: ShellJobStatus
      exitCode: number | null
    }
    return {
      part: finalOutput(jobId, status, exitCode, state.output),
      done: true,
    }
  }
  return {}
}

export function isJobNotFound(error: unknown): boolean {
  return extractErrorMessage(error).includes('not found')
}

export async function killQuietly(
  context: ShellJobContext,
  jobId: string,
  post: PostSidecar,
) {
  try {
    await post('/shell/kill', { sessionId: context.sessionId, jobId })
  } catch {
    // The job may already be gone, no-op
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
