import type { ShellOutputRange, ShellToolOutput } from '@sb/core/types/tools'

import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { sharedSessionId } from '../lib/subagent'
import type { ShellDeliveryPositionArgs } from '../types'
import { getSessionWithWorkspace } from './session/folderContext'
import { getActiveStream } from './session/memberships'
import { release } from './shellJobs'
import { ownsExecution } from './stream/execution'
import type { ShellReadPosition } from './tool/shellContracts'

type Reader = {
  sessionId: Id<'sessions'>
  agentId: Id<'agents'>
  workspaceId: string
}

type HistoryView = {
  boundary?: number
  processingMessageId?: Id<'messages'>
}

type Source = Reader & {
  messageId: Id<'messages'>
  version: number
  partId: string
}

type ShellReadPart = {
  type?: string
  state?: string
  preliminary?: boolean
  toolCallId?: string
  output?: ShellToolOutput
}

type FinalShellReadPart = ShellReadPart & {
  toolCallId: string
  output: ShellToolOutput
}

function isFinalShellRead(part: unknown): part is FinalShellReadPart {
  if (!part || typeof part !== 'object') return false

  const result = part as ShellReadPart
  const completed =
    result.type === 'tool-shell_output' && result.state === 'output-available'

  return (
    completed &&
    !result.preliminary &&
    typeof result.toolCallId === 'string' &&
    typeof result.output === 'object' &&
    result.output !== null
  )
}

/** Finds new final reads so ordinary token patches do no delivery bookkeeping. */
export function newShellReadResults(previous: unknown[], parts: unknown[]) {
  const saved = new Set(
    previous.filter(isFinalShellRead).map((part) => part.toolCallId),
  )
  return parts
    .filter(isFinalShellRead)
    .filter((part) => !saved.has(part.toolCallId))
}

/** Finds the first gap, retaining parser state at the end of contiguous coverage. */
export function positionFromRanges(
  ranges: ShellOutputRange[],
  explicitOffset?: number,
): ShellReadPosition {
  const automatic = ranges.filter((range) => !range.replay)
  automatic.sort((a, b) => a.requestedOffset - b.requestedOffset)
  const covered: ShellReadPosition['covered'] = []

  for (const range of automatic) {
    const previous = covered.at(-1)
    if (previous && range.requestedOffset <= previous.end) {
      previous.end = Math.max(previous.end, range.nextOffset)
    } else {
      covered.push({ start: range.requestedOffset, end: range.nextOffset })
    }
  }

  const first = covered[0]
  const offset = explicitOffset ?? (first?.start === 0 ? first.end : 0)
  const states = explicitOffset === undefined ? automatic : ranges
  const state = [...states]
    .reverse()
    .find((range) => range.nextOffset === offset)?.ansiState

  return { offset, ansiState: state ?? 'text', covered }
}

/** Reads delivery provenance independently of compaction's text-history floor. */
export async function readPosition(
  ctx: QueryCtx,
  reader: Reader,
  jobId: string,
  view: HistoryView = {},
  offset?: number,
): Promise<ShellReadPosition> {
  const rows = await ctx.db
    .query('shellOutputDeliveries')
    .withIndex('by_reader_job', (q) =>
      q
        .eq('sessionId', reader.sessionId)
        .eq('agentId', reader.agentId)
        .eq('workspaceId', reader.workspaceId)
        .eq('jobId', jobId),
    )
    .collect()

  const sources = new Map<Id<'messages'>, Doc<'messages'> | null>()
  const ranges: ShellOutputRange[] = []
  for (const row of rows) {
    if (!sources.has(row.messageId))
      sources.set(row.messageId, await ctx.db.get(row.messageId))

    const source = sources.get(row.messageId)
    if (!source || source.selectedVersion !== row.version) continue

    const userKilled =
      source.extra && 'userKilled' in source.extra && source.extra.userKilled

    if (source.hidden || source.contextEligible === false || userKilled)
      continue

    const processing = source._id === view.processingMessageId
    if (!processing && source.status !== 'done') continue
    if (!processing && source._creationTime > (view.boundary ?? Infinity))
      continue

    ranges.push(row.range)
  }

  return positionFromRanges(ranges, offset)
}

