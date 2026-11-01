'use node'

import type {
  ProviderContinuity,
  ProviderResponseMetadata,
  ProviderTransportObserver,
} from '@sb/core/provider-continuity'
import type { LanguageModelUsage } from 'ai'
import { createHash } from 'node:crypto'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import type { ProviderCredentials } from '../../model/provider/providers'
import type {
  CacheDiagnostic,
  ProviderContinuityScope,
  StreamExecutionArgs,
  TokenUsage,
} from '../../types'

/** Hashes the complete serialized value before request-log truncation. */
export function requestFingerprint(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'undefined')
    .digest('hex')
}

export function requestFingerprints(
  body: Record<string, unknown>,
  previous?: CacheDiagnostic,
) {
  const { input, instructions, tools, prompt_cache_key, ...configuration } = body // prettier-ignore
  const items = Array.isArray(input) ? input : []
  return {
    requestHash: requestFingerprint(body),
    cacheKeyHash: requestFingerprint(prompt_cache_key),
    instructionsHash: requestFingerprint(instructions),
    toolsHash: requestFingerprint(tools),
    configurationHash: requestFingerprint(configuration),
    inputHash: requestFingerprint(items),
    inputItems: items.length,
    prefixMatch: compareInputPrefix(items, previous),
  }
}

function compareInputPrefix(items: unknown[], previous?: CacheDiagnostic) {
  if (!previous) return undefined
  if (items.length < previous.inputItems) return 'shortened' as const
  const prefixHash = requestFingerprint(items.slice(0, previous.inputItems))
  return prefixHash === previous.inputHash
    ? ('match' as const)
    : ('changed' as const)
}

type DiagnosticsOptions = {
  execution: StreamExecutionArgs
  messageId: Id<'messages'>
  attempt: number
  credentials: ProviderCredentials
}

type PreparedRequest = {
  value?: ProviderContinuity
  resetReason: string
  previous?: CacheDiagnostic
}

type ResponseIdentity = { id?: string; modelId?: string }

/** Observes one SDK step while persistence remains scoped to the logical turn. */
export function createCacheDiagnostics(
  ctx: ActionCtx,
  options: DiagnosticsOptions,
) {
  return new CacheDiagnostics(ctx, options)
}

class CacheDiagnostics {
  private diagnostic?: CacheDiagnostic

  constructor(
    private ctx: ActionCtx,
    private options: DiagnosticsOptions,
  ) {}

  requestId() {
    return this.diagnostic?.id
  }

  private async record(patch: Partial<CacheDiagnostic>) {
    if (!this.diagnostic) return
    this.diagnostic = { ...this.diagnostic, ...patch }
    try {
      await this.ctx.runMutation(internal.streams._recordCacheDiagnostic, {
        ...this.options.execution,
        diagnostic: this.diagnostic,
      })
    } catch {
      // Diagnostic storage must never change inference or provider retry behavior.
    }
  }

  observeTransport: ProviderTransportObserver = async (body) => {
    const scope = requestScope(body, this.options)
    const prepared = await this.ctx.runMutation(
      internal.streams._prepareProviderRequest,
      {
        ...this.options.execution,
        scope,
      },
    )
    this.diagnostic = beginDiagnostic(body, this.options, prepared)
    await this.record({})
    return {
      continuity: prepared.value,
      onResponse: (metadata) =>
        this.onResponse(scope, prepared.value, metadata),
      onError: () =>
        this.record({ outcome: 'transport_error', completedAt: Date.now() }),
    }
  }

  private async onResponse(
    scope: ProviderContinuityScope,
    previous: ProviderContinuity | undefined,
    metadata: ProviderResponseMetadata,
  ) {
    const saved = await this.ctx.runMutation(
      internal.streams._saveProviderContinuity,
      {
        ...this.options.execution,
        scope,
        value: metadata.continuity,
        reset: metadata.continuityReset,
      },
    )
    if (!saved) throw new Error('Stream execution is no longer active')
    await this.record(responseDiagnostic(previous, metadata))
  }

  async complete(
    usage: TokenUsage,
    rawUsage?: LanguageModelUsage,
    response?: ResponseIdentity,
  ) {
    await this.record({
      ...completedDiagnostic(usage, rawUsage),
      responseId: response?.id?.slice(0, 256),
      reportedModel:
        response?.modelId?.slice(0, 256) ?? this.diagnostic?.reportedModel,
    })
  }

  async fail(aborted: boolean) {
    const alreadyFailed =
      this.diagnostic?.outcome === 'http_error' ||
      this.diagnostic?.outcome === 'transport_error'
    if (alreadyFailed) return
    await this.record({
      outcome: aborted ? 'aborted' : 'stream_error',
      completedAt: Date.now(),
    })
  }
}

function requestScope(
  body: Record<string, unknown>,
  options: DiagnosticsOptions,
): ProviderContinuityScope {
  const { credentials, messageId } = options
  return {
    providerId: credentials.providerId ?? '',
    ownerId: credentials.ownerId ?? '',
    connectionId: credentials.connectionId ?? '',
    model: String(body.model ?? ''),
    cacheKeyHash: requestFingerprint(body.prompt_cache_key),
    messageId,
  }
}

function beginDiagnostic(
  body: Record<string, unknown>,
  options: DiagnosticsOptions,
  prepared: PreparedRequest,
): CacheDiagnostic {
  const { execution, messageId, attempt } = options
  const { previous } = prepared
  const startedAt = Date.now()
  const firstInTurn =
    !previous ||
    previous.streamId !== execution.streamId ||
    previous.messageId !== messageId
  return {
    ...requestFingerprints(body, previous),
    id: crypto.randomUUID(),
    ...execution,
    messageId,
    attempt,
    startedAt,
    gapMs: previous
      ? Math.max(0, startedAt - (previous.completedAt ?? previous.startedAt))
      : undefined,
    firstInTurn,
    resetReason: prepared.resetReason,
    previousRequestId: previous?.id,
    continuityAvailable: !!prepared.value,
    requestedModel: String(body.model ?? '').slice(0, 256),
    outcome: 'pending',
  }
}

function responseDiagnostic(
  previous: ProviderContinuity | undefined,
  metadata: ProviderResponseMetadata,
): Partial<CacheDiagnostic> {
  const next = metadata.continuity
  const conflict =
    !!previous &&
    !!next &&
    previous.authRevision === next.authRevision &&
    previous.token !== next.token
  const httpError = metadata.status >= 400
  return {
    headersAt: Date.now(),
    status: metadata.status,
    continuitySent: metadata.continuitySent,
    continuityReturned: !!next,
    continuityConflict: conflict,
    invalidContinuity: metadata.invalidContinuity,
    authReset: metadata.continuityReset,
    upstreamRequestId: metadata.requestId,
    reportedModel: metadata.model,
    outcome: httpError ? 'http_error' : 'streaming',
    ...(httpError ? { completedAt: Date.now() } : {}),
  }
}

function completedDiagnostic(
  usage: TokenUsage,
  rawUsage?: LanguageModelUsage,
): Partial<CacheDiagnostic> {
  const details = rawUsage?.raw?.input_tokens_details
  const cached =
    details && typeof details === 'object' && 'cached_tokens' in details
      ? details.cached_tokens
      : undefined
  return {
    outcome: 'completed',
    completedAt: Date.now(),
    inputTokens: usage.inputTokens,
    cacheReadTokens: usage.cache?.readTokens,
    rawInputTokens: reportedNumber(rawUsage?.raw?.input_tokens),
    rawCacheReadTokens: reportedNumber(cached),
  }
}

function reportedNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
