import type { PollResult } from '@sb/core/shell/job-protocol'
import {
  SHELL_PAGE_CHARS,
  outputPrefixLength,
  plainOutputPage,
} from '@sb/core/shell/output-page'
import type { ShellOutputSpan, ShellToolOutput } from '@sb/core/types/tools'

import { type ShellStreamEvent, openShellStream, postSidecar } from '../sidecar'
import type {
  ShellJobContext,
  ShellJobOptions,
  ShellOutputInput,
} from './shellContracts'
import { raceNextEvent } from './shellDeadlines'
import { TERM_TAIL_CHARS } from './shellOutput'
import {
  HEARTBEAT_MS,
  POLL_INTERVAL_MS,
  earliest,
  isJobNotFound,
  killQuietly,
  sleep,
  watchJob,
} from './shellWatch'

type Segment = { start: number; text: string }

type PageState = {
  requested: number
  offset: number
  segments: Segment[]
  unavailable: ShellOutputSpan[]
  length: number
  full: boolean
  ended: boolean
  covered: ShellOutputSpan[]
}

/** Finds the next unread offset after any previously delivered spans. */
function skipCovered(offset: number, covered: ShellOutputSpan[]) {
  for (const span of covered) {
    if (span.start <= offset && offset < span.end) offset = span.end
  }
  return offset
}

function append(state: PageState, text: string, start: number) {
  if (start > state.offset) {
    state.unavailable.push({ start: state.offset, end: start })
    state.offset = start
  }

  const nextCovered = state.covered.find(
    (span) => span.end > span.start && span.start >= state.offset,
  )
  const stop = nextCovered?.start ?? Infinity
  const room = Math.min(
    SHELL_PAGE_CHARS - state.length,
    Math.max(0, stop - state.offset),
  )
  const chunk = text.slice(0, room)
  const previous = state.segments.at(-1)

  if (previous && previous.start + previous.text.length === state.offset) {
    previous.text += chunk
  } else if (chunk) {
    state.segments.push({ start: state.offset, text: chunk })
  }

  state.offset += chunk.length
  state.length += chunk.length
  state.full =
    state.length >= SHELL_PAGE_CHARS ||
    text.length > chunk.length ||
    state.offset === stop
}

async function snapshot(
  context: ShellJobContext,
  jobId: string,
  offset: number,
  options: ShellJobOptions,
  limit: number,
) {
  const post = options.post ?? postSidecar
  return post<PollResult>('/shell/poll', {
    sessionId: context.sessionId,
    jobId,
    offset,
    limit,
    tailChars: TERM_TAIL_CHARS,
  })
}

function preliminary(jobId: string, state: PageState): ShellToolOutput {
  const segment = state.segments.at(-1)
  const term = segment?.text ?? ''
  return {
    jobId,
    status: 'running',
    exitCode: null,
    text: '',
    term,
    termOffset: segment?.start ?? state.offset,
  }
}

/** Opens a connection whose teardown cancels both the fetch and pending read. */
function pageConnection(
  context: ShellJobContext,
  jobId: string,
  state: PageState,
  options: ShellJobOptions,
) {
  const ac = new AbortController()
  const abort = () => ac.abort()

  options.abortSignal?.addEventListener('abort', abort, { once: true })
  if (options.abortSignal?.aborted) ac.abort()

  const events = (options.openStream ?? openShellStream)(
    '/shell/stream',
    {
      sessionId: context.sessionId,
      jobId,
      offset: String(state.offset),
    },
    ac.signal,
  )

  const close = async () => {
    options.abortSignal?.removeEventListener('abort', abort)
    ac.abort()
    await events.return?.(undefined).catch(() => {})
  }

  return { events, close }
}

function applyEvent(event: ShellStreamEvent, state: PageState) {
  if (event.event === 'chunk') {
    const chunk = JSON.parse(event.data) as { text: string; nextOffset: number }
    append(state, chunk.text, chunk.nextOffset - chunk.text.length)
  } else if (event.event === 'end') {
    state.ended = true
  }
}

function pageCanWait(
  state: PageState,
  options: ShellJobOptions,
  deadline: number,
) {
  return (
    !state.full &&
    !state.ended &&
    !options.abortSignal?.aborted &&
    Date.now() < deadline
  )
}

async function* consumePageConnection(
  events: AsyncGenerator<ShellStreamEvent>,
  input: ShellOutputInput,
  options: ShellJobOptions,
  state: PageState,
  deadline: number,
): AsyncGenerator<ShellToolOutput> {
  let pending = events.next()
  while (!state.full && !state.ended) {
    const raced = await raceNextEvent(
      pending,
      Date.now(),
      deadline,
      options.heartbeatMs ?? HEARTBEAT_MS,
    )
    if (raced === 'deadline') return
    if (raced === 'heartbeat') {
      yield preliminary(input.jobId, state)
      continue
    }
    const step = raced.result
    if (step.done) return
    applyEvent(step.value, state)
    if (step.value.event === 'chunk') yield preliminary(input.jobId, state)
    if (!state.full && !state.ended) pending = events.next()
  }
}

