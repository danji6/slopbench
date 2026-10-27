import { getApprovals } from '@sb/convex/model/session/state'
import { _suspendStep } from '@sb/convex/model/stream/subagents'
import { describe, expect, test } from 'bun:test'
import {
  explorer,
  owner,
  parentAgent,
  parentApprovals,
  parentDocs,
  taskPart,
} from '~/tests/helpers/subagent-lifecycle'
import { fakeCtx } from '~/tests/setup/subagents'

describe('_suspendStep', () => {
  test('spawns a background child, acks the part, and continues', async () => {
    const { ctx, patches, inserts, scheduled } = fakeCtx({
      docs: parentDocs([taskPart()]),
      agents: [parentAgent, explorer],
      sessionStates: [
        {
          _id: 'state_1',
          sessionId: 'session_1',
          toolApprovals: parentApprovals,
        },
      ],
    })

    const result = await _suspendStep(ctx, {
      generation: 0,
      streamId: 'stream_1' as never,
    })

    expect(result).toBe('continue')

    const session = inserts.find(({ table }) => table === 'sessions')
    expect(session?.fields).toMatchObject({
      ownerId: owner,
      activeAgentId: 'agent_explorer',
      model: { id: 'parent-model', label: 'Parent Model' },
      reasoningEffort: 'high',
      parent: {
        sessionId: 'session_1',
        streamId: 'stream_1',
        toolCallId: 'tc_1',
        agentId: 'agent_coder',
      },
    })

    expect(await getApprovals(ctx, 'inserted_sessions_1' as never)).toEqual(
      parentApprovals,
    )

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
      invokedBy: owner,
      suppressFollowUp: true,
      command: { kind: 'invoke' },
      state: { phase: 'reserved' },
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

  test('a configured roster cannot spawn a task when delegation is disabled', async () => {
    const disabled = { ...parentAgent, tools: [] }
    const { ctx, inserts, patches } = fakeCtx({
      docs: parentDocs([taskPart()]).map((row) =>
        row._id === parentAgent._id ? disabled : row,
      ),
      agents: [disabled, explorer],
    })
    expect(
      await _suspendStep(ctx, { generation: 0, streamId: 'stream_1' as never }),
    ).toBe('continue')
    expect(inserts.filter((row) => row.table === 'sessions')).toHaveLength(0)
    expect(
      patches.find((row) => row.id === 'content_1')?.patch.parts,
    ).toMatchObject([{ state: 'output-error' }])
  })

  test('a plan-mode parent spawns plan-mode children', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: parentDocs([taskPart()], {
        command: { kind: 'invoke', mode: 'plan' },
      }),
      agents: [parentAgent, explorer],
    })

    await _suspendStep(ctx, { generation: 0, streamId: 'stream_1' as never })

    const session = inserts.find(({ table }) => table === 'sessions')
    expect(session?.fields.mode).toBe('plan')
    const childStream = inserts.find(({ table }) => table === 'streams')
    expect((childStream?.fields.command as { mode?: string })?.mode).toBe(
      'plan',
    )
  })

  test('normal-mode children carry no mode', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: parentDocs([taskPart()]),
      agents: [parentAgent, explorer],
    })

    await _suspendStep(ctx, { generation: 0, streamId: 'stream_1' as never })

    const session = inserts.find(({ table }) => table === 'sessions')
    expect(session?.fields.mode).toBeUndefined()
    const childStream = inserts.find(({ table }) => table === 'streams')
    expect(
      (childStream?.fields.command as { mode?: string })?.mode,
    ).toBeUndefined()
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

    await _suspendStep(ctx, { generation: 0, streamId: 'stream_1' as never })

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

    const result = await _suspendStep(ctx, {
      generation: 0,
      streamId: 'stream_1' as never,
    })

    expect(result).toBe('continue')
    expect(inserts).toHaveLength(0)
    const partsPatch = patches.find(({ id }) => id === 'content_1')
    expect((partsPatch?.patch.parts as unknown[])[0]).toMatchObject({
      state: 'output-error',
      errorText: expect.stringContaining('Unknown agent "Nope"'),
    })
  })

  test('parks for questions before approvals and notifies members', async () => {
    const askPart = {
      type: 'tool-ask',
      toolCallId: 'tc_input',
      state: 'input-available',
      input: {
        questions: [
          {
            question: 'Pick one',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
    }
    const approvalPart = {
      type: 'tool-shell',
      toolCallId: 'tc_approval',
      state: 'approval-requested',
      approval: { id: 'approval_1' },
    }
    const { ctx, patches, inserts } = fakeCtx({
      docs: parentDocs([askPart, approvalPart]),
      membershipsBySession: {
        session_1: [
          { _id: 'membership_1', userId: owner },
          { _id: 'membership_2', userId: 'user_2' },
        ],
      },
    })

    const result = await _suspendStep(ctx, {
      generation: 0,
      streamId: 'stream_1' as never,
    })

    expect(result).toBe('suspended')
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        state: expect.objectContaining({ phase: 'awaiting_input' }),
      }),
    })
    const notifications = inserts.filter(
      ({ table }) => table === 'notifications',
    )
    expect(notifications).toHaveLength(2)
    expect(notifications.map(({ fields }) => fields)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipientId: owner,
          kind: 'input_required',
          actorName: 'Coder',
          sourceMessageId: 'message_1',
        }),
        expect.objectContaining({
          recipientId: 'user_2',
          kind: 'input_required',
          actorName: 'Coder',
          sourceMessageId: 'message_1',
        }),
      ]),
    )
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

    const result = await _suspendStep(ctx, {
      generation: 0,
      streamId: 'stream_1' as never,
    })

    expect(result).toBe('suspended')
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        state: expect.objectContaining({ phase: 'awaiting_approval' }),
      }),
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

  test('parks sub-agent approvals and notifies the parent session', async () => {
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
    docs.push({ _id: 'session_0', ownerId: owner } as never)
    const { ctx, patches, inserts } = fakeCtx({
      docs,
      membershipsBySession: {
        session_0: [{ _id: 'membership_0', userId: owner }],
      },
    })

    const result = await _suspendStep(ctx, {
      generation: 0,
      streamId: 'stream_1' as never,
    })

    expect(result).toBe('suspended')
    expect(patches.find(({ id }) => id === 'content_1')).toBeUndefined()
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        state: expect.objectContaining({ phase: 'awaiting_approval' }),
      }),
    })
    expect(inserts).toContainEqual({
      table: 'notifications',
      fields: expect.objectContaining({
        sessionId: 'session_0',
        recipientId: owner,
        kind: 'approval_required',
      }),
    })
  })
})