/** Resolves a reader from the currently owned stream, including historical retries. */
export async function executionPosition(
  ctx: QueryCtx,
  args: ShellDeliveryPositionArgs,
) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args)) return null

  const session = await getSessionWithWorkspace(ctx, stream.sessionId)
  if (!session) return null

  return readPosition(
    ctx,
    {
      sessionId: stream.sessionId,
      agentId: stream.agentId,
      workspaceId: session.workspace?.workspaceId ?? sharedSessionId(session),
    },
    args.jobId,
    {
      boundary: stream.contextBoundaryCreationTime,
      processingMessageId: stream.state.processingMessageId,
    },
    args.offset,
  )
}

/** Samples the recipient's selected history before a completion report is published. */
export async function reportPosition(
  ctx: QueryCtx,
  args: { shellJobId: Id<'shellJobs'>; generation: number },
) {
  const row = await ctx.db.get(args.shellJobId)
  if (!row || row.generation !== args.generation || row.watcherId) return null

  const session = await getSessionWithWorkspace(ctx, row.sessionId)
  if (!session) return null

  const active = await getActiveStream(ctx, row.sessionId)

  return readPosition(
    ctx,
    {
      sessionId: row.sessionId,
      agentId: row.agentId,
      workspaceId: session.workspace?.workspaceId ?? sharedSessionId(session),
    },
    row.jobId,
    { processingMessageId: active?.state.processingMessageId },
  )
}

/** Records a final result in its transcript transaction; repeated patches are harmless. */
export async function recordDelivery(
  ctx: MutationCtx,
  source: Source,
  output: ShellToolOutput,
) {
  if (!output.range) return
  if (output.status === 'lost' || output.status === 'running') return
  if (output.range.nextOffset <= output.range.requestedOffset) return

  const previous = await ctx.db
    .query('shellOutputDeliveries')
    .withIndex('by_source', (q) =>
      q
        .eq('messageId', source.messageId)
        .eq('version', source.version)
        .eq('partId', source.partId),
    )
    .unique()
  if (previous) return

  await ctx.db.insert('shellOutputDeliveries', {
    ...source,
    jobId: output.jobId,
    range: output.range,
  })
}

/** Captures only genuinely final paged tool results, never preliminary snapshots. */
export async function recordToolDeliveries(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  row: Doc<'messageContents'>,
  parts: unknown[],
) {
  const reads = parts.filter(isFinalShellRead)
  if (!reads.length) return

  const session = await getSessionWithWorkspace(ctx, stream.sessionId)
  if (!session) return

  for (const result of reads) {
    const output = result.output
    if (output.range) {
      await recordDelivery(
        ctx,
        {
          sessionId: stream.sessionId,
          agentId: stream.agentId,
          workspaceId:
            session.workspace?.workspaceId ?? sharedSessionId(session),
          messageId: row.messageId,
          version: row.version,
          partId: result.toolCallId,
        },
        output,
      )
    }
    const ended = output.status !== 'running' && output.status !== 'background'
    if (output.jobId && ended) {
      await release(ctx, { sessionId: stream.sessionId, jobId: output.jobId })
    }
  }
}

/** Removes provenance when its source message is deleted. */
export async function removeDeliveriesForMessage(
  ctx: MutationCtx,
  messageId: Id<'messages'>,
  version?: number,
) {
  const rows = await ctx.db
    .query('shellOutputDeliveries')
    .withIndex('by_source', (q) => {
      const source = q.eq('messageId', messageId)
      return version === undefined ? source : source.eq('version', version)
    })
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}

type RemovedParts = {
  messageId: Id<'messages'>
  version: number
  parts: unknown[]
}

/** Invalidates delivery coverage when its result or report part is removed. */
export async function removeDeliveriesForParts(
  ctx: MutationCtx,
  args: RemovedParts,
) {
  const partIds = new Set(
    args.parts.filter(isFinalShellRead).map((part) => part.toolCallId),
  )
  const hasReport = args.parts.some(
    (part) => (part as { type?: string } | null)?.type === 'shell-report',
  )
  if (hasReport) partIds.add('shell-report')

  for (const partId of partIds) {
    const delivery = await ctx.db
      .query('shellOutputDeliveries')
      .withIndex('by_source', (q) =>
        q
          .eq('messageId', args.messageId)
          .eq('version', args.version)
          .eq('partId', partId),
      )
      .unique()
    if (delivery) await ctx.db.delete(delivery._id)
  }
}
