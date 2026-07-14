import type { Tool, ToolSet } from 'ai'

import type {
  ShellJobStatus,
  ShellModelToolOutput,
  ShellToolOutput,
} from '../../types'
import { type ShellStreamEvent, openShellStream, postSidecar } from '../sidecar'

const POLL_INTERVAL_MS = 400
const HEARTBEAT_MS = 5000
const MAX_POLL_FAILURES = 3
const DEFAULT_OUTPUT_WAIT_S = 30
const MAX_OUTPUT_WAIT_S = 600

// Caps keep parts well under the Convex 1MB document limit
const TERM_TAIL_CHARS = 48_000
const TEXT_HEAD_CHARS = 10_000
const TEXT_TAIL_CHARS = 14_000

export type ShellJobContext = {
  sessionId: string
  workspaceId: string
}

export type ShellJobInput = {
  command: string
  timeout?: number
  run_in_background?: boolean
}

export type ShellOutputInput = {
  jobId: string
  wait_seconds?: number
}

export type PostSidecar = <T>(path: string, body: unknown) => Promise<T>

export type OpenStream = (
  path: string,
  query: Record<string, string>,
  signal?: AbortSignal,
) => AsyncGenerator<ShellStreamEvent>

export type ShellJobOptions = {
  abortSignal?: AbortSignal
  /** Injectable for tests. */
  post?: PostSidecar
  openStream?: OpenStream
  pollIntervalMs?: number
}

type StartResponse = { jobId: string; mode: string }

/**
 * Runs a command as a sidecar job. Yields preliminary output in `term`
 * and the final output in `text`.
 */
export async function* executeShellJob(
  context: ShellJobContext,
  input: ShellJobInput,
  options: ShellJobOptions = {},
): AsyncGenerator<ShellToolOutput> {
  const post = options.post ?? postSidecar
  const { jobId } = await post<StartResponse>('/shell/start', {
    sessionId: context.sessionId,
    workspaceId: context.workspaceId,
    command: input.command,
    timeoutSeconds: input.timeout,
    background: input.run_in_background,
  })

  if (input.run_in_background) {
    yield {
      jobId,
      status: 'background',
      exitCode: null,
      text: `Started background job ${jobId}. Use shell_output to read its output and kill_shell to stop it.`,
      term: '',
      termOffset: 0,
    }
    return
  }

  yield* watchJob(context, jobId, {
    ...options,
    post,
    detachOnBackground: true,
  })
}

export async function* executeShellOutput(
  context: ShellJobContext,
  input: ShellOutputInput,
  options: ShellJobOptions = {},
): AsyncGenerator<ShellToolOutput> {
  const waitSeconds = Math.min(
    Math.max(input.wait_seconds ?? DEFAULT_OUTPUT_WAIT_S, 0),
    MAX_OUTPUT_WAIT_S,
  )
  yield* watchJob(context, input.jobId, {
    ...options,
    post: options.post ?? postSidecar,
    waitDeadline: Date.now() + waitSeconds * 1000,
  })
}

export async function killShell(
  context: ShellJobContext,
  jobId: string,
  post: PostSidecar = postSidecar,
): Promise<string> {
  await post('/shell/kill', { sessionId: context.sessionId, jobId })
  return `Killed job ${jobId}`
}

export async function* shellFailure(
  message: string,
): AsyncGenerator<ShellToolOutput> {
  yield {
    jobId: '',
    status: 'killed',
    exitCode: null,
    text: message,
    term: '',
    termOffset: 0,
  }
}

/** Simpler output for the model. */
export function shellToModelOutput({
  output,
}: {
  output: ShellToolOutput
}): ShellModelToolOutput {
  if (typeof output === 'string') {
    return { type: 'text', value: output }
  }

  const value =
    output.status === 'running'
      ? `(command is still running, job ${output.jobId})`
      : output.text

  return { type: 'text', value }
}

/** Minimal tool mappers for convertToModelMessages without terminal scrollback. */
export function shellHistoryTools(): ToolSet {
  const mapper = { toModelOutput: shellToModelOutput } as unknown as Tool
  return { shell: mapper, shell_output: mapper }
}

type WatchOptions = ShellJobOptions & {
  post: PostSidecar
  waitDeadline?: number
  detachOnBackground?: boolean
}

type WatchState = {
  output: TermOutputAccumulator
  offset: number
  lastYield: number
}

/** Result of consuming a single SSE connection. */
type ConnResult = 'ended' | 'reconnect'

