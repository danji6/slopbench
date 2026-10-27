import type { Doc } from '@sb/convex/_generated/dataModel'
import { withApprovalActions } from '@sb/convex/model/notificationApprovals'
import { notifyQuestions } from '@sb/convex/model/notifications'
import {
  notifyToolApprovals,
  respondApproval,
} from '@sb/convex/model/notifications'
import { approvalSummary } from '@sb/core/approval-presentation'
import { ASK_TOOL_NAME } from '@sb/core/const'
import { describe, expect, test } from 'bun:test'
import { fakeCtx } from '~/tests/setup/subagents'

const call = (toolCallId: string, type = 'tool-shell') => ({
  type,
  toolCallId,
  state: 'approval-requested',
  input: {
    command: 'git push origin main',
    description: 'Push changes to the main branch',
    path: 'src/file.ts',
  },
  approval: { id: `approval_${toolCallId}` },
})

function setup(child = false) {
  const session = { _id: 'root', ownerId: 'user_1', title: 'Release' }
  const target = child
    ? { ...session, _id: 'child', parent: { sessionId: 'root' } }
    : session
  const stream = {
    _id: 'stream',
    sessionId: target._id,
    agentId: 'agent',
    generation: 0,
    command: { kind: 'invoke' },
    leaseExpiresAt: Date.now() + 60_000,
    state: {
      phase: 'awaiting_approval',
      processingMessageId: 'message',
      processingContentId: 'content',
    },
  }
  const notification = {
    _id: 'notification',
    _creationTime: 1,
    recipientId: 'user_1',
    sessionId: 'root',
    actorName: 'Ada',
    kind: 'approval_required',
    status: 'unread',
    sessionTitle: 'Release',
    requestState: 'pending',
    attention: true,
    request: {
      streamId: 'stream',
      messageId: 'message',
      contentId: 'content',
      toolCallId: 'first',
    },
    approval: {
      streamId: 'stream',
      messageId: 'message',
      contentId: 'content',
      toolCallId: 'first',
      approvalId: 'approval_first',
    },
  } as Doc<'notifications'>
  const content = {
    _id: 'content',
    messageId: 'message',
    segmentIndex: 0,
    version: 1,
    parts: [call('first'), call('second')],
  }
  const state = { _id: 'session_state', sessionId: 'root', toolApprovals: {} }
  const fake = fakeCtx({
    docs: [
      session,
      ...(child ? [target] : []),
      stream,
      notification,
      content,
      { _id: 'message', selectedVersion: 1 },
      { _id: 'agent', name: 'Ada' },
      state,
    ],
    streamsBySession: { [target._id]: [stream] },
    membershipsBySession: {
      root: [
        { _id: 'membership', userId: 'user_1' },
        { _id: 'member_2', userId: 'user_2' },
      ],
    },
    sessionStates: [state],
  })
  return { ...fake, stream, notification, content, target, state }
}

describe('approval notification content and delivery', () => {
  test('uses descriptions for shell and paths for predictable file tools', () => {
    expect(approvalSummary('shell', call('shell').input)).toBe(
      'Push changes to the main branch',
    )
    expect(
      approvalSummary('write_file', {
        path: 'src/file.ts',
        content: 'private contents',
      }),
    ).toBe('write_file: src/file.ts')
  })

  test.each([false, true])(
    'fans out one exact request per tool, routed to the root (child: %s)',
    async (child) => {
      const { ctx, stream, inserts } = setup(child)
      await notifyToolApprovals(ctx, stream as never, 'root' as never)
      const notifications = inserts.filter(
        (row) => row.table === 'notifications',
      )
      expect(notifications).toHaveLength(3)
      expect(notifications[0].fields).toMatchObject({
        sessionId: 'root',
        preview: 'Push changes to the main branch',
        approval: { toolCallId: 'first', approvalId: 'approval_first' },
      })
      expect(notifications[2].fields).toMatchObject({
        approval: { toolCallId: 'second' },
      })
    },
  )
})

