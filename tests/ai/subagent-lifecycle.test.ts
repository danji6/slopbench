/// <reference types="bun-types" />
import { settleAbandonedTaskParts } from '@sb/convex/lib/subagent'
import { _fail, stopChildSessions } from '@sb/convex/model/stream/lifecycle'
import {
  list as listSubagents,
  stop as stopSubagent,
  stopAll as stopAllSubagents,
} from '@sb/convex/model/subagent/manage'
import {
  _suspendStep,
  deliverChildReport,
} from '@sb/convex/model/stream/subagents'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }

/**
 * Stateful db fake tuned for the sub-agent flows: patches merge into docs,
 * inserts land in `byId`, and index queries capture the messageId filter so
 * per-message content lookups work.
 */
function fakeCtx({
  docs = [],
  agents = [],
  plans = [],
  sessionAgents = [],
  contentsByMessage = {},
  sessionsByParent = {},
  streamsBySession = {},
  membershipsBySession = {},
}: {
  docs?: Row[]
  /** Rows returned by the owner's agents index scan. */
  agents?: Row[]
  /** Rows returned by the plans index scan. */
  plans?: Row[]
  /** Rows returned by the sessionAgents index scan. */
  sessionAgents?: Row[]
  contentsByMessage?: Record<string, Row[]>
  /** Child session rows keyed by parent.sessionId. */
  sessionsByParent?: Record<string, Row[]>
  /** Stream rows keyed by sessionId. */
  streamsBySession?: Record<string, Row[]>
  /** userSessions rows keyed by sessionId. */
  membershipsBySession?: Record<string, Row[]>
}) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; fields: Record<string, unknown> }> = []
  const scheduled: Array<{ args: unknown[] }> = []
  const cancelled: unknown[] = []
  const byId = new Map<string, Row>(docs.map((row) => [row._id, row]))

  const makeQuery = (table: string) => {
    const captured: Array<[string, unknown]> = []
    const q = {
      eq: (field: string, value: unknown) => {
        captured.push([field, value])
        return q
      },
      gt: () => q,
      lt: () => q,
      gte: () => q,
      lte: () => q,
    }
    const chain = {
      withIndex: (_name: string, fn?: (query: typeof q) => unknown) => {
        fn?.(q)
        return chain
      },
      filter: () => chain,
      order: () => chain,
      take: async (n: number) => (await chain.collect()).slice(0, n),
      first: async () => (await chain.collect())[0] ?? null,
      unique: async () => (await chain.collect())[0] ?? null,
      collect: async () => {
        if (table === 'agents') return agents
        if (table === 'plans') return plans
        if (table === 'sessionAgents') return sessionAgents
        if (table === 'messageContents') {
          const messageId = captured.find(([field]) => field === 'messageId')
          return messageId
            ? (contentsByMessage[String(messageId[1])] ?? [])
            : []
        }
        if (table === 'sessions') {
          const parent = captured.find(
            ([field]) => field === 'parent.sessionId',
          )
          return parent ? (sessionsByParent[String(parent[1])] ?? []) : []
        }
        if (table === 'streams') {
          const sessionId = captured.find(([field]) => field === 'sessionId')
          return sessionId ? (streamsBySession[String(sessionId[1])] ?? []) : []
        }
        if (table === 'userSessions') {
          const sessionId = captured.find(([field]) => field === 'sessionId')
          return sessionId
            ? (membershipsBySession[String(sessionId[1])] ?? [])
            : []
        }
        return []
      },
    }
    return chain
  }

  const ctx = {
    userId: owner,
    db: {
      get: async (id: string) => byId.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
        const doc = byId.get(id)
        if (doc) Object.assign(doc, patch)
      },
      insert: async (table: string, fields: Record<string, unknown>) => {
        inserts.push({ table, fields })
        const id = `inserted_${table}_${inserts.length}`
        byId.set(id, { _id: id, ...fields })
        return id
      },
      delete: async () => {},
      query: (table: string) => makeQuery(table),
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        scheduled.push({ args })
        return `job_${scheduled.length}`
      },
      cancel: async (jobId: unknown) => {
        cancelled.push(jobId)
      },
    },
  } as never

  return { ctx, patches, inserts, scheduled, cancelled, byId }
}

