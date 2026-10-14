'use node'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { sanitizeChatError } from '../../errors'
import {
  getAutoCompactRetryDelay,
  getProviderRetryDelay,
  isProviderRequestSizeError,
} from '../../model/stream/retry'
import type { StreamExecutionArgs } from '../../types'
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

export async function _stream(ctx: ActionCtx, execution: StreamExecutionArgs) {
  const claimed = await ctx.runMutation(internal.streams._claim, { ...execution }) // prettier-ignore
  if (!claimed) return

  let attempt = claimed.attempt
  let hasGeneratedOutput = false
  let lastSetup: Awaited<ReturnType<typeof prepare>> = null
  const windowDeadline = Date.now() + STREAM_WINDOW_MS

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (await honorSoftStop(ctx, execution)) return

      // Hand off between steps to stay below the deadline
      if (Date.now() >= windowDeadline) {
        await ctx.runMutation(internal.streams._handoff, { ...execution })
        return
      }

      const setup = await prepare(ctx, execution)
      if (!setup) return
      lastSetup = setup

      const {
        shouldContinue,
        hasOutput,
        usage,
        awaitingApproval,
        awaitingQuestions,
        awaitingTasks,
      } = await consumeProviderStep(ctx, execution, setup, windowDeadline)
      if (shouldContinue === null) return

      hasGeneratedOutput = hasGeneratedOutput || hasOutput.value

      if (setup.evalResult.dirty) {
        await ctx.runMutation(internal.streams._saveEnvironment, {
          ...execution,
          environment: setup.evalResult.environment,
        })
      }

      await ctx.runMutation(internal.streams._saveMeta, {
        ...execution,
        duration: hasOutput.duration,
        toolErrors: hasOutput.toolErrors,
        warnings: hasOutput.warnings,
        usage,
      })

      // A final provider step is still a normal completion. Otherwise stop at
      // this safe seam before suspending, retrying, or starting another step.
      if (shouldContinue && (await honorSoftStop(ctx, execution))) return

      if (awaitingApproval || awaitingQuestions || awaitingTasks) {
        const suspended = await ctx.runMutation(internal.streams._suspendStep, {
          ...execution,
        })
        if (suspended === 'abort') return
        if (suspended === 'suspended') {
          return
        }
      }

      if (!shouldContinue) {
        await recordStep(ctx, execution, false)
        await ctx.runMutation(internal.streams._complete, { ...execution })
        return
      }

      // Tool/task output is settled and the model will continue. This is the
      // safe seam for mode notes and interval reminders to interrupt the turn.
      await recordStep(ctx, execution, true)

      const continued = await ctx.runMutation(internal.streams._continue, {
        ...execution,
      })
      if (!continued) return

      attempt = 0
    }

    // Hand off once the max step count is reached
    await ctx.runMutation(internal.streams._handoff, { ...execution })
  } catch (err) {
    const failure = err instanceof ProviderStreamFailure ? err : undefined
    const error = failure ? failure.error : err

    hasGeneratedOutput = hasGeneratedOutput || (failure?.hasOutput ?? false)

    // Once the timeout has elapsed, provider errors do not start another
    // attempt or handoff; preserve the completed part of the step and stop.
    if (await honorSoftStop(ctx, execution)) return

    if (failure?.deadlineHit) {
      // Our own time window elapsed, hand off the turn
      await ctx.runMutation(internal.streams._handoff, { ...execution })
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

    const retriedWithoutMedia = await retryWithoutMedia(
      ctx,
      execution,
      lastSetup,
      failedStepHasOutput,
      error,
    )
    if (retriedWithoutMedia) return

    const retryDelay = claimed.autoCompact
      ? getAutoCompactRetryDelay(retryOptions)
      : getProviderRetryDelay(retryOptions)

    if (retryDelay !== null) {
      await ctx.runMutation(internal.streams._scheduleRetry, {
        ...execution,
        retryAt: Date.now() + retryDelay,
        retryError: sanitizeChatError(error),
      })

      return
    }
    await ctx.runMutation(internal.streams._fail, {
      ...execution,
      message: sanitizeChatError(error),
    })
  }
}

async function honorSoftStop(ctx: ActionCtx, execution: StreamExecutionArgs) {
  const state = await ctx.runQuery(internal.streams._getStopState, {
    ...execution,
  })
  if (state === 'active') return false
  if (state === 'requested')
    await ctx.runMutation(internal.streams._honorSoftStop, { ...execution })
  return true
}

function recordStep(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  interruptible: boolean,
) {
  return ctx.runMutation(internal.streams._recordStep, {
    ...execution,
    interruptible,
  })
}

/** Retries a rejected payload once with its active media omitted. */
async function retryWithoutMedia(
  ctx: ActionCtx,
  execution: StreamExecutionArgs,
  setup: Awaited<ReturnType<typeof prepare>>,
  stepHasOutput: boolean,
  error: unknown,
) {
  if (stepHasOutput || !setup) return false
  if (setup.stream.omitActiveMedia) return false
  if (!isProviderRequestSizeError(error)) return false

  const hasActiveMedia =
    setup.hasActiveMedia ||
    (await ctx.runQuery(internal.streams._hasActiveMedia, execution))
  if (!hasActiveMedia) return false

  await ctx.runMutation(internal.streams._omitActiveMedia, execution)
  await ctx.runMutation(internal.streams._scheduleRetry, {
    ...execution,
    retryAt: Date.now(),
    retryError: 'Provider rejected the active media payload as too large',
  })

  return true
}
