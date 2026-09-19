import type { ShellToolOutput } from '../../types'
import { postSidecar } from '../sidecar'
import { type ShellJobContext } from './shellContracts'
import { type ShellJobInput } from './shellContracts'
import { type ShellOutputInput } from './shellContracts'
import { type PostSidecar } from './shellContracts'
import { type ShellJobOptions } from './shellContracts'
import { type ShellJobResume } from './shellContracts'
import { watchJob } from './shellWatch'

export type { ShellJobContext } from './shellContracts'
export type { ShellJobInput } from './shellContracts'
export type { ShellOutputInput } from './shellContracts'
export type { PostSidecar } from './shellContracts'
export type { OpenStream } from './shellContracts'
export type { ShellJobOptions } from './shellContracts'
export type { ShellJobResume } from './shellContracts'
export { shellToModelOutput } from './shellOutput'
export { shellHistoryTools } from './shellOutput'

const DEFAULT_OUTPUT_WAIT_S = 30

const MAX_OUTPUT_WAIT_S = 600

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
    owner: context.owner,
    messageId: context.messageId,
    messageCreatedAt: context.messageCreatedAt,
    toolCallId: context.toolCallId,
    workspaceId: context.workspaceId,
    command: input.command,
    timeoutSeconds: input.timeout,
    background: input.run_in_background,
    shell: context.shell,
    allowInteractiveShells: context.allowInteractiveShells ?? false,
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

/**
 * Resumes watching a job that outlived its previous watcher. The scrollback
 * carries over and `term`/`termOffset` stay continuous for the reader.
 */
export async function* resumeShellJob(
  context: ShellJobContext,
  resume: ShellJobResume,
  options: ShellJobOptions = {},
): AsyncGenerator<ShellToolOutput> {
  yield* watchJob(context, resume.jobId, {
    ...options,
    post: options.post ?? postSidecar,
    detachOnBackground: true,
    seed: resume,
  })
}

/** Watches a background job until it exits or the window runs out. */
export async function* watchBackgroundJob(
  context: ShellJobContext,
  resume: ShellJobResume,
  options: ShellJobOptions = {},
): AsyncGenerator<ShellToolOutput> {
  yield* watchJob(context, resume.jobId, {
    ...options,
    post: options.post ?? postSidecar,
    seed: resume,
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