const owner = 'user_1'
const parentAgent = {
  _id: 'agent_coder',
  ownerId: owner,
  name: 'Coder',
  subAgents: { mode: 'allow', agentIds: ['agent_explorer'] },
}
const explorer = { _id: 'agent_explorer', ownerId: owner, name: 'Explore' }

function parentDocs(
  parts: unknown[],
  streamFields: Record<string, unknown> = {},
) {
  return [
    {
      status: 'streaming',
      sessionId: 'session_1',
      agentId: 'agent_coder',
      invokedBy: owner,
      operation: 'invoke',
      attempt: 2,
      processingMessageId: 'message_1',
      processingContentId: 'content_1',
      ...streamFields,
      _id: 'stream_1',
    },
    {
      _id: 'session_1',
      ownerId: owner,
      workspace: { workspaceId: 'ws_1', label: 'ws' },
      toolApprovals: { shell: ['git checkout'] },
    },
    { _id: 'message_1', selectedVersion: 1 },
    { _id: 'content_1', segmentIndex: 0, version: 1, parts },
    parentAgent,
    explorer,
  ]
}

function taskPart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool-task',
    toolCallId: 'tc_1',
    state: 'input-available',
    input: { agent_name: 'Explore', prompt: 'Find the config loader' },
    ...overrides,
  }
}

