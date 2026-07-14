import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import {
  type SubagentReportPart,
  type SubagentReportStatus,
  type TaskToolInput,
  type TaskToolPart,
  pendingTaskParts,
  taskInput,
} from '../../lib/subagent'
import { resolveSpawnableAgents } from '../agent/subagents'
import { hasPendingToolApprovals } from '../chat/approvals'
import { agentSenderSnapshot } from '../chat/identities'
import {
  getProcessingSegmentRow,
  insertMessage,
  listSelectedSegments,
  patchSegmentParts,
} from '../messageContents'
import { syncActivity } from '../messages'
import { createPlanLinkPart, getBySession as getPlan } from '../plans'
import { findModelEntry } from '../provider/providers'
import { getActiveStream } from '../session/memberships'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'
import {
  APPROVAL_LEASE_MS,
  STREAM_LEASE_MS,
  reserveInvokeTurn,
} from './lifecycle'

/** Reports stay under the segment split budget. The full transcript lives in the child session. */
const REPORT_MAX_CHARS = 32 * 1024

const SUBAGENT_DENIAL_REASON =
  'Denied automatically: sub-agent sessions cannot request user approval. ' +
  'Continue with auto-approved tools only, or report what you could not do.'

export type SuspendStepResult = 'suspended' | 'continue' | 'abort'

/**
 * Handles a step that ended with pending approvals and/or task calls.
 *
 * Parent sessions: spawns a background child session for a valid task call
 * and settles the part right away with a started acknowledgment that the
 * model sees (invalid ones settle as errors). The child reports back later
 * via deliverChildReport. The stream only suspends when approvals are also
 * pending.
 *
 * Sub-agent sessions: approvals can't be answered by anyone, so every
 * pending one is denied with a typed reason and the stream continues.
 */
export async function _suspendStep(
  ctx: MutationCtx,
  { streamId }: { streamId: Id<'streams'> },
): Promise<SuspendStepResult> {
  const stream = await ctx.db.get(streamId)
  if (!stream || stream.status === 'stopping' || !stream.processingMessageId) {
    return 'abort'
  }

  const session = await ctx.db.get(stream.sessionId)
  const row = await getProcessingSegmentRow(ctx, stream)
  if (!session || !row) return 'abort'

  if (session.parent) {
    const denied = denyPendingApprovals(row.parts)
    if (denied) {
      await patchSegmentParts(ctx, stream.processingMessageId, row, denied)
    }
    return 'continue'
  }

  let parts = row.parts
  const pending = pendingTaskParts(parts)
  if (pending.length > 0) {
    const agent = await ctx.db.get(stream.agentId)
    const spawnable = agent ? await resolveSpawnableAgents(ctx, agent) : []
    for (const part of pending) {
      parts = await spawnChildForTask(ctx, {
        stream,
        session,
        spawnable,
        parts,
        part,
      })
    }
    await patchSegmentParts(ctx, stream.processingMessageId, row, parts)
  }

  if (hasPendingToolApprovals(parts)) {
    await park(ctx, streamId)
    return 'suspended'
  }

  return 'continue'
}

async function park(ctx: MutationCtx, streamId: Id<'streams'>) {
  await ctx.db.patch(streamId, {
    status: 'awaiting_approval',
    attempt: 0,
    jobId: undefined,
    leaseExpiresAt: Date.now() + APPROVAL_LEASE_MS,
  })
}

function denyPendingApprovals(parts: unknown[]): unknown[] | null {
  let changed = false
  const next = parts.map((part) => {
    const typed = part as {
      type?: string
      state?: string
      approval?: { id?: string }
    }
    if (typeof typed.type !== 'string' || !typed.type.startsWith('tool-')) {
      return part
    }
    if (typed.state !== 'approval-requested' || !typed.approval?.id) {
      return part
    }
    changed = true
    return {
      ...typed,
      state: 'output-denied',
      approval: {
        id: typed.approval.id,
        approved: false,
        reason: SUBAGENT_DENIAL_REASON,
      },
    }
  })
  return changed ? next : null
}

type SpawnTaskArgs = {
  stream: Doc<'streams'>
  session: Doc<'sessions'>
  spawnable: { _id: Id<'agents'>; name: string }[]
  parts: unknown[]
  part: TaskToolPart
}

/**
 * Spawns the background child for one task call and settles the part with a
 * started acknowledgment, or settles it as an error.
 */
