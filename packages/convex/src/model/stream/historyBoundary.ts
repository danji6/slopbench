import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { StreamCommand } from '../../types'

type HistoryStream = Pick<
  Doc<'streams'>,
  'sessionId' | 'contextBoundaryCreationTime' | 'command'
>

/** Retry and resume write to a historical message with a fixed history ceiling. */
export function isHistoricalTurn(command: StreamCommand) {
  return (
    command.kind === 'retry' ||
    (command.kind === 'invoke' && command.preserveContextBoundary === true)
  )
}

export function historyUpperBound(stream: HistoryStream) {
  return (
    stream.contextBoundaryCreationTime ??
    (isHistoricalTurn(stream.command) ? 0 : Number.MAX_SAFE_INTEGER)
  )
}

/** Returns the last reset visible at this turn's history upper bound. */
export function latestContextReset(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  upper: number,
) {
  return ctx.db
    .query('messages')
    .withIndex('by_sessionId_type_status', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('type', 'contextReset')
        .eq('status', 'done')
        .lte('_creationTime', upper),
    )
    .order('desc')
    .first()
}

/** Finds the newest content or reset that can serve as a turn's upper bound. */
export async function latestHistoryAnchor(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
  before?: number,
) {
  const content = ctx.db
    .query('messages')
    .withIndex('by_sessionId_status_contextEligible', (q) => {
      const done = q
        .eq('sessionId', sessionId)
        .eq('status', 'done')
        .eq('contextEligible', true)
      return before === undefined ? done : done.lt('_creationTime', before)
    })
  const resets = ctx.db
    .query('messages')
    .withIndex('by_sessionId_type_status', (q) => {
      const done = q
        .eq('sessionId', sessionId)
        .eq('type', 'contextReset')
        .eq('status', 'done')
      return before === undefined ? done : done.lt('_creationTime', before)
    })
  const [message, reset] = await Promise.all([
    content.order('desc').first(),
    resets.order('desc').first(),
  ])

  return reset && (!message || reset._creationTime > message._creationTime)
    ? reset
    : message
}

/** Resolves the exclusive history floor and the summary carried across it. */
export async function resolveHistoryBoundary(
  ctx: QueryCtx,
  stream: HistoryStream,
) {
  const { sessionId, command } = stream
  const historical = isHistoricalTurn(command)
  const upper = historyUpperBound(stream)
  const reset = await latestContextReset(ctx, sessionId, upper)
  const resetAt = reset?._creationTime ?? 0
  const summary = await ctx.db
    .query('messages')
    .withIndex('by_sessionId_type_status', (q) => {
      const range = q
        .eq('sessionId', sessionId)
        .eq('type', 'summary')
        .eq('status', 'done')
        .gt('_creationTime', resetAt)
      return historical ? range.lte('_creationTime', upper) : range
    })
    .filter((q) => {
      const logical = q.field('summaryBoundaryCreationTime')
      const created = q.field('_creationTime')
      // A summary can be created after a queued message it did not summarize.
      return q.and(
        q.eq(q.field('contextEligible'), true),
        q.or(
          q.and(q.gte(logical, resetAt), q.lte(logical, upper)),
          q.and(q.eq(logical, undefined), q.lte(created, upper)),
        ),
      )
    })
    .order('desc')
    .first()

  const floor = summary?.summaryBoundaryCreationTime ?? summary?._creationTime
  return { upper, floor: floor ?? resetAt, summary }
}