describe('_suspendStep', () => {
  test('spawns a background child, acks the part, and continues', async () => {
    const { ctx, patches, inserts, scheduled } = fakeCtx({
      docs: parentDocs([taskPart()]),
      agents: [parentAgent, explorer],
    })

    const result = await _suspendStep(ctx, { streamId: 'stream_1' as never })

    expect(result).toBe('continue')

    const session = inserts.find(({ table }) => table === 'sessions')
    expect(session?.fields).toMatchObject({
      ownerId: owner,
      activeAgentId: 'agent_explorer',
      workspace: { workspaceId: 'ws_1', label: 'ws' },
      toolApprovals: { shell: ['git checkout'] },
      parent: {
        sessionId: 'session_1',
        streamId: 'stream_1',
        toolCallId: 'tc_1',
        agentId: 'agent_coder',
      },
    })

    // Owner membership + agent link + prompt turn + child stream
    expect(inserts.map(({ table }) => table)).toEqual([
      'sessions',
      'userSessions',
      'sessionAgents',
      'messages',
      'messageContents',
      'streams',
    ])
    const prompt = inserts.find(({ table }) => table === 'messages')
    expect(prompt?.fields).toMatchObject({
      role: 'user',
      status: 'done',
      sender: { type: 'agent', id: 'agent_coder' },
    })
    const childStream = inserts.find(({ table }) => table === 'streams')
    expect(childStream?.fields).toMatchObject({
      operation: 'invoke',
      invokedBy: owner,
      suppressFollowUp: true,
      status: 'pending',
    })

    // The child's stream job was scheduled
    expect(scheduled.length).toBeGreaterThan(0)

    // The part settles right away with a started acknowledgment
    const partsPatch = patches.find(
      ({ id, patch }) => id === 'content_1' && Array.isArray(patch.parts),
    )
    expect((partsPatch?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-available',
      subagentSessionId: 'inserted_sessions_1',
      output: expect.stringContaining('started in the background'),
    })

    // The parent stream never parks
    expect(patches.find(({ id }) => id === 'stream_1')).toBeUndefined()
  })

  test('a plan-mode parent spawns plan-mode children', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: parentDocs([taskPart()], { mode: 'plan' }),
      agents: [parentAgent, explorer],
    })

    await _suspendStep(ctx, { streamId: 'stream_1' as never })

    const session = inserts.find(({ table }) => table === 'sessions')
    expect(session?.fields.mode).toBe('plan')
    const childStream = inserts.find(({ table }) => table === 'streams')
    expect(childStream?.fields.mode).toBe('plan')
  })

  test('normal-mode children carry no mode', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: parentDocs([taskPart()]),
      agents: [parentAgent, explorer],
    })

    await _suspendStep(ctx, { streamId: 'stream_1' as never })

    const session = inserts.find(({ table }) => table === 'sessions')
    expect(session?.fields.mode).toBeUndefined()
    const childStream = inserts.find(({ table }) => table === 'streams')
    expect(childStream?.fields.mode).toBeUndefined()
  })

  test("the parent's plan rides into the child prompt as a snapshot", async () => {
    const { ctx, inserts } = fakeCtx({
      docs: parentDocs([taskPart()]),
      agents: [parentAgent, explorer],
      plans: [
        {
          _id: 'plan_1',
          sessionId: 'session_1',
          content: '# The Plan',
          status: 'draft',
        },
      ],
    })

    await _suspendStep(ctx, { streamId: 'stream_1' as never })

    const content = inserts.find(({ table }) => table === 'messageContents')
    expect(content?.fields.parts).toEqual([
      {
        type: 'plan-link',
        snapshot: { content: '# The Plan', status: 'draft' },
      },
      { type: 'text', text: 'Find the config loader' },
    ])
  })

  test('settles unknown agent names as errors and continues', async () => {
    const part = taskPart({
      input: { agent_name: 'Nope', prompt: 'Do something' },
    })
    const { ctx, patches, inserts } = fakeCtx({
      docs: parentDocs([part]),
      agents: [parentAgent, explorer],
    })

    const result = await _suspendStep(ctx, { streamId: 'stream_1' as never })

    expect(result).toBe('continue')
    expect(inserts).toHaveLength(0)
    const partsPatch = patches.find(({ id }) => id === 'content_1')
    expect((partsPatch?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-error',
      errorText: expect.stringContaining('Unknown agent "Nope"'),
    })
  })

  test('parks as awaiting_approval when approvals are also pending', async () => {
    const approvalPart = {
      type: 'tool-shell',
      toolCallId: 'tc_2',
      state: 'approval-requested',
      approval: { id: 'appr_1' },
    }
    const { ctx, patches } = fakeCtx({
      docs: parentDocs([taskPart(), approvalPart]),
      agents: [parentAgent, explorer],
    })

    const result = await _suspendStep(ctx, { streamId: 'stream_1' as never })

    expect(result).toBe('suspended')
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({ status: 'awaiting_approval' }),
    })

    // The task part still spawned and acked despite the pending approval
    const partsPatch = patches.find(
      ({ id, patch }) => id === 'content_1' && Array.isArray(patch.parts),
    )
    expect((partsPatch?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-available',
      subagentSessionId: 'inserted_sessions_1',
    })
  })

  test('denies pending approvals in sub-agent sessions and continues', async () => {
    const approvalPart = {
      type: 'tool-write_file',
      toolCallId: 'tc_2',
      state: 'approval-requested',
      approval: { id: 'appr_1' },
    }
    const docs = parentDocs([approvalPart])
    Object.assign(docs[1]!, {
      parent: {
        sessionId: 'session_0',
        streamId: 'stream_0',
        toolCallId: 'tc_0',
        agentId: 'agent_coder',
      },
    })
    const { ctx, patches, inserts } = fakeCtx({ docs })

    const result = await _suspendStep(ctx, { streamId: 'stream_1' as never })

    expect(result).toBe('continue')
    expect(inserts).toHaveLength(0)
    const partsPatch = patches.find(({ id }) => id === 'content_1')
    expect((partsPatch?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-denied',
      approval: expect.objectContaining({
        approved: false,
        reason: expect.stringContaining('cannot request user approval'),
      }),
    })
  })
})

function reportDocs() {
  return [
    { _id: 'parent_session', ownerId: owner, activeAgentId: 'agent_coder' },
    {
      _id: 'child_session_1',
      title: 'Find config',
      activeAgentId: 'agent_explorer',
      parent: {
        sessionId: 'parent_session',
        streamId: 'parent_stream',
        toolCallId: 'tc_1',
        agentId: 'agent_coder',
      },
    },
    { _id: 'child_message_1', selectedVersion: 1 },
    parentAgent,
    explorer,
  ]
}