async function spawnChildForTask(
  ctx: MutationCtx,
  { stream, session, spawnable, parts, part }: SpawnTaskArgs,
): Promise<unknown[]> {
  const input = taskInput(part)
  const target = input
    ? spawnable.find((candidate) => candidate.name === input.agent_name)
    : undefined
  const agent = target ? await ctx.db.get(target._id) : null

  if (!input || !agent) {
    const roster = spawnable.map((candidate) => candidate.name).join(', ')
    return replacePart(parts, part, {
      ...part,
      state: 'output-error',
      errorText: input
        ? `Unknown agent "${input.agent_name}". Available agents: ${roster || 'none'}.`
        : 'Invalid task input: agent_name and prompt are required.',
    })
  }

  const childSessionId = await spawnChild(ctx, {
    stream,
    session,
    agent,
    input,
    toolCallId: part.toolCallId,
  })

  return replacePart(parts, part, {
    ...part,
    state: 'output-available',
    subagentSessionId: childSessionId,
    output:
      `Sub-agent "${agent.name}" started in the background ` +
      `(session ${childSessionId}). Its report will arrive as a later ` +
      'message in this conversation. To wait for it, end your turn.',
  })
}

function replacePart(
  parts: unknown[],
  part: TaskToolPart,
  next: unknown,
): unknown[] {
  return parts.map((entry) => (entry === part ? next : entry))
}

type SpawnChildArgs = {
  stream: Doc<'streams'>
  session: Doc<'sessions'>
  agent: Doc<'agents'>
  input: TaskToolInput
  toolCallId: string
}

/**
 * Creates the hidden child session (owned by the parent's owner, sharing its
 * workspace, approvals and mode), posts the task prompt as a user role turn
 * from the parent agent, and schedules the child's stream.
 */
async function spawnChild(
  ctx: MutationCtx,
  { stream, session, agent, input, toolCallId }: SpawnChildArgs,
): Promise<Id<'sessions'>> {
  const now = Date.now()
  const agentSettings = await getSettingsByOwnerId(ctx, agent.ownerId)
  const model = agent.modelId
    ? (findModelEntry(agentSettings?.modelProviders, agent.modelId) ?? {
        id: agent.modelId,
      })
    : undefined

  // A preset title keeps scheduleTitle from running for hidden sessions
  const title = input.title ?? input.prompt.trim().slice(0, 80)

  // A child session inherits the parent's mode
  const mode = stream.mode === 'plan' ? stream.mode : undefined

  const childSessionId = await ctx.db.insert('sessions', {
    ownerId: session.ownerId,
    title,
    activeAgentId: agent._id,
    workspace: session.workspace,
    toolApprovals: cloneApprovals(session.toolApprovals),
    metadata: model ? { model } : undefined,
    mode,
    parent: {
      sessionId: session._id,
      streamId: stream._id,
      toolCallId,
      agentId: stream.agentId,
    },
    lastMessageAt: now,
  })

  await ctx.db.insert('userSessions', {
    sessionId: childSessionId,
    userId: session.ownerId,
    role: 'owner',
    lastMessageAt: now,
    title,
    hidden: true,
  })

  await ctx.db.insert('sessionAgents', {
    sessionId: childSessionId,
    agentId: agent._id,
    addedBy: session.ownerId,
  })

  const parentAgent = await ctx.db.get(stream.agentId)
  const parentSettings = parentAgent
    ? await getSettingsByOwnerId(ctx, parentAgent.ownerId)
    : null

  // Carry over the parent's plan (resolved to a <plan> block)
  const plan = await getPlan(ctx, session._id)
  const parts = [
    ...(plan?.content.trim() ? [createPlanLinkPart(plan)] : []),
    { type: 'text', text: input.prompt },
  ]

  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: childSessionId,
      sender: { type: 'agent', id: stream.agentId },
      role: 'user',
      senderSnapshot: parentAgent
        ? agentSenderSnapshot(parentAgent, parentSettings)
        : undefined,
      status: 'done',
    },
    parts,
  )
  await syncActivity(ctx, childSessionId, parts)

  const prompt = await ctx.db.get(messageId)
  const childStreamId = await ctx.db.insert('streams', {
    sessionId: childSessionId,
    agentId: agent._id,
    // The parent's invoker gates workspace tools in the child too
    invokedBy: stream.invokedBy,
    contextBoundaryMessageId: messageId,
    contextBoundaryCreationTime: prompt?._creationTime,
    operation: 'invoke',
    blocking: false,
    status: 'pending',
    attempt: 0,
    leaseExpiresAt: now + STREAM_LEASE_MS,
    suppressFollowUp: true,
    mode,
  })

  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.actions.streams._stream,
    { streamId: childStreamId },
  )
  await ctx.db.patch(childStreamId, { jobId })

  return childSessionId
}

