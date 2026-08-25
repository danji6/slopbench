/* global self, caches, URL, Response */

/** Stores read actions until an authenticated page can persist them. */
const ACTION_CACHE = 'slopbench-notification-actions-v1'
const ACTION_PATH = '/__notification_actions__/'

// This worker has no fetch lifecycle, so updates are safe to activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Native notification clicks can arrive without any app tab running
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const notificationId = data.notificationId
  const sessionId = data.sessionId

  event.waitUntil(
    event.action === 'dismiss'
      ? markRead(notificationId)
      : showSession(notificationId, sessionId),
  )
})

/** Delivers a read action now or queues it for the next app startup. */
async function markRead(notificationId) {
  if (!notificationId) return
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  if (windows.length > 0) {
    for (const client of windows) {
      client.postMessage({
        type: 'slopbench:notification-action',
        action: 'read',
        notificationId,
      })
    }
    return
  }

  const cache = await caches.open(ACTION_CACHE)
  const url = new URL(
    `${ACTION_PATH}${encodeURIComponent(notificationId)}`,
    self.location.origin,
  )
  await cache.put(url, new Response('read'))
}

/** Marks the alert read, then focuses or opens its session. */
async function showSession(notificationId, sessionId) {
  if (!sessionId) return
  const destination = new URL(
    `/?id=${encodeURIComponent(sessionId)}`,
    self.location.origin,
  ).href
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  const client =
    windows.find((window) => window.focused) ||
    windows.find((window) => window.visibilityState === 'visible') ||
    windows[0]
  if (client) {
    client.postMessage({
      type: 'slopbench:notification-action',
      action: 'show',
      notificationId,
      sessionId,
    })
    return client.focus()
  }
  await markRead(notificationId)
  return self.clients.openWindow(destination)
}
