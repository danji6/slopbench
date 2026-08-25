/// <reference types="bun-types" />
import { notificationBody } from '@/lib/chat/notification-ui'
import {
  notificationBadgeLabel,
  notificationDocumentTitle,
} from '@/lib/notification-favicon'
import { chooseNotificationSurface } from '@/lib/notification-presence'
import { describe, expect, test } from 'bun:test'

const item = {
  actorName: 'Ada',
  preview: 'A concise answer',
}

describe('notification presentation', () => {
  test('uses previews for messages and completed turns', () => {
    expect(notificationBody({ ...item, kind: 'user_message' } as never)).toBe(
      'A concise answer',
    )
    expect(notificationBody({ ...item, kind: 'turn_completed' } as never)).toBe(
      'A concise answer',
    )
  })

  test('uses the required approval and error copy', () => {
    expect(
      notificationBody({ ...item, kind: 'approval_required' } as never),
    ).toBe('Ada needs your attention')
    expect(notificationBody({ ...item, kind: 'turn_error' } as never)).toBe(
      "Ada's turn ended with an error",
    )
  })
})

describe('tab badge labels', () => {
  test('restores the base title at zero', () => {
    expect(notificationBadgeLabel(0)).toBe('')
    expect(notificationDocumentTitle(0)).toBe('Chat')
  })

  test('shows single digits and clamps the favicon at 9+', () => {
    expect(notificationBadgeLabel(7)).toBe('7')
    expect(notificationBadgeLabel(10)).toBe('9+')
    expect(notificationDocumentTitle(42)).toBe('(42) Chat')
  })
})

describe('notification tab arbitration', () => {
  const background = {
    tabId: 'background',
    startedAt: 1,
    focused: false,
    sessionId: 'session_1',
  }

  test('a focused matching session suppresses every surface', () => {
    expect(
      chooseNotificationSurface(
        [
          background,
          {
            tabId: 'focused',
            startedAt: 2,
            focused: true,
            sessionId: 'session_2',
          },
        ],
        'background',
        'session_2',
      ),
    ).toBe('discard')
  })

  test('only the focused tab owns an in-app toast', () => {
    const peers = [
      background,
      {
        tabId: 'focused',
        startedAt: 2,
        focused: true,
        sessionId: 'session_1',
      },
    ]
    expect(chooseNotificationSurface(peers, 'focused', 'session_2')).toBe(
      'toast',
    )
    expect(chooseNotificationSurface(peers, 'background', 'session_2')).toBe(
      'none',
    )
  })

  test('the oldest background tab owns the desktop alert', () => {
    const peers = [
      background,
      {
        tabId: 'newer',
        startedAt: 2,
        focused: false,
        sessionId: null,
      },
    ]
    expect(chooseNotificationSurface(peers, 'background', 'session_2')).toBe(
      'desktop',
    )
    expect(chooseNotificationSurface(peers, 'newer', 'session_2')).toBe('none')
  })
})
