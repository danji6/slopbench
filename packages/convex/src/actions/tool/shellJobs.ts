'use node'

import type { ShellToolOutput } from '@cv/core/types/tools'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { sanitizeChatError } from '../../errors'
import type { ShellJobContext, ShellJobOptions } from '../../model/tool/shell'

export type WatchShellJobArgs = {
  shellJobId: Id<'shellJobs'>
  generation: number
}

type CompletionRead = {
  ctx: ActionCtx
  args: WatchShellJobArgs
  job: ShellJobContext
  jobId: string
  options: ShellJobOptions
}

/** Fetches only the recipient's unread completion page while the watch is owned. */
async function completionPage({
  ctx,
  args,
  job,
  jobId,
  options,
}: CompletionRead) {
  const readPosition = await ctx.runQuery(
    internal.shellOutputDeliveries._reportPosition,
    args,
  )
  if (!readPosition) return
  const { executeShellOutput } = await import('../../model/tool/shell')

  let output: ShellToolOutput | undefined
  for await (const next of executeShellOutput(
    job,
    { jobId, wait_seconds: 0 },
    {
      ...options,
      windowDeadline: undefined,
      readPosition,
    },
  )) {
    output = next
  }

  return output
}

/**
 * Follows a background job until it exits, then hands its result to the agent.
 * Options are injectable for tests.
 */
export async function _watch(
  ctx: ActionCtx,
  args: WatchShellJobArgs,
  options: ShellJobOptions = {},
) {
  const context = await ctx.runMutation(internal.shellJobs._beginWindow, {
    ...args,
  })
  if (!context) return

  const { resume, ...job } = context

  const { SHELL_WATCH_WINDOW_MS } = await import('../../model/shellJobs')
  const { watchBackgroundJob } = await import('../../model/tool/shell')

  let output: ShellToolOutput | undefined
  let errorText: string | undefined

  try {
    const outputs = watchBackgroundJob(job, resume, {
      windowDeadline: Date.now() + SHELL_WATCH_WINDOW_MS,
      ...options,
    })
    for await (const next of outputs) output = next
    if (output && output.status !== 'running') {
      output = await completionPage({
        ctx,
        args,
        job,
        jobId: resume.jobId,
        options,
      })
      if (!output) return
    }
  } catch (err) {
    errorText = sanitizeChatError(err)
  }

  // Still running means the window ran out, not the job
  if (!errorText && output?.status === 'running') {
    await ctx.runMutation(internal.shellJobs._carry, {
      ...args,
      term: output.term,
      termOffset: output.termOffset,
    })
    return
  }

  await ctx.runMutation(internal.shellJobs._report, {
    ...args,
    ...(errorText ? { errorText } : { output }),
  })
}
