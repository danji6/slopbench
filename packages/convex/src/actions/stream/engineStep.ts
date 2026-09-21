'use node'

import { hasPendingQuestions } from '@sb/core/utils/ask'
import type { UIMessage } from 'ai'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { sanitizeChatError } from '../../errors'
import { hasPendingTaskParts } from '../../lib/subagent'
import {
  assertProviderStepOutput,
  hasReplayableToolOutputSince,
} from '../../model/stream/retry'
import { toolStateSignature } from '../../model/stream/toolOutput'
import { stopWhenInactive } from '../../model/stream/transformers'
import { resolveUsage } from '../../model/stream/usage'
import { hasAwaitingApproval } from './engineApproval'
import { attachApprovalPreviews } from './engineApproval'
import { buildSessionLogBody } from './engineLog'
import { patchSessionLogBody } from './engineLog'
import { offloadLargeParts } from './engineOutput'
import { type prepare } from './engineSetup'
import { STEP_DEADLINE_GRACE_MS } from './engineWatchdog'
import { STEP_DEADLINE_REASON } from './engineWatchdog'
import { watchForStop } from './engineWatchdog'
import {
  collectRespondedApprovalNotes,
  insertApprovalNoteMessages,
} from './history'

export const PATCH_INTERVAL_MS = 100

export class ProviderStreamFailure {
  constructor(
    readonly error: unknown,
    readonly hasOutput: boolean,
    readonly hasReplayableToolOutput: boolean,
    readonly aborted: boolean,
    readonly deadlineHit: boolean,
  ) {}
}

