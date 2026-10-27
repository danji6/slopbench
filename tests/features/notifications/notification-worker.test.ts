/// <reference types="bun-types" />
import { describe, expect, mock, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

type WorkerEvent = {
  action: string
  notification: { close: () => void; data: Record<string, string> }
  waitUntil: (promise: Promise<unknown>) => void
}

type WorkerMessageEvent = { data: unknown; waitUntil: WorkerEvent['waitUntil'] }
type WorkerListener = (event: WorkerEvent | WorkerMessageEvent) => void

/** Loads the public worker with browser APIs replaced by focused test doubles. */
async function loadWorker(windows: object[]) {
  const listeners = new Map<string, WorkerListener>()
  const openWindow = mock(async () => undefined)
  const source = await Bun.file(
    new URL(
      import.meta.resolve('~/packages/client/public/notification-worker.js'),
    ),
  ).text()
  const self = {
    location: { origin: 'https://example.test' },
    addEventListener: (type: string, listener: WorkerListener) =>
      listeners.set(type, listener),
    clients: {
      matchAll: mock(async () => windows),
      openWindow,
      claim: mock(async () => undefined),
    },
    skipWaiting: mock(async () => undefined),
  }
  const stored = new Map<string, Response>()
  const cache = {
    put: mock(async (url: URL, response: Response) => {
      stored.set(url.href, response)
    }),
    delete: mock(async (url: URL) => stored.delete(url.href)),
  }
  const caches = { open: mock(async () => cache) }
  runInNewContext(source, { self, caches, URL, Response })
  return { listeners, openWindow, stored }
}

describe('notification service worker', () => {
  test.each(['allow', 'allow-session', 'deny'])(
    'delivers %s to one tab without focusing it and keeps the action until acknowledged',
    async (action) => {
      const postMessage = mock(() => undefined)
      const otherPost = mock(() => undefined)
      const focus = mock(async () => undefined)
      const { listeners, stored } = await loadWorker([
        { focused: true, postMessage, focus },
        { focused: false, postMessage: otherPost, focus },
      ])
      let pending: Promise<unknown> | undefined
      const waitUntil = (promise: Promise<unknown>) => {
        pending = promise
      }
      listeners.get('notificationclick')?.({
        action,
        notification: {
          close: mock(() => undefined),
          data: { notificationId: 'n', sessionId: 's' },
        },
        waitUntil,
      })
      await pending
      expect(postMessage).toHaveBeenCalledTimes(1)
      expect(otherPost).not.toHaveBeenCalled()
      expect(focus).not.toHaveBeenCalled()
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action, notificationId: 'n' }),
      )
      expect(stored.size).toBe(1)
      expect(await [...stored.values()][0].clone().json()).toMatchObject({
        action,
      })
      listeners.get('message')?.({
        data: {
          type: 'slopbench:notification-action-ack',
          requestId: `n:${action}`,
        },
        waitUntil,
      })
      await pending
      expect(stored.size).toBe(0)
    },
  )

  test('opens a page and preserves the selected session action when no tab exists', async () => {
    const { listeners, stored, openWindow } = await loadWorker([])
    let pending: Promise<unknown> | undefined
    listeners.get('notificationclick')?.({
      action: 'allow-session',
      notification: {
        close: mock(() => undefined),
        data: { notificationId: 'n', sessionId: 's' },
      },
      waitUntil: (promise) => {
        pending = promise
      },
    })
    await pending
    expect(openWindow).toHaveBeenCalledWith('https://example.test/?id=s')
    expect(await [...stored.values()][0].json()).toMatchObject({
      action: 'allow-session',
      notificationId: 'n',
    })
  })

  test('Dismiss queues only a read action without opening a page', async () => {
    const { listeners, stored, openWindow } = await loadWorker([])
    let pending: Promise<unknown> | undefined
    listeners.get('notificationclick')?.({
      action: 'dismiss',
      notification: {
        close: mock(() => undefined),
        data: { notificationId: 'n', sessionId: 's' },
      },
      waitUntil: (promise) => {
        pending = promise
      },
    })
    await pending
    expect(openWindow).not.toHaveBeenCalled()
    expect(await [...stored.values()][0].json()).toMatchObject({
      action: 'read',
    })
  })

  test('routes a default click through an existing page without reloading it', async () => {
    const postMessage = mock(() => undefined)
    const focus = mock(async () => undefined)
    const navigate = mock(async () => undefined)
    const { listeners, openWindow } = await loadWorker([
      {
        focused: false,
        visibilityState: 'hidden',
        postMessage,
        focus,
        navigate,
      },
    ])
    let pending: Promise<unknown> | undefined

    listeners.get('notificationclick')?.({
      action: '',
      notification: {
        close: mock(() => undefined),
        data: { notificationId: 'notification_1', sessionId: 'session_1' },
      },
      waitUntil: (promise) => {
        pending = promise
      },
    })
    await pending

    expect(postMessage).toHaveBeenCalledWith({
      type: 'slopbench:notification-action',
      action: 'show',
      notificationId: 'notification_1',
      sessionId: 'session_1',
      requestId: 'notification_1:show',
    })
    expect(focus).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })
})
