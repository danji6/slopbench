import type { ProviderContinuity } from '@sb/core/provider-continuity'
import { isRoutingHeader } from '@sb/core/provider-continuity'

import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type {
  PrepareProviderRequestArgs,
  ProviderContinuityScope,
  RecordCacheDiagnosticArgs,
  SaveProviderContinuityArgs,
  StreamExecutionArgs,
} from '../../types'
import { getState, patchState } from '../session/state'
import { ownsExecution } from './execution'

/** Describes the identity change without retaining raw cache keys. */
export function continuityResetReason(
  previous: ProviderContinuityScope | undefined,
  next: ProviderContinuityScope,
) {
  if (!previous || previous.messageId !== next.messageId) return 'new-turn'
  if (previous.providerId !== next.providerId) return 'provider-changed'
  const connectionChanged =
    previous.ownerId !== next.ownerId ||
    previous.connectionId !== next.connectionId
  if (connectionChanged) return 'connection-changed'
  if (previous.model !== next.model) return 'model-changed'
  if (previous.cacheKeyHash !== next.cacheKeyHash) return 'cache-key-changed'
  return 'none'
}

/** Resolves state under execution ownership, independent of action generation changes. */
export async function prepareProviderRequest(
  ctx: MutationCtx,
  args: PrepareProviderRequestArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args))
    error('Stream execution is no longer active', 409)
  if (stream.state.processingMessageId !== args.scope.messageId)
    error('Stream turn changed', 409)

  const resetReason = continuityResetReason(
    stream.providerContinuity?.scope,
    args.scope,
  )
  const value =
    resetReason === 'none' ? stream.providerContinuity?.value : undefined
  if (resetReason !== 'none') {
    await ctx.db.patch(stream._id, {
      providerContinuity: { scope: args.scope },
    })
  }

  const history = (await getState(ctx, stream.sessionId))?.cacheDiagnostics

  return { value, resetReason, previous: history?.at(-1) }
}

/** Keeps the first issued value, replacing it only when sign-in ownership changes. */
export async function saveProviderContinuity(
  ctx: MutationCtx,
  args: SaveProviderContinuityArgs,
) {
  const stream = await ctx.db.get(args.streamId)

  if (!ownsExecution(stream, args)) return false
  if (stream.state.processingMessageId !== args.scope.messageId) return false

  const reason = continuityResetReason(
    stream.providerContinuity?.scope,
    args.scope,
  )
  if (reason !== 'none') return false

  assertContinuity(args.value)
  const existing = stream.providerContinuity?.value
  const authChanged =
    args.value && existing?.authRevision !== args.value.authRevision
  const replace = args.reset || authChanged || !existing
  if (replace) {
    await ctx.db.patch(stream._id, {
      providerContinuity: { scope: args.scope, value: args.value },
    })
  }

  return true
}

function assertContinuity(value: ProviderContinuity | undefined) {
  if (!value) return
  if (!isRoutingHeader(value.token) || !isRoutingHeader(value.authRevision)) {
    error('Invalid provider continuity state', 400)
  }
}

export async function clearProviderContinuity(
  ctx: MutationCtx,
  args: StreamExecutionArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return
  if (stream.providerContinuity)
    await ctx.db.patch(stream._id, { providerContinuity: undefined })
}

/** Upserts bounded, sanitized request history without resurrecting expired entries. */
export async function recordCacheDiagnostic(
  ctx: MutationCtx,
  args: RecordCacheDiagnosticArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return

  const { diagnostic } = args
  if (diagnostic.streamId !== stream._id) return
  if (diagnostic.generation !== args.generation) return
  if (diagnostic.messageId !== stream.state.processingMessageId) return

  const history = (await getState(ctx, stream.sessionId))?.cacheDiagnostics ?? [] // prettier-ignore
  const index = history.findIndex((entry) => entry.id === diagnostic.id)
  if (index < 0) {
    if (diagnostic.outcome !== 'pending') return
    history.push(diagnostic)
  } else {
    if (diagnostic.outcome === 'pending') return
    history[index] = { ...history[index], ...diagnostic }
  }

  await patchState(ctx, stream.sessionId, {
    cacheDiagnostics: history.slice(-50),
  })
}
