'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { sanitizeChatError } from '../../errors'
import {
  getAutoCompactRetryDelay,
  getProviderRetryDelay,
  isProviderRequestSizeError,
} from '../../model/stream/retry'
import { prepare } from './engineSetup'
import { consumeProviderStep } from './engineStep'
import { ProviderStreamFailure } from './engineStep'

// Max steps before the turn is handed off to a new action
const MAX_STEPS = 50

// One engine invocation must stay well below the platform's Node action timeout
// (NODE_ACTION_USER_TIMEOUT_SECS, default 600s). An externally killed action
// cannot checkpoint anything and the turn hangs until the lease expires. The
// deadline is enforced between steps and, within the grace period, against the
// in-flight step itself (see watchForStop).
const STREAM_WINDOW_MS = 5 * 60 * 1000

export async function _stream(
  ctx: ActionCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const claimed = await ctx.runMutation(internal.streams._claim, { streamId })
  if (!claimed) return

  let attempt = claimed.attempt
  let hasGeneratedOutput = false
  let lastSetup: Awaited<ReturnType<typeof prepare>> = null
  const windowDeadline = Date.now() + STREAM_WINDOW_MS

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (await honorSoftStop(ctx, streamId)) return

      // Hand off between steps to stay below the deadline
      if (Date.now() >= windowDeadline) {
        await ctx.runMutation(internal.streams._handoff, { streamId })
        return
      }

      const setup = await prepare(ctx, streamId)
      if (!setup) return
      lastSetup = setup

      const {
        shouldContinue,
        hasOutput,
        usage,
        awaitingApproval,
        awaitingQuestions,
        awaitingTasks,
      } = await consumeProviderStep(ctx, streamId, setup, windowDeadline)
      if (shouldContinue === null) return

      hasGeneratedOutput = hasGeneratedOutput || hasOutput.value

      if (setup.evalResult.dirty) {
        await ctx.runMutation(internal.sessions._patchEnvironment, {
          sessionId: setup.stream.sessionId,
          environment: setup.evalResult.environment,
        })
      }

      await ctx.runMutation(internal.streams._saveMeta, {
        streamId,
        duration: hasOutput.duration,
        toolErrors: hasOutput.toolErrors,
        warnings: hasOutput.warnings,
        usage,
      })

      // A final provider step is still a normal completion. Otherwise stop at
      // this safe seam before suspending, retrying, or starting another step.
      if (shouldContinue && (await honorSoftStop(ctx, streamId))) return

      if (awaitingApproval || awaitingQuestions || awaitingTasks) {
        const suspended = await ctx.runMutation(internal.streams._suspendStep, {
          streamId,
        })
        if (suspended === 'abort') return
        if (suspended === 'suspended') {
          await recordStep(ctx, streamId, false)
          return
        }
      }

      if (!shouldContinue) {
        await recordStep(ctx, streamId, false)
        await ctx.runMutation(internal.streams._complete, { streamId })
        return
      }

      // Tool/task output is settled and the model will continue. This is the
      // safe seam for mode notes and interval reminders to interrupt the turn.
      await recordStep(ctx, streamId, true)

      const continued = await ctx.runMutation(internal.streams._continue, {
        streamId,
      })
      if (!continued) return

      attempt = 0
    }

    // Hand off once the max step count is reached
    await ctx.runMutation(internal.streams._handoff, { streamId })
  } catch (err) {
    const failure = err instanceof ProviderStreamFailure ? err : undefined
    const error = failure ? failure.error : err

    hasGeneratedOutput = hasGeneratedOutput || (failure?.hasOutput ?? false)

    // Once the timeout has elapsed, provider errors do not start another
    // attempt or handoff; preserve the completed part of the step and stop.
    if (await honorSoftStop(ctx, streamId)) return

    if (failure?.deadlineHit) {
      // Our own time window elapsed, hand off the turn
      await ctx.runMutation(internal.streams._handoff, { streamId })
      return
    }

    const failedStepHasOutput = failure
      ? failure.hasOutput && !failure.hasReplayableToolOutput
      : hasGeneratedOutput

    const retryOptions = {
      error,
      retryAttempt: attempt + 1,
      hasOutput: failedStepHasOutput,
      aborted: failure?.aborted ?? false,
    }

    if (
      !failedStepHasOutput &&
      lastSetup &&
      !lastSetup.stream.omitActiveMedia &&
      isProviderRequestSizeError(error) &&
      (lastSetup.hasActiveMedia ||
        (await ctx.runQuery(internal.streams._hasActiveMedia, { streamId })))
    ) {
      await ctx.runMutation(internal.streams._omitActiveMedia, { streamId })
      await ctx.runMutation(internal.streams._scheduleRetry, {
        streamId,
        retryAt: Date.now(),
        retryError: 'Provider rejected the active media payload as too large',
      })
      return
    }

    const retryDelay = claimed.autoCompact
      ? getAutoCompactRetryDelay(retryOptions)
      : getProviderRetryDelay(retryOptions)

    if (retryDelay !== null) {
      await ctx.runMutation(internal.streams._scheduleRetry, {
        streamId,
        retryAt: Date.now() + retryDelay,
        retryError: sanitizeChatError(error),
      })

      return
    }
    await ctx.runMutation(internal.streams._fail, {
      streamId,
      message: sanitizeChatError(error),
    })
  }
}

function honorSoftStop(ctx: ActionCtx, streamId: Id<'streams'>) {
  return ctx.runMutation(internal.streams._honorSoftStop, { streamId })
}

function recordStep(
  ctx: ActionCtx,
  streamId: Id<'streams'>,
  interruptible: boolean,
) {
  return ctx.runMutation(internal.streams._recordStep, {
    streamId,
    interruptible,
  })
}