async function* watchJob(
  context: ShellJobContext,
  jobId: string,
  options: WatchOptions,
): AsyncGenerator<ShellToolOutput> {
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const state: WatchState = {
    output: new TermOutputAccumulator(),
    offset: 0,
    lastYield: Date.now(),
  }
  let failures = 0

  while (true) {
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
async function* consumeConnection(
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
    let pending = events.next()
    let step = await pending
    while (true) {
      if (step.done) return 'reconnect'

      const outcome = handleStreamEvent(step.value, jobId, state, options)
      if (outcome.part) yield outcome.part
      if (outcome.done) return 'ended'

      pending = events.next()
      const raced = await raceNextEvent(
        pending,
        state.lastYield,
        options.waitDeadline,
      )
      if (raced === 'deadline') {
        yield stillRunningOutput(jobId, state.output)
        return 'ended'
      }
      if (raced === 'heartbeat') {
        state.lastYield = Date.now()
        yield runningPart(jobId, state.output)
        continue
      }
      step = raced.result
    }
  } finally {
    options.abortSignal?.removeEventListener('abort', onUserAbort)
    ac.abort()
    await events.return?.(undefined).catch(() => {})
  }
}

type RaceResult =
  'heartbeat' | 'deadline' | { result: IteratorResult<ShellStreamEvent> }

/**
 * Waits for the next SSE event, racing a heartbeat tick and the optional
 * wait deadline.
 */
async function raceNextEvent(
  pending: Promise<IteratorResult<ShellStreamEvent>>,
  lastYield: number,
  deadline: number | undefined,
): Promise<RaceResult> {
  const timers: ReturnType<typeof setTimeout>[] = []
  const contenders: Promise<RaceResult>[] = [
    pending.then((result) => ({ result }) as RaceResult),
    new Promise<RaceResult>((resolve) => {
      const delay = Math.max(0, HEARTBEAT_MS - (Date.now() - lastYield))
      timers.push(setTimeout(() => resolve('heartbeat'), delay))
    }),
  ]
  if (deadline) {
    contenders.push(
      new Promise<RaceResult>((resolve) => {
        timers.push(
          setTimeout(
            () => resolve('deadline'),
            Math.max(0, deadline - Date.now()),
          ),
        )
      }),
    )
  }
  try {
    return await Promise.race(contenders)
  } finally {
    timers.forEach(clearTimeout)
  }
}

type EventOutcome = { part?: ShellToolOutput; done?: boolean }

function handleStreamEvent(
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
    return { part: runningPart(jobId, state.output) }
  }
  if (event.event === 'meta') {
    const { background } = JSON.parse(event.data) as { background: boolean }
    if (options.detachOnBackground && background) {
      return { part: stillRunningOutput(jobId, state.output), done: true }
    }
    return {}
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

function runningPart(
  jobId: string,
  output: TermOutputAccumulator,
): ShellToolOutput {
  return {
    jobId,
    status: 'running',
    exitCode: null,
    text: '',
    term: output.term,
    termOffset: output.termOffset,
  }
}

class TermOutputAccumulator {
  term = ''
  private head = ''
  private tail = ''
  private truncated = false
  private total = 0

  get termOffset(): number {
    return this.total - this.term.length
  }

  append(chunk: string) {
    this.total += chunk.length
    this.term = (this.term + chunk).slice(-TERM_TAIL_CHARS)

    if (this.head.length < TEXT_HEAD_CHARS) {
      const room = TEXT_HEAD_CHARS - this.head.length
      this.head += chunk.slice(0, room)
      chunk = chunk.slice(room)
    }
    this.tail += chunk
    if (this.tail.length > TEXT_TAIL_CHARS) {
      this.tail = this.tail.slice(-TEXT_TAIL_CHARS)
      this.truncated = true
    }
  }

  toText(): string {
    const head = stripTerminalCodes(this.head)
    const tail = stripTerminalCodes(this.tail)
    return this.truncated
      ? `${head}\n[... output truncated ...]\n${tail}`
      : head + tail
  }
}

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g

/** Strips ANSI escapes and resolves carriage-return overwrites (progress bars). */
export function stripTerminalCodes(text: string): string {
  const plain = text.replace(ANSI_PATTERN, '').replace(/\r+\n/g, '\n')
  if (!plain.includes('\r')) return plain
  return plain.split('\n').map(resolveCarriageReturns).join('\n')
}

function resolveCarriageReturns(line: string): string {
  let result = ''
  for (const segment of line.split('\r')) {
    result = segment + result.slice(segment.length)
  }
  return result
}

function finalOutput(
  jobId: string,
  status: ShellJobStatus,
  exitCode: number | null,
  output: TermOutputAccumulator,
): ShellToolOutput {
  const lines = [output.toText().trimEnd()]

  if (status === 'timeout') lines.push('(command timed out)')
  if (status === 'killed') lines.push('(command was killed)')
  if (exitCode !== null && exitCode !== 0) lines.push(`(exit code ${exitCode})`)

  return {
    jobId,
    status,
    exitCode,
    text: lines.filter(Boolean).join('\n') || '(no output)',
    term: output.term,
    termOffset: output.termOffset,
  }
}

function stillRunningOutput(
  jobId: string,
  output: TermOutputAccumulator,
): ShellToolOutput {
  const text = output.toText().trimEnd()
  return {
    jobId,
    status: 'background',
    exitCode: null,
    text: `${text ? `${text}\n` : ''}(job ${jobId} is still running)`,
    term: output.term,
    termOffset: output.termOffset,
  }
}

function lostOutput(
  jobId: string,
  output: TermOutputAccumulator,
): ShellToolOutput {
  return {
    jobId,
    status: 'lost',
    exitCode: null,
    text: `Job ${jobId} was not found. The local server may have restarted; rerun the command if its result is still needed.`,
    term: output.term,
    termOffset: output.termOffset,
  }
}

function isJobNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('not found')
}

async function killQuietly(
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
