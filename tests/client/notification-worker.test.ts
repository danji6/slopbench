/// <reference types="bun-types" />
import { describe, expect, mock, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

type WorkerEvent = {
  action: string
  notification: { close: () => void; data: Record<string, string> }
  waitUntil: (promise: Promise<unknown>) => void
}

/** Loads the public worker with browser APIs replaced by focused test doubles. */
async function loadWorker(windows: object[]) {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const openWindow = mock(async () => undefined)
  const source = await Bun.file(
    new URL(
      '../../packages/client/public/notification-worker.js',
      import.meta.url,
    ),
  ).text()
  const self = {
    location: { origin: 'https://example.test' },
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) =>
      listeners.set(type, listener),
    clients: {
      matchAll: mock(async () => windows),
      openWindow,
      claim: mock(async () => undefined),
    },
    skipWaiting: mock(async () => undefined),
  }
  const caches = {
    open: mock(async () => ({ put: mock(async () => undefined) })),
  }
  runInNewContext(source, { self, caches, URL, Response })
  return { listeners, openWindow }
}

describe('notification service worker', () => {
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
    })
    expect(focus).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })
})
