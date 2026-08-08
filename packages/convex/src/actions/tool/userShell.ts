'use node'

import type { ShellToolOutput } from '@sb/core/types/tools'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { sanitizeChatError } from '../../errors'
import type { ShellJobContext, ShellJobOptions } from '../../model/tool/shell'

/** Matches the stream engine's patch throttle. */
const PATCH_INTERVAL_MS = 100

export type RunUserShellArgs = {
  messageId: Id<'messages'>
  invokedBy: Id<'users'>
  silent: boolean
}

/**
 * Runs a command the user invoked, streaming its output into the shell tool
 * part on their message. Options are injectable for tests.
 */
export async function _run(
  ctx: ActionCtx,
  args: RunUserShellArgs,
  options: ShellJobOptions = {},
) {
  const { messageId, invokedBy, silent } = args
  const context = await ctx.runMutation(internal.chat._beginUserShellWindow, {
    messageId,
  })
  if (!context) return

  const { toolCallId, command, startedAt, resume, ...rest } = context
  const job = { ...rest, toolCallId, messageCreatedAt: startedAt }

  const { USER_SHELL_WINDOW_MS, USER_SHELL_TIMEOUT_S } =
    await import('../../model/chat/shell')
  const { executeShellJob, resumeShellJob } =
    await import('../../model/tool/shell')

  const watch: ShellJobOptions = {
    windowDeadline: Date.now() + USER_SHELL_WINDOW_MS,
    ...options,
  }
  let output: ShellToolOutput | undefined
  let errorText: string | undefined

  try {
    const outputs = resume
      ? resumeShellJob(job, resume, watch)
      : executeShellJob(job, { command, timeout: USER_SHELL_TIMEOUT_S }, watch)

    let lastPatch = 0
    let lastWaiting = false
    for await (const next of outputs) {
      output = next
      // Terminal states are written by the finish mutation instead
      if (next.status !== 'running') continue

      const waiting = next.waiting ?? false
      const throttled = Date.now() - lastPatch < PATCH_INTERVAL_MS
      if (throttled && waiting === lastWaiting) continue
      lastPatch = Date.now()
      lastWaiting = waiting

      if (!(await patch(ctx, messageId, toolCallId, next))) {
        // The message was deleted while the command ran
        await killQuietly(ctx, job, next.jobId, options)
        return
      }
    }
  } catch (err) {
    errorText = sanitizeChatError(err)
  }

  // Still running means the time window ran out, not the command
  if (!errorText && output?.status === 'running') {
    if (!(await patch(ctx, messageId, toolCallId, output))) {
      await killQuietly(ctx, job, output.jobId, options)
      return
    }
    await ctx.scheduler.runAfter(0, internal.actions.userShell._run, args)
    return
  }

  await ctx.runMutation(internal.chat._finishUserShell, {
    messageId,
    toolCallId,
    invokedBy,
    silent,
    duration: Date.now() - startedAt,
    ...settledOutput(output, errorText),
  })
}

/** Writes the running output. False once the message is gone. */
function patch(
  ctx: ActionCtx,
  messageId: Id<'messages'>,
  toolCallId: string,
  output: ShellToolOutput,
) {
  return ctx.runMutation(internal.chat._patchUserShell, {
    messageId,
    toolCallId,
    output,
  })
}

async function killQuietly(
  ctx: ActionCtx,
  job: ShellJobContext,
  jobId: string,
  options: ShellJobOptions,
) {
  const { killShell } = await import('../../model/tool/shell')
  await killShell(job, jobId, options.post).catch(() => {})
}

function settledOutput(
  output: ShellToolOutput | undefined,
  errorText: string | undefined,
) {
  if (errorText) return { errorText }
  if (!output) return { errorText: 'The command produced no result.' }
  return { output }
}
