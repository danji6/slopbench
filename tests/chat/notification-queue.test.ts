import {
  acknowledge,
  pendingPage,
  settleRequest,
  settleStream,
  summary,
} from '@sb/convex/model/notificationRequests'
import {
  clearRead,
  discardSession,
  markAllRead,
  markRead,
  markSessionRead,
  notifyUserMessage,
} from '@sb/convex/model/notifications'
import { describe, expect, test } from 'bun:test'

import { type Row, fakeCtx } from '../setup/notifications'

const request = {
  streamId: 'stream',
  messageId: 'message',
  contentId: 'content',
  toolCallId: 'call',
}
function notification(index: number, recipientId = 'user_1'): Row {
  return {
    _id: `notification_${recipientId}_${index}`,
    _creationTime: index,
    recipientId,
    sessionId: 'session',
    sessionTitle: 'Queue',
    actorName: 'Ada',
    kind: 'input_required',
    status: 'unread',
    attention: true,
    requestState: 'pending',
    request: { ...request, toolCallId: `call_${index}` },
  }
}

describe('durable notification queue', () => {
  test('pending requests survive read, discard, clear and ordinary retention overflow', async () => {
    const notifications = Array.from({ length: 125 }, (_, index) =>
      notification(index),
    )
    const { ctx, rows } = fakeCtx({
      notifications,
      sessions: [{ _id: 'session', _creationTime: 0 }],
      userSessions: [
        {
          _id: 'member',
          _creationTime: 0,
          sessionId: 'session',
          userId: 'user_1',
        },
      ],
    })
    for (let index = 0; index < 105; index++)
      await notifyUserMessage(ctx, {
        sessionId: 'session' as never,
        senderId: 'other' as never,
        actorName: 'Other',
        preview: 'Activity',
        sourceMessageId: 'message' as never,
      })
    expect((await summary(ctx)).unreadCount).toBe(225)
    await markRead(ctx, { notificationId: notifications[0]._id as never })
    await markAllRead(ctx)
    await markSessionRead(ctx, { sessionId: 'session' as never })
    await discardSession(ctx, { sessionId: 'session' as never })
    await clearRead(ctx)
    expect(rows('notifications')).toHaveLength(125)
    expect(
      rows('notifications').every(
        (row) => row.status === 'unread' && row.requestState === 'pending',
      ),
    ).toBe(true)
  })

  test('pagination reaches every request oldest first, while summary returns newest candidates', async () => {
    const { ctx } = fakeCtx({
      notifications: Array.from({ length: 80 }, (_, index) =>
        notification(index),
      ).reverse(),
    })
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const result = await pendingPage(ctx, {
        state: 'pending',
        paginationOpts: { numItems: 25, cursor },
      })
      ids.push(...result.page.map((row) => row._id))
      if (result.isDone) break
      cursor = result.continueCursor
    } while (cursor)
    expect(ids).toEqual(
      Array.from({ length: 80 }, (_, index) => `notification_user_1_${index}`),
    )
    const result = await summary(ctx)
    expect(result.pendingCount).toBe(80)
    expect(result.unreadCount).toBe(80)
    expect(String(result.recent[0]._id)).toBe('notification_user_1_79')
  })

  test('settling one invocation resolves every recipient without touching a replacement', async () => {
    const first = notification(1)
    const other = notification(1, 'user_2')
    const replacement = {
      ...notification(2),
      request: { ...(first.request as object), contentId: 'replacement' },
    }
    const { ctx, rows } = fakeCtx({
      notifications: [first, other, replacement],
    })
    await settleRequest(ctx, { ...request, toolCallId: 'call_1' } as never)
    await settleRequest(ctx, { ...request, toolCallId: 'call_1' } as never)
    expect(rows('notifications').map((row) => row.requestState)).toEqual([
      'handled',
      'handled',
      'pending',
    ])
    expect(rows('notifications')[2].attention).toBe(true)
  })

  test('expired requests remain protected until explicit acknowledgement', async () => {
    const { ctx, rows } = fakeCtx({ notifications: [notification(1)] })
    await settleStream(ctx, 'stream' as never, 'expired')
    await settleStream(ctx, 'stream' as never, 'unavailable')
    await markAllRead(ctx)
    await discardSession(ctx, { sessionId: 'session' as never })
    await clearRead(ctx)
    expect(rows('notifications')[0]).toMatchObject({
      requestState: 'expired',
      attention: true,
      status: 'unread',
    })
    expect((await summary(ctx)).pendingCount).toBe(0)
    expect((await summary(ctx)).unreadCount).toBe(1)
    await acknowledge(ctx, { notificationId: 'notification_user_1_1' as never })
    expect((await summary(ctx)).unreadCount).toBe(0)
    await clearRead(ctx)
    expect(rows('notifications')).toHaveLength(0)
  })

  test('acknowledgement enforces ownership and cannot dismiss pending requests', async () => {
    const { ctx, rows } = fakeCtx({
      notifications: [notification(1), notification(2, 'user_2')],
    })
    await acknowledge(ctx, { notificationId: 'notification_user_1_1' as never })
    expect(rows('notifications')[0].attention).toBe(true)
    await expect(
      acknowledge(ctx, { notificationId: 'notification_user_2_2' as never }),
    ).rejects.toThrow('Not found')
  })
})