const coderLink = {
  _id: 'link_1',
  sessionId: 'parent_session',
  agentId: 'agent_coder',
}

const childStream1 = {
  _id: 'child_stream_1',
  sessionId: 'child_session_1',
  agentId: 'agent_explorer',
  invokedBy: owner,
  processingMessageId: 'child_message_1',
} as never

describe('deliverChildReport', () => {
  test('delivers the report and wakes an idle parent', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      contentsByMessage: {
        child_message_1: [
          {
            _id: 'cc_1',
            parts: [{ type: 'text', text: 'Found it in config.ts' }],
          },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    // The report lands in the parent session as its own done user turn
    const report = inserts.find(({ table }) => table === 'messages')
    expect(report?.fields).toMatchObject({
      sessionId: 'parent_session',
      role: 'user',
      status: 'done',
      sender: { type: 'agent', id: 'agent_explorer' },
    })
    const content = inserts.find(({ table }) => table === 'messageContents')
    expect(content?.fields.parts).toEqual([
      {
        type: 'subagent-report',
        sessionId: 'child_session_1',
        agentName: 'Explore',
        title: 'Find config',
        status: 'complete',
        text: 'Found it in config.ts',
      },
    ])

    // Idle parent wakes: a fresh invoke turn bounded by the report message
    const invoke = inserts.find(({ table }) => table === 'streams')
    expect(invoke?.fields).toMatchObject({
      sessionId: 'parent_session',
      agentId: 'agent_coder',
      invokedBy: owner,
      operation: 'invoke',
      status: 'pending',
      contextBoundaryMessageId: 'inserted_messages_1',
    })
    expect(scheduled).toHaveLength(1)
  })

  test('does not wake a parent with an active stream', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      streamsBySession: {
        parent_session: [
          {
            _id: 'parent_stream',
            sessionId: 'parent_session',
            leaseExpiresAt: Date.now() + 60_000,
          },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    // Report only; the running turn picks it up via the follow-up gate
    expect(inserts.map(({ table }) => table)).toEqual([
      'messages',
      'messageContents',
    ])
    expect(scheduled).toHaveLength(0)
  })

  test('cascade-stopped children deliver nothing', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
    })

    await deliverChildReport(
      ctx,
      { ...(childStream1 as object), suppressReport: true } as never,
      { kind: 'stopped' },
    )

    expect(inserts).toHaveLength(0)
    expect(scheduled).toHaveLength(0)
  })

  test('no-ops when the parent session is gone', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs().filter((doc) => doc._id !== 'parent_session'),
      sessionAgents: [coderLink],
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    expect(inserts).toHaveLength(0)
  })

  test('a failed child reports the failure', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
    })

    await deliverChildReport(ctx, childStream1, {
      kind: 'failed',
      message: 'boom',
    })

    const content = inserts.find(({ table }) => table === 'messageContents')
    expect((content?.fields.parts as unknown[])[0]).toMatchObject({
      type: 'subagent-report',
      status: 'failed',
      text: 'Sub-agent failed: boom',
    })
  })

  test('a stopped child reports with a stopped note', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      contentsByMessage: {
        child_message_1: [
          { _id: 'cc_1', parts: [{ type: 'text', text: 'Partial findings' }] },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'stopped' })

    const content = inserts.find(({ table }) => table === 'messageContents')
    const part = (content?.fields.parts as { status: string; text: string }[])[0]!
    expect(part.status).toBe('stopped')
    expect(part.text.includes('Partial findings')).toBe(true)
    expect(part.text.includes('stopped before finishing')).toBe(true)
  })

  test('long reports are truncated under the split budget', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      contentsByMessage: {
        child_message_1: [
          { _id: 'cc_1', parts: [{ type: 'text', text: 'y'.repeat(40_000) }] },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    const content = inserts.find(({ table }) => table === 'messageContents')
    const text = (content?.fields.parts as { text: string }[])[0]!.text
    expect(text.length).toBeLessThan(33_000)
    expect(text).toContain('[Report truncated.')
  })

  test('reports only the concluding text, dropping interstitial narration', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      contentsByMessage: {
        child_message_1: [
          {
            _id: 'cc_1',
            parts: [
              { type: 'text', text: 'Let me check the config.' },
              { type: 'tool-read_file', state: 'output-available' },
              { type: 'text', text: 'Now searching for usages.' },
              { type: 'tool-shell', state: 'output-available' },
              { type: 'text', text: '## Report' },
              { type: 'text', text: 'It lives in config.ts.' },
            ],
          },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    const content = inserts.find(({ table }) => table === 'messageContents')
    const text = (content?.fields.parts as { text: string }[])[0]!.text
    // The trailing run of text parts is kept in full...
    expect(text).toBe('## Report\n\nIt lives in config.ts.')
    // ...and the narration before the last tool call is dropped.
    expect(text.includes('Let me check')).toBe(false)
    expect(text.includes('Now searching')).toBe(false)
  })
})

