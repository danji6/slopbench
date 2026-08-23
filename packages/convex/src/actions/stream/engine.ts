'use node'

import type { UIMessage } from 'ai'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { sanitizeChatError } from '../../errors'
import { hasPendingTaskParts } from '../../lib/subagent'
import { applyPromptCaching } from '../../model/provider/cache'
import { getProviderOptions } from '../../model/provider/options'
import { findCredentialsForModel } from '../../model/provider/providers'
import { postSidecar, sidecarDefaultShell } from '../../model/sidecar'
import {
  generatedFileCacheKey,
  generatedFilename,
  isGeneratedFilePart,
  parseDataUrl,
} from '../../model/stream/generatedFiles'
import {
  assertProviderStepOutput,
  getProviderRetryDelay,
  hasReplayableToolOutputSince,
} from '../../model/stream/retry'
import {
  OFFLOAD_THRESHOLD,
  isOffloadableToolPart,
  makeOutputPreview,
  serializeToolOutput,
  toolStateSignature,
} from '../../model/stream/toolOutput'
import { stopWhenInactive } from '../../model/stream/transformers'
import { resolveUsage } from '../../model/stream/usage'
import { getFlaggedPaths } from '../../model/tool/shellTools'
import type { ReasoningEffort } from '../../types'
import { buildEvalContext } from './evalContext'
import { createOperationPlan } from './operations'
import type { PromptEvalResult } from './operations'

const PATCH_INTERVAL_MS = 100

// Max steps before the turn is handed off to a new action
const MAX_STEPS = 50

const STEP_DEADLINE_GRACE_MS = 45_000
const HEARTBEAT_INTERVAL_MS = 60_000

// One engine invocation must stay well below the platform's Node action timeout
// (NODE_ACTION_USER_TIMEOUT_SECS, default 600s). An externally killed action
// cannot checkpoint anything and the turn hangs until the lease expires. The
// deadline is enforced between steps and, within the grace period, against the
// in-flight step itself (see watchForStop).
const STREAM_WINDOW_MS = 5 * 60 * 1000
const STEP_DEADLINE_REASON = 'stream-window-elapsed'

class ProviderStreamFailure {
  constructor(
    readonly error: unknown,
    readonly hasOutput: boolean,
    readonly hasReplayableToolOutput: boolean,
    readonly aborted: boolean,
    readonly deadlineHit: boolean,
  ) {}
}

