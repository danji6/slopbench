import { stripTerminalCodes } from '@sb/core/shell/ansi'
import type { Tool, ToolSet } from 'ai'

import type {
  ShellJobStatus,
  ShellModelToolOutput,
  ShellToolOutput,
} from '../../types'
import { type ShellJobResume } from './shellContracts'
import { type WatchState } from './shellWatch'

// Caps keep parts well under the Convex 1MB document limit
export const TERM_TAIL_CHARS = 48_000

export const TEXT_HEAD_CHARS = 10_000

export const TEXT_TAIL_CHARS = 14_000

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

export function runningPart(jobId: string, state: WatchState): ShellToolOutput {
  return {
    jobId,
    status: 'running',
    exitCode: null,
    text: '',
    term: state.output.term,
    termOffset: state.output.termOffset,
    waiting: state.waiting,
  }
}

export class TermOutputAccumulator {
  term = ''
  private head = ''
  private tail = ''
  private truncated = false
  private headClosed = false
  private total = 0

  /** Seeding continues a previous watcher's scrollback and offsets. */
  constructor(seed?: ShellJobResume) {
    if (!seed) return
    this.total = seed.termOffset
    this.truncated = seed.termOffset > 0
    this.headClosed = this.truncated
    this.append(seed.term)
  }

  get termOffset(): number {
    return this.total - this.term.length
  }

  /** Absolute offset just past the scrollback, where a reader resumes. */
  get termEnd(): number {
    return this.total
  }

  append(chunk: string) {
    this.total += chunk.length
    this.term = (this.term + chunk).slice(-TERM_TAIL_CHARS)

    if (!this.headClosed && this.head.length < TEXT_HEAD_CHARS) {
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
    if (!this.truncated) return head + tail
    return [head, '[... output truncated ...]', tail].filter(Boolean).join('\n')
  }
}

export function finalOutput(
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

export function stillRunningOutput(
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

export function lostOutput(
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