describe('settleAbandonedTaskParts', () => {
  test('settles unspawned task calls with an abandoned note', () => {
    const settled = settleAbandonedTaskParts([
      taskPart(),
      { type: 'text', text: 'hi' },
    ])!

    expect(settled[0]).toMatchObject({
      state: 'output-available',
      output: '[The turn ended before the sub-agent could be started.]',
    })
    expect(settled[1]).toEqual({ type: 'text', text: 'hi' })
  })

  test('returns null when nothing is unsettled', () => {
    expect(
      settleAbandonedTaskParts([
        taskPart({ state: 'output-available', output: 'done' }),
        { type: 'text', text: 'hi' },
      ]),
    ).toBeNull()
  })
})

describe('parent teardown', () => {
  const childSessionRow = {
    _id: 'child_session_1',
    parent: {
      sessionId: 'parent_session',
      streamId: 'parent_stream',
      toolCallId: 'tc_1',
      agentId: 'agent_coder',
    },
  }
  const runningChildStream = {
    _id: 'child_stream_1',
    sessionId: 'child_session_1',
    status: 'streaming',
    jobId: 'job_child',
    processingMessageId: 'child_message_1',
  }

  function failDocs(parts: unknown[]) {
    return [
      {
        _id: 'parent_stream',
        status: 'streaming',
        sessionId: 'parent_session',
        processingMessageId: 'parent_message',
        processingContentId: 'parent_content',
        attempt: 0,
      },
      { _id: 'parent_message', selectedVersion: 1 },
      {
        _id: 'parent_content',
        segmentIndex: 0,
        version: 1,
        parts,
      },
    ]
  }

  test('stopChildSessions silences and stops running children', async () => {
    const { ctx, patches, scheduled, cancelled } = fakeCtx({
      docs: [runningChildStream],
      sessionsByParent: { parent_session: [childSessionRow] },
      streamsBySession: { child_session_1: [runningChildStream] },
    })

    await stopChildSessions(ctx, 'parent_session' as never)

    expect(cancelled).toEqual(['job_child'])
    expect(patches).toContainEqual({
      id: 'child_stream_1',
      patch: {
        status: 'stopping',
        suppressFollowUp: true,
        suppressReport: true,
      },
    })
    expect(scheduled).toContainEqual({
      args: [0, expect.anything(), { streamId: 'child_stream_1' }],
    })
  })

  test('a failed parent leaves children running and settles unspawned parts', async () => {
    const parts = [taskPart()]
    const { ctx, patches, cancelled, byId } = fakeCtx({
      docs: failDocs(parts),
      sessionsByParent: { parent_session: [childSessionRow] },
      streamsBySession: { child_session_1: [runningChildStream] },
    })

    await _fail(ctx, {
      streamId: 'parent_stream' as never,
      message: 'Stream interrupted before completion.',
    })

    const row = byId.get('parent_content') as unknown as { parts: unknown[] }
    expect(row.parts[0]).toMatchObject({
      state: 'output-available',
      output: '[The turn ended before the sub-agent could be started.]',
    })

    // Children are not cascade-stopped by a failed parent turn
    expect(cancelled).toHaveLength(0)
    expect(patches.find(({ id }) => id === 'child_stream_1')).toBeUndefined()
  })
})