export async function _stream(
  ctx: ActionCtx,
  { streamId }: { streamId: Id<'streams'> },
) {
  const claimed = await ctx.runMutation(internal.streams._claim, { streamId })
  if (!claimed) return

  let attempt = claimed.attempt
  let hasGeneratedOutput = false
  const windowDeadline = Date.now() + STREAM_WINDOW_MS

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // Hand off between steps to stay below the deadline
      if (Date.now() >= windowDeadline) {
        await ctx.runMutation(internal.streams._handoff, { streamId })
        return
      }

      const setup = await prepare(ctx, streamId)
      if (!setup) return

      const {
        shouldContinue,
        hasOutput,
        usage,
        awaitingApproval,
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

      if (awaitingApproval || awaitingTasks) {
        const suspended = await ctx.runMutation(internal.streams._suspendStep, {
          streamId,
        })
        if (suspended !== 'continue') return
      } else if (!shouldContinue) {
        await ctx.runMutation(internal.streams._complete, { streamId })
        return
      }

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

    if (failure?.deadlineHit) {
      // Our own time window elapsed, hand off the turn
      await ctx.runMutation(internal.streams._handoff, { streamId })
      return
    }

    const failedStepHasOutput = failure
      ? failure.hasOutput && !failure.hasReplayableToolOutput
      : hasGeneratedOutput

    const retryDelay = getProviderRetryDelay({
      error,
      retryAttempt: attempt + 1,
      hasOutput: failedStepHasOutput,
      aborted: failure?.aborted ?? false,
    })

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

async function prepare(ctx: ActionCtx, streamId: Id<'streams'>) {
  const data = await ctx.runQuery(internal.streams._getContext, { streamId })
  if (!data?.stream || data.stream.status === 'stopping') return null

  // Only needed while resolving a manifest
  const defaultShell = data.sessionCache?.tools
    ? undefined
    : await sidecarDefaultShell()

  const operationPlan = createOperationPlan(data, defaultShell)

  // Frozen prompts skip evaluation (see snapshots.ts)
  let evalResult: PromptEvalResult = {
    items: [],
    environment: data.environment,
    dirty: false,
  }

  if (operationPlan.evalItems.length > 0) {
    const evalContext = buildEvalContext({
      agent: data.agent,
      invoker: data.invoker,
      invokerSettings: data.invokerSettings,
      owner: data.owner,
      ownerSettings: data.ownerSettings,
      session: data.session,
      userCount: data.userCount,
      agentCount: data.agentCount,
      toolNames: operationPlan.toolNames,
    })

    evalResult = await postSidecar<PromptEvalResult>('/eval/prompts', {
      items: operationPlan.evalItems,
      context: evalContext,
      environment: evalResult.environment,
    })
  }

  // The tool manifest needs freezing on the first invoke
  const patch = operationPlan.snapshotPatch(evalResult)
  if (patch) {
    await ctx.runMutation(internal.streams._saveSessionCache, {
      sessionId: data.stream.sessionId,
      agentId: data.stream.agentId,
      ...patch,
    })
  }

  const { systemPrompt, messages, tools } = await operationPlan.buildRequest(
    ctx,
    data,
    evalResult,
  )

  const credentials = findCredentialsForModel(
    data.modelProviders,
    data.agent.modelId,
  )

  // Apply logging after replay filtering for more accuracy
  const requestLog: { body?: string } = {}
  const resolved = await getProviderOptions(
    data.agent.modelId,
    data.agent.reasoningEffort as ReasoningEffort | undefined,
    data.agent,
    credentials,
    async (body) => {
      requestLog.body = body
      await patchSessionLogBody(ctx, {
        body: buildSessionLogBody({ requestBody: body }),
        sessionId: data.stream.sessionId,
      })
    },
  )

  const request = applyPromptCaching(
    { systemPrompt, messages },
    credentials?.providerId,
  )

  return {
    stream: data.stream,
    agent: data.agent,
    output: data.output,
    workspace: data.session.workspace,
    isSubagent: !!data.session.parent,
    evalResult,
    systemPrompt: request.systemPrompt,
    messages: request.messages,
    resolved,
    requestLog,
    tools,
  }
}

async function consumeProviderStep(
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
      // Defer surfacing the approval-requested state to the client until the
      // sidecar preview diff is available
      if (hasAwaitingApproval(latestParts) && !setup.isSubagent) continue
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
    const awaitingTasks = hasPendingTaskParts(latestParts)
    // Sub-agent approvals are auto-denied
    if (awaitingApproval && !setup.isSubagent) {
      latestParts = await attachApprovalPreviews(setup, latestParts)
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

type OffloadOptions = {
  toolCache: Map<string, unknown>
  fileCache: Map<string, unknown>
  streamId: Id<'streams'>
  messageId: Id<'messages'>
  sessionId: Id<'sessions'>
  uploaderId: Id<'users'>
}

/** Move heavy inline payloads (tool outputs, generated files) into storage. */
async function offloadLargeParts(
  ctx: ActionCtx,
  parts: UIMessage['parts'],
  opts: OffloadOptions,
): Promise<UIMessage['parts']> {
  const afterTools = await offloadToolOutputs(
    ctx,
    parts,
    opts.toolCache,
    opts.streamId,
    opts.messageId,
  )
  return offloadGeneratedFiles(ctx, afterTools, opts.fileCache, opts)
}

/**
 * Strip AI-generated images out of the message and store them as attachments,
 * leaving an `attachment:<id>` reference.
 */
async function offloadGeneratedFiles(
  ctx: ActionCtx,
  parts: UIMessage['parts'],
  cache: Map<string, unknown>,
  opts: Pick<
    OffloadOptions,
    'streamId' | 'messageId' | 'sessionId' | 'uploaderId'
  >,
): Promise<UIMessage['parts']> {
  const result = await Promise.all(
    parts.map(async (part) => {
      if (!isGeneratedFilePart(part)) return part

      const key = generatedFileCacheKey(part.url)
      const cached = cache.get(key)
      if (cached) return cached

      const parsed = parseDataUrl(part.url)
      if (!parsed) return part

      const mediaType = part.mediaType ?? parsed.mediaType
      const filename = part.filename ?? generatedFilename(mediaType, cache.size)

      const storageId = await ctx.storage.store(
        new Blob([parsed.bytes], { type: mediaType }),
      )

      const attachmentId = await ctx.runMutation(
        internal.attachments._createGenerated,
        {
          streamId: opts.streamId,
          messageId: opts.messageId,
          sessionId: opts.sessionId,
          uploaderId: opts.uploaderId,
          storageId,
          mediaType,
          filename,
        },
      )

      const compact = {
        type: 'file' as const,
        url: `attachment:${attachmentId}`,
        attachmentId,
        mediaType,
        filename,
      }
      cache.set(key, compact)
      return compact
    }),
  )
  return result as UIMessage['parts']
}

/** Offload large tool outputs to the storage. */
async function offloadToolOutputs(
  ctx: ActionCtx,
  parts: UIMessage['parts'],
  cache: Map<string, unknown>,
  streamId: Id<'streams'>,
  messageId: Id<'messages'>,
): Promise<UIMessage['parts']> {
  const result = await Promise.all(
    parts.map(async (part) => {
      if (!isOffloadableToolPart(part)) return part

      const { toolCallId, output } = part as {
        toolCallId: string
        output: unknown
      }

      const cached = cache.get(toolCallId)
      if (cached) return cached

      const serialized = serializeToolOutput(output)
      if (serialized.length <= OFFLOAD_THRESHOLD) return part

      const outputRef = await ctx.storage.store(
        new Blob([serialized], { type: 'application/json' }),
      )

      await ctx.runMutation(internal.streams._trackOffloadedOutput, {
        streamId,
        messageId,
        storageId: outputRef,
      })

      const compact = { ...part, output: makeOutputPreview(output), outputRef }
      cache.set(toolCallId, compact)
      return compact
    }),
  )
  return result as UIMessage['parts']
}

async function storeSessionLogBody(ctx: ActionCtx, body: string) {
  return ctx.storage.store(new Blob([body], { type: 'application/json' }))
}

function buildSessionLogBody({
  requestBody,
  responseBody,
}: {
  requestBody?: string
  responseBody?: string
}) {
  return JSON.stringify({ requestBody, responseBody }, null, 2)
}

async function patchSessionLogBody(
  ctx: ActionCtx,
  {
    body,
    sessionId,
  }: {
    body: string
    sessionId: Id<'sessions'>
  },
) {
  const storageId = await storeSessionLogBody(ctx, body)
  try {
    await ctx.runMutation(internal.sessions._patchSessionLog, {
      sessionId,
      storageId,
    })
  } catch (err) {
    await ctx.storage.delete(storageId).catch(() => {})
    throw err
  }
}

function hasAwaitingApproval(parts: UIMessage['parts']) {
  return parts.some((part) => {
    if (!part.type.startsWith('tool-')) return false
    const toolPart = part as { state?: string }
    return toolPart.state === 'approval-requested'
  })
}

const FILE_MUTATION_TOOL_TYPES = new Set(['tool-write_file', 'tool-edit_file'])

type ApprovalContext = { sessionId: Id<'sessions'>; workspaceId: string }

/**
 * Attach what an approval request needs beyond its input: a simulated diff for
 * file mutations, and the sensitive paths a shell command references.
 */
async function attachApprovalPreviews(
  setup: NonNullable<Awaited<ReturnType<typeof prepare>>>,
  parts: UIMessage['parts'],
): Promise<UIMessage['parts']> {
  const workspaceId = setup.workspace?.workspaceId
  if (!workspaceId) return parts

  const context = { sessionId: setup.stream.sessionId, workspaceId }
  const result = await Promise.all(
    parts.map((part) => {
      if ((part as { state?: string }).state !== 'approval-requested') {
        return part
      }
      if (FILE_MUTATION_TOOL_TYPES.has(part.type)) {
        return withPreviewDiff(context, part)
      }
      if (part.type === 'tool-shell') {
        return withApprovalPaths(context, part)
      }
      return part
    }),
  )

  return result as UIMessage['parts']
}

async function withPreviewDiff(
  context: ApprovalContext,
  part: UIMessage['parts'][number],
) {
  const input = (
    part as { input?: { path?: string; content?: string; edits?: unknown } }
  ).input
  if (!input?.path) return part

  try {
    const { diff, path } = await postSidecar<{ diff: string; path?: string }>(
      '/workspace/preview-diff',
      {
        ...context,
        filePath: input.path,
        content: input.content,
        edits: input.edits,
      },
    )
    if (!diff) return part
    return { ...part, previewDiff: diff, previewPath: path }
  } catch {
    return part
  }
}

async function withApprovalPaths(
  context: ApprovalContext,
  part: UIMessage['parts'][number],
) {
  const command = (part as { input?: { command?: string } }).input?.command
  if (typeof command !== 'string') return part

  const flagged = await getFlaggedPaths(command, context)
  if (!flagged?.length) return part
  return { ...part, approvalPaths: flagged }
}

async function patchMessage(
  ctx: ActionCtx,
  streamId: Id<'streams'>,
  parts: UIMessage['parts'],
) {
  return ctx.runMutation(internal.streams._patchMessage, { streamId, parts })
}

async function tryPatchMessage(
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

const STOP_POLL_INTERVAL_MS = 250

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Polls stream status while a provider step is in flight and aborts
 * `abortController` as soon as the stream is stopped. May break
 * usage stats.
 */
function watchForStop(
  ctx: ActionCtx,
  streamId: Id<'streams'>,
  abortController: AbortController,
  options?: { deadlineAt?: number },
) {
  let disposed = false
  void (async () => {
    let lastHeartbeat = 0
    while (!disposed && !abortController.signal.aborted) {
      try {
        const active = await ctx.runQuery(internal.streams._isActive, {
          streamId,
        })
        if (!active) {
          abortController.abort()
          return
        }
        if (
          options?.deadlineAt !== undefined &&
          Date.now() >= options.deadlineAt
        ) {
          abortController.abort(STEP_DEADLINE_REASON)
          return
        }
        if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          lastHeartbeat = Date.now()
          await ctx.runMutation(internal.streams._heartbeat, { streamId })
        }
      } catch {
        // Keep polling
      }
      await sleep(STOP_POLL_INTERVAL_MS)
    }
  })()

  return {
    dispose: () => {
      disposed = true
    },
  }
}