export async function consumeProviderStep(
  ctx: ActionCtx,
  streamId: Id<'streams'>,
  setup: NonNullable<Awaited<ReturnType<typeof prepare>>>,
  windowDeadline: number,
) {
  const [
    {
      InvalidToolInputError,
      readUIMessageStream,
      stepCountIs,
      streamText,
      toUIMessageStream,
    },
    {
      deduplicateToolCallIds,
      omitLargeStrings,
      formatStreamWarnings,
      normalizeUnsupportedWarnings,
      stripProviderMetadata,
      trackGeneratedOutput,
      trackToolErrors,
    },
    { repairToolCall },
    { applyReasoningDurations, createReasoningTracker, trackReasoningTimings },
  ] = await Promise.all([
    import('ai'),
    import('../../model/stream/transformers'),
    import('../../model/tool/repair'),
    import('../../model/stream/reasoning'),
  ])

  const outputTracker = { hasOutput: false }
  const toolErrorTracker = { toolErrors: new Set<string>() }
  const reasoningTracker = createReasoningTracker()
  const offloadCache = new Map<string, unknown>()
  const fileCache = new Map<string, unknown>()
  const abortController = new AbortController()

  const stopWatcher = watchForStop(ctx, streamId, abortController, {
    deadlineAt: windowDeadline + STEP_DEADLINE_GRACE_MS,
  })

  const initialMessage = {
    id: setup.output._id,
    role: setup.output.role,
    parts: setup.output.parts as UIMessage['parts'],
  } satisfies UIMessage

  const initialPartCount = initialMessage.parts.length
  const respondedApprovalNotes = collectRespondedApprovalNotes(
    initialMessage.parts,
  )

  /** Everything a parts array needs before it can be persisted. */
  const prepareParts = async (parts: UIMessage['parts']) =>
    applyReasoningDurations(
      await offloadLargeParts(ctx, parts, {
        toolCache: offloadCache,
        fileCache,
        streamId,
        messageId: setup.output._id,
        sessionId: setup.stream.sessionId,
        uploaderId: setup.stream.invokedBy,
      }),
      reasoningTracker,
      initialPartCount,
    )

  let streamError: unknown
  let lastPatch = 0
  let latestParts = initialMessage.parts
  let lastToolStates = toolStateSignature(latestParts)
  try {
    const startedAt = Date.now()
    const result = streamText({
      model: setup.resolved.languageModel,
      system: setup.systemPrompt,
      allowSystemInMessages: true,
      messages: setup.messages,
      tools: Object.keys(setup.tools).length ? setup.tools : undefined,
      stopWhen: stepCountIs(1),
      // Approved tools execute before the first provider call. Add their notes
      // once the SDK tool results exist, without disrupting the resume.
      prepareStep: ({ messages }) => ({
        messages: insertApprovalNoteMessages(messages, respondedApprovalNotes),
      }),
      maxRetries: 0,
      maxOutputTokens:
        (setup.agent.outputTokens ?? 0) > 0
          ? setup.agent.outputTokens
          : undefined,
      providerOptions: setup.resolved.providerOptions,
      reasoning: setup.resolved.reasoning,
      temperature: setup.resolved.temperature,
      topP: setup.resolved.topP,
      frequencyPenalty: setup.resolved.frequencyPenalty,
      presencePenalty: setup.resolved.presencePenalty,
      abortSignal: abortController.signal,
      onError: ({ error }) => {
        streamError ??= error
      },
      experimental_repairToolCall: async ({ toolCall, error }) =>
        InvalidToolInputError.isInstance(error)
          ? repairToolCall(toolCall)
          : null,
      experimental_transform: [
        normalizeUnsupportedWarnings,
        stripProviderMetadata,
        deduplicateToolCallIds,
        trackGeneratedOutput(outputTracker),
        trackToolErrors(toolErrorTracker),
        trackReasoningTimings(reasoningTracker),
        stopWhenInactive(abortController),
      ],
    })

    for await (const message of readUIMessageStream({
      message: initialMessage,
      stream: toUIMessageStream({
        stream: result.stream,
        tools: setup.tools,
        // Recoverable errors
        onError: (error) => sanitizeChatError(error),
      }),
      terminateOnError: true,
      onError: (error) => {
        streamError ??= error
      },
    })) {
      latestParts = message.parts
      // Publish approval requests only after path details and previews are attached
      if (hasAwaitingApproval(latestParts)) continue
      // Tool state transitions bypass the throttle to avoid staleness
      const toolStates = toolStateSignature(latestParts)
      const throttled = Date.now() - lastPatch < PATCH_INTERVAL_MS
      if (throttled && toolStates === lastToolStates) continue
      lastPatch = Date.now()
      lastToolStates = toolStates
      latestParts = await prepareParts(latestParts)
      if (!(await patchMessage(ctx, streamId, latestParts))) {
        return {
          shouldContinue: null,
          hasOutput: {
            value: outputTracker.hasOutput,
            duration: Date.now() - startedAt,
            toolErrors: [...toolErrorTracker.toolErrors],
            warnings: [],
          },
        }
      }
    }

    const duration = Date.now() - startedAt

    if (streamError !== undefined) throw streamError

    latestParts = await prepareParts(latestParts)
    const awaitingApproval = hasAwaitingApproval(latestParts)
    const awaitingQuestions = hasPendingQuestions(latestParts)
    const awaitingTasks = hasPendingTaskParts(latestParts)
    if (awaitingApproval) {
      latestParts = await attachApprovalPreviews(ctx, setup, latestParts)
    }
    await patchMessage(ctx, streamId, latestParts)

    const outputText = latestParts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')

    const usage = await resolveUsage({
      usage: await result.usage,
      outputText,
    })

    const steps = await result.steps
    const finishReason = steps.at(-1)?.finishReason

    const lastResponseBody = JSON.stringify(
      omitLargeStrings({ parts: latestParts, usage, finishReason }),
      null,
      2,
    )

    await patchSessionLogBody(ctx, {
      body: buildSessionLogBody({
        requestBody: setup.requestLog.body,
        responseBody: lastResponseBody,
      }),
      sessionId: setup.stream.sessionId,
    })

    assertProviderStepOutput(outputTracker.hasOutput, finishReason)

    return {
      shouldContinue: finishReason === 'tool-calls',
      awaitingApproval,
      awaitingQuestions,
      awaitingTasks,
      hasOutput: {
        value: outputTracker.hasOutput,
        duration,
        toolErrors: [...toolErrorTracker.toolErrors],
        warnings: formatStreamWarnings((await result.warnings) ?? []),
      },
      usage,
    }
  } catch (error) {
    latestParts = await prepareParts(latestParts).catch(() => latestParts)

    await tryPatchMessage(ctx, streamId, latestParts)

    throw new ProviderStreamFailure(
      streamError ?? error,
      outputTracker.hasOutput,
      hasReplayableToolOutputSince(latestParts, initialPartCount),
      abortController.signal.aborted,
      abortController.signal.reason === STEP_DEADLINE_REASON,
    )
  } finally {
    stopWatcher.dispose()
  }
}

export async function patchMessage(
  ctx: ActionCtx,
  streamId: Id<'streams'>,
  parts: UIMessage['parts'],
) {
  return ctx.runMutation(internal.streams._patchMessage, { streamId, parts })
}

export async function tryPatchMessage(
  ctx: ActionCtx,
  streamId: Id<'streams'>,
  parts: UIMessage['parts'],
) {
  try {
    await patchMessage(ctx, streamId, parts)
  } catch {
    // no-op
  }
}