describe('approval notification responses', () => {
  test.each([false, true])(
    'session approval changes only the selected call and remembers the shared pattern (child: %s)',
    async (child) => {
      const { ctx, notification, content, state } = setup(child)
      const item = await withApprovalActions(ctx, notification)
      expect(item.approvalActions.map((action) => action.label)).toEqual([
        'Allow',
        'Allow for this session',
        'Deny',
      ])
      expect(
        await respondApproval(ctx, {
          notificationId: notification._id,
          action: 'allow-session',
        }),
      ).toBe('applied')
      expect(content.parts).toMatchObject([
        { state: 'approval-responded', approval: { approved: true } },
        { state: 'approval-requested' },
      ])
      expect(state.toolApprovals).toMatchObject({ shell: ['git push'] })
      expect(notification.status).toBe('read')
      expect(
        (await withApprovalActions(ctx, notification)).approvalActions,
      ).toEqual([])
      expect(
        await respondApproval(ctx, {
          notificationId: notification._id,
          action: 'deny',
        }),
      ).toBe('stale')
      expect(content.parts[0].approval).toMatchObject({ approved: true })
    },
  )

  test('Allow does not remember and Deny only rejects the selected call', async () => {
    const first = setup()
    await respondApproval(first.ctx, {
      notificationId: first.notification._id,
      action: 'allow',
    })
    expect(first.state.toolApprovals).toEqual({})
    const second = setup()
    await respondApproval(second.ctx, {
      notificationId: second.notification._id,
      action: 'deny',
    })
    expect(second.content.parts).toMatchObject([
      { state: 'output-denied', approval: { approved: false } },
      { state: 'approval-requested' },
    ])
  })

  test.each(['forbidden', 'analysis'] as const)(
    'does not offer or accept session permission for a %s hold',
    async (hold) => {
      const { ctx, notification, content } = setup()
      Object.assign(content.parts[0], { approvalPathStatus: hold })
      expect(
        (await withApprovalActions(ctx, notification)).approvalActions.map(
          (option) => option.action,
        ),
      ).toEqual(['allow', 'deny'])
      await expect(
        respondApproval(ctx, {
          notificationId: notification._id,
          action: 'allow-session',
        }),
      ).rejects.toThrow('no longer available')
      expect(content.parts[0].state).toBe('approval-requested')
    },
  )

  test('plan holds omit session permission and path holds remember paths', async () => {
    const planned = setup()
    Object.assign(planned.target, { mode: 'plan' })
    expect(
      (
        await withApprovalActions(planned.ctx, planned.notification)
      ).approvalActions.map((option) => option.action),
    ).toEqual(['allow', 'deny'])
    const paths = setup()
    Object.assign(paths.content.parts[0], {
      approvalPathStatus: 'paths',
      approvalPaths: ['outside/file'],
    })
    expect(
      (await withApprovalActions(paths.ctx, paths.notification))
        .approvalActions[1],
    ).toMatchObject({
      action: 'allow-session',
      description: expect.stringContaining('paths'),
    })
  })

  test.each(['messageId', 'contentId', 'approvalId', 'streamId'] as const)(
    'a stale %s never approves a replacement request',
    async (field) => {
      const { ctx, notification, content } = setup()
      Object.assign(notification.approval!, { [field]: 'old' })
      expect(
        await respondApproval(ctx, {
          notificationId: notification._id,
          action: 'allow',
        }),
      ).toBe('stale')
      expect(content.parts[0].state).toBe('approval-requested')
    },
  )

  test('expired requests have no approval buttons', async () => {
    const { ctx, notification, stream } = setup()
    stream.leaseExpiresAt = Date.now() - 1
    expect(
      (await withApprovalActions(ctx, notification)).approvalActions,
    ).toEqual([])
  })

  test('marking an approval read does not answer it or remove pending inbox controls', async () => {
    const { ctx, notification } = setup()
    notification.status = 'read'
    expect((await withApprovalActions(ctx, notification)).approvalPending).toBe(
      true,
    )
    expect(
      await respondApproval(ctx, {
        notificationId: notification._id,
        action: 'allow',
      }),
    ).toBe('applied')
  })

  test('enforces recipient ownership and the existing admin role', async () => {
    const { ctx, notification, content } = setup()
    notification.recipientId = 'another_user' as never
    await expect(
      respondApproval(ctx, {
        notificationId: notification._id,
        action: 'allow',
      }),
    ).rejects.toThrow('Not found')
    notification.recipientId = 'user_1' as never
    Object.assign(ctx, { role: 'user' })
    expect(
      (await withApprovalActions(ctx, notification)).approvalActions,
    ).toEqual([])
    await expect(
      respondApproval(ctx, {
        notificationId: notification._id,
        action: 'allow',
      }),
    ).rejects.toThrow('Forbidden')
    expect(content.parts[0].state).toBe('approval-requested')
  })

  test('keeps specialized plan controls and their stop behavior', async () => {
    const { ctx, notification, content, stream } = setup()
    content.parts[0] = call('first', 'tool-exit_plan_mode')
    expect(
      (await withApprovalActions(ctx, notification)).approvalActions.map(
        (option) => option.label,
      ),
    ).toEqual(['Approve plan', 'Keep planning'])
    await respondApproval(ctx, {
      notificationId: notification._id,
      action: 'deny',
    })
    expect(stream.state.phase).toBe('stopping')
  })
})

describe('request identity', () => {
  test('repeated parking deduplicates per recipient and tool invocation', async () => {
    const { ctx, stream, inserts } = setup()
    await notifyToolApprovals(ctx, stream as never, 'root' as never)
    const count = inserts.length
    await notifyToolApprovals(ctx, stream as never, 'root' as never)
    expect(inserts.length).toBe(count)
  })

  test('question notifications preserve one invocation containing multiple questions', async () => {
    const { ctx, stream, content, inserts } = setup()
    Object.assign(stream.state, { phase: 'awaiting_input' })
    Object.assign(content, {
      parts: [
        {
          type: `tool-${ASK_TOOL_NAME}`,
          toolCallId: 'ask',
          state: 'input-available',
          input: {
            questions: [
              { question: 'Which branch?' },
              { question: 'Which target?' },
            ],
          },
        },
      ],
    })
    await notifyQuestions(ctx, stream as never, 'root' as never)
    await notifyQuestions(ctx, stream as never, 'root' as never)
    const rows = inserts.filter((row) => row.table === 'notifications')
    expect(rows).toHaveLength(2)
    expect(rows[0].fields).toMatchObject({
      kind: 'input_required',
      preview: 'Which branch? (2 questions)',
      requestState: 'pending',
      attention: true,
      request: { toolCallId: 'ask', contentId: 'content' },
    })
  })
})