function cloneApprovals(approvals: Doc<'sessions'>['toolApprovals']) {
  if (!approvals) return undefined
  return {
    tools: approvals.tools?.slice(),
    shell: approvals.shell?.slice(),
    paths: approvals.paths?.slice(),
  }
}

export type ChildOutcome =
  | { kind: 'complete' }
  | { kind: 'stopped' }
  | { kind: 'failed'; message: string }

/**
 * Delivers a finished child's report to the parent session as its own
 * `subagent-report` message, then wakes the parent with a fresh invoke turn
 * when it is idle.
 */
export async function deliverChildReport(
  ctx: MutationCtx,
  childStream: Doc<'streams'>,
  outcome: ChildOutcome,
) {
  if (childStream.suppressReport) return

  const childSession = await ctx.db.get(childStream.sessionId)
  const parent = childSession?.parent
  if (!childSession || !parent) return

  const parentSession = await ctx.db.get(parent.sessionId)
  if (!parentSession) return

  const agent = await ctx.db.get(childStream.agentId)
  const settings = agent ? await getSettingsByOwnerId(ctx, agent.ownerId) : null

  const part: SubagentReportPart = {
    type: 'subagent-report',
    sessionId: childSession._id,
    agentName: agent?.name ?? 'Sub-agent',
    ...(childSession.title ? { title: childSession.title } : {}),
    ...(await resolveReport(ctx, childStream, outcome)),
  }

  // Insert message without calling syncActivity as it's synced upon wake
  // turn completion anyway
  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: parent.sessionId,
      sender: { type: 'agent', id: childStream.agentId },
      role: 'user',
      senderSnapshot: agent ? agentSenderSnapshot(agent, settings) : undefined,
      status: 'done',
    },
    [part],
  )

  // A live parent turn consumes the report at its end via the follow-up gate
  if (await getActiveStream(ctx, parent.sessionId)) return

  const message = await ctx.db.get(messageId)
  if (!message) return

  await reserveInvokeTurn(ctx, {
    session: parentSession,
    boundaryMessage: message,
    invokedBy: childStream.invokedBy,
  })
}

async function resolveReport(
  ctx: MutationCtx,
  childStream: Doc<'streams'>,
  outcome: ChildOutcome,
): Promise<{ status: SubagentReportStatus; text: string }> {
  if (outcome.kind === 'failed') {
    return { status: 'failed', text: `Sub-agent failed: ${outcome.message}` }
  }

  const report = truncateReport(await childReportText(ctx, childStream))

  if (outcome.kind === 'stopped') {
    const note = '[The sub-agent was stopped before finishing.]'
    return { status: 'stopped', text: report ? `${report}\n\n${note}` : note }
  }

  return {
    status: 'complete',
    text: report || '(The sub-agent finished without a report.)',
  }
}

/** The child turn's final text, concatenated across split segments. */
async function childReportText(
  ctx: MutationCtx,
  childStream: Doc<'streams'>,
): Promise<string> {
  if (!childStream.processingMessageId) return ''
  const message = await ctx.db.get(childStream.processingMessageId)
  if (!message) return ''

  const segments = await listSelectedSegments(ctx, message)
  return segments
    .flatMap((segment) => segment.parts)
    .flatMap((part) => {
      const typed = part as { type?: string; text?: string }
      return typed.type === 'text' && typeof typed.text === 'string'
        ? [typed.text]
        : []
    })
    .join('\n\n')
    .trim()
}

function truncateReport(text: string): string {
  if (text.length <= REPORT_MAX_CHARS) return text
  return (
    text.slice(0, REPORT_MAX_CHARS) +
    '\n\n[Report truncated. The full transcript is in the sub-agent session.]'
  )
}

/**
 * Reschedules the parent once every approval in the step is settled,
 * otherwise just refreshes the lease.
 */
export async function resumeIfSettled(
  ctx: MutationCtx,
  stream: Doc<'streams'>,
  parts: unknown[],
) {
  if (hasPendingToolApprovals(parts)) {
    await ctx.db.patch(stream._id, {
      attempt: 0,
      leaseExpiresAt: Date.now() + APPROVAL_LEASE_MS,
    })
    return
  }

  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.actions.streams._stream,
    { streamId: stream._id },
  )

  await ctx.db.patch(stream._id, {
    status: 'pending',
    attempt: 0,
    jobId,
    leaseExpiresAt: Date.now() + STREAM_LEASE_MS,
  })
}