describe('subagent management widget', () => {
  const membership = { _id: 'us_1', sessionId: 'parent_session', userId: owner }
  const parentSession = { _id: 'parent_session', ownerId: owner }
  const childSession = {
    _id: 'child_session_1',
    _creationTime: 900,
    title: 'Find the config',
    activeAgentId: 'agent_explorer',
    parent: { sessionId: 'parent_session', agentId: 'agent_coder' },
  }
  const liveChildStream = {
    _id: 'child_stream_1',
    _creationTime: 1_000,
    sessionId: 'child_session_1',
    status: 'streaming',
    jobId: 'job_child',
    processingMessageId: 'child_message_1',
    leaseExpiresAt: Date.now() + 60_000,
  }

  test('list returns running children with agent identity', async () => {
    const { ctx } = fakeCtx({
      docs: [parentSession, explorer, liveChildStream],
      membershipsBySession: { parent_session: [membership] },
      sessionsByParent: { parent_session: [childSession] },
      streamsBySession: { child_session_1: [liveChildStream] },
    })

    const result = (await listSubagents(ctx, {
      sessionId: 'parent_session' as never,
    })) as Array<Record<string, unknown>>

    expect(result).toEqual([
      {
        sessionId: 'child_session_1',
        title: 'Find the config',
        agentName: 'Explore',
        avatarId: undefined,
        running: true,
        status: 'streaming',
        startedAt: expect.any(Number),
        tokens: null,
      },
    ])
  })

  test('list keeps settled children with running=false', async () => {
    const { ctx } = fakeCtx({
      docs: [parentSession, explorer],
      membershipsBySession: { parent_session: [membership] },
      sessionsByParent: { parent_session: [childSession] },
      streamsBySession: {},
    })

    const result = (await listSubagents(ctx, {
      sessionId: 'parent_session' as never,
    })) as Array<Record<string, unknown>>

    expect(result).toEqual([
      expect.objectContaining({
        sessionId: 'child_session_1',
        running: false,
        status: null,
      }),
    ])
  })

  test('list rejects a non-member', async () => {
    const { ctx } = fakeCtx({
      docs: [parentSession],
      membershipsBySession: {},
      sessionsByParent: { parent_session: [childSession] },
    })

    await expect(
      listSubagents(ctx, { sessionId: 'parent_session' as never }),
    ).rejects.toThrow()
  })

  test('stop silently halts one child', async () => {
    const { ctx, patches, cancelled } = fakeCtx({
      docs: [parentSession, childSession, liveChildStream],
      membershipsBySession: { parent_session: [membership] },
      streamsBySession: { child_session_1: [liveChildStream] },
    })

    await stopSubagent(ctx, {
      sessionId: 'parent_session' as never,
      childSessionId: 'child_session_1' as never,
    })

    expect(cancelled).toEqual(['job_child'])
    // A user-initiated stop has nothing to report, so it's silenced
    expect(patches).toContainEqual({
      id: 'child_stream_1',
      patch: {
        status: 'stopping',
        suppressFollowUp: true,
        suppressReport: true,
      },
    })
  })

  test('stop rejects a session that is not a child of the parent', async () => {
    const orphan = { _id: 'child_session_1', parent: { sessionId: 'other' } }
    const { ctx } = fakeCtx({
      docs: [parentSession, orphan],
      membershipsBySession: { parent_session: [membership] },
    })

    await expect(
      stopSubagent(ctx, {
        sessionId: 'parent_session' as never,
        childSessionId: 'child_session_1' as never,
      }),
    ).rejects.toThrow()
  })

  test('stopAll silences every running child', async () => {
    const { ctx, patches } = fakeCtx({
      docs: [parentSession, childSession, liveChildStream],
      membershipsBySession: { parent_session: [membership] },
      sessionsByParent: { parent_session: [childSession] },
      streamsBySession: { child_session_1: [liveChildStream] },
    })

    await stopAllSubagents(ctx, { sessionId: 'parent_session' as never })

    expect(patches).toContainEqual({
      id: 'child_stream_1',
      patch: {
        status: 'stopping',
        suppressFollowUp: true,
        suppressReport: true,
      },
    })
  })
})