/** Waits over SSE without consuming the next page's suffix. */
async function* waitForPage(
  context: ShellJobContext,
  input: ShellOutputInput,
  options: ShellJobOptions,
  state: PageState,
  deadline: number,
): AsyncGenerator<ShellToolOutput> {
  let failures = 0
  while (pageCanWait(state, options, deadline)) {
    const connection = pageConnection(context, input.jobId, state, options)
    try {
      yield* consumePageConnection(
        connection.events,
        input,
        options,
        state,
        deadline,
      )
      failures = 0
    } catch (error) {
      if (options.abortSignal?.aborted) {
        await killQuietly(context, input.jobId, options.post ?? postSidecar)
        throw error
      }
      if (isJobNotFound(error) || ++failures >= 3) throw error
    } finally {
      await connection.close()
    }
    if (pageCanWait(state, options, deadline)) {
      await sleep(options.pollIntervalMs ?? POLL_INTERVAL_MS)
    }
  }
}

async function abortRead(
  context: ShellJobContext,
  jobId: string,
  options: ShellJobOptions,
): Promise<never> {
  await killQuietly(context, jobId, options.post ?? postSidecar)
  throw new Error('Shell output read was aborted')
}

function pageText(state: PageState, options: ShellJobOptions) {
  let ansiState = options.readPosition?.ansiState ?? 'text'
  let text = ''
  let previousEnd = state.requested

  for (const segment of state.segments) {
    if (segment.start > previousEnd) ansiState = 'text'
    const page = plainOutputPage(segment.text, ansiState)
    text += page.text
    ansiState = page.state
    previousEnd = segment.start + segment.text.length
  }
  if (state.offset > previousEnd) ansiState = 'text'

  return { text, ansiState }
}

function finishPage(
  input: ShellOutputInput,
  options: ShellJobOptions,
  state: PageState,
  current: PollResult,
): ShellToolOutput {
  const { text, ansiState } = pageText(state, options)
  const status = current.status === 'running' ? 'background' : current.status
  return {
    jobId: input.jobId,
    status,
    exitCode: current.exitCode,
    text,
    term: current.term ?? state.segments.at(-1)?.text ?? '',
    termOffset:
      current.termOffset ?? state.segments.at(-1)?.start ?? state.offset,
    waiting: current.waiting,
    range: {
      requestedOffset: state.requested,
      startOffset: state.segments[0]?.start ?? state.offset,
      nextOffset: state.offset,
      bufferEnd: current.bufferEnd!,
      hasMore: skipCovered(state.offset, state.covered) < current.bufferEnd!,
      replay: input.offset !== undefined,
      unavailable: state.unavailable,
      ansiState,
    },
  }
}

type PageRead = {
  context: ShellJobContext
  input: ShellOutputInput
  options: ShellJobOptions
  requested: number
  deadline: number
}

function createPage(read: PageRead, current: PollResult): PageState {
  return {
    requested: read.requested,
    offset: Math.min(read.requested, current.bufferStart),
    segments: [],
    unavailable: [],
    length: 0,
    full: false,
    ended: current.status !== 'running',
    covered:
      read.input.offset === undefined
        ? (read.options.readPosition?.covered ?? [])
        : [],
  }
}

function trimSurrogate(state: PageState, current: PollResult) {
  const last = state.segments.at(-1)
  if (!last) return
  const length = outputPrefixLength(last.text, last.text.length)
  const trim = last.text.length - length
  // A lone high surrogate at process exit has no later half to wait for.
  if (trim && (!state.ended || state.offset < current.bufferEnd!)) {
    last.text = last.text.slice(0, length)
    state.offset -= trim
  }
}

async function* readSupportedPage(read: PageRead, current: PollResult) {
  const { context, input, options, deadline } = read
  const state = createPage(read, current)

  append(state, current.chunk, current.bufferStart)
  yield* waitForPage(context, input, options, state, deadline)
  if (options.abortSignal?.aborted)
    await abortRead(context, input.jobId, options)
  trimSurrogate(state, current)

  const final = await snapshot(context, input.jobId, state.offset, options, 0)
  const windowElapsed =
    options.windowDeadline !== undefined && Date.now() >= options.windowDeadline

  yield windowElapsed
    ? preliminary(input.jobId, state)
    : finishPage(input, options, state, final)
}

/** Reads one bounded page, falling back to legacy streaming on older sidecars. */
export async function* readShellPage(
  context: ShellJobContext,
  input: ShellOutputInput,
  options: ShellJobOptions = {},
): AsyncGenerator<ShellToolOutput> {
  const requested = input.offset ?? options.readPosition?.offset ?? 0
  const wait = Math.min(Math.max(input.wait_seconds ?? 30, 0), 600)
  const deadline = earliest(Date.now() + wait * 1000, options.windowDeadline)!

  const current = await snapshot(
    context,
    input.jobId,
    requested,
    options,
    SHELL_PAGE_CHARS,
  )

  if (current.bufferEnd === undefined) {
    yield* watchJob(context, input.jobId, {
      ...options,
      post: options.post ?? postSidecar,
      waitDeadline: deadline,
    })
    return
  }

  yield* readSupportedPage(
    { context, input, options, requested, deadline },
    current,
  )
}
