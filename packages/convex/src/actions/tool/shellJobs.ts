'use node'

import type { ShellToolOutput } from '@sb/core/types/tools'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { sanitizeChatError } from '../../errors'
import type { ShellJobOptions } from '../../model/tool/shell'

export type WatchShellJobArgs = { shellJobId: Id<'shellJobs'> }

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
    shellJobId: args.shellJobId,
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
  } catch (err) {
    errorText = sanitizeChatError(err)
  }

  // Still running means the window ran out, not the job
  if (!errorText && output?.status === 'running') {
    await ctx.runMutation(internal.shellJobs._carry, {
      shellJobId: args.shellJobId,
      term: output.term,
      termOffset: output.termOffset,
    })
    return
  }

  await ctx.runMutation(internal.shellJobs._report, {
    shellJobId: args.shellJobId,
    ...(errorText ? { errorText } : { output }),
  })
}
