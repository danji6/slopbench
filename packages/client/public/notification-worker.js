/* global self, caches, URL, Response */

const ACTION_CACHE = 'slopbench-notification-actions-v2'
const ACTION_PATH = '/__notification_actions__/'
const APPROVAL_ACTIONS = new Set(['allow', 'allow-session', 'deny'])

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Retain the selected action until an authenticated page acknowledges it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { notificationId, sessionId } = event.notification.data || {}
  if (!notificationId) return
  const action = event.action === 'dismiss' ? 'read' : event.action || 'show'
  if (action !== 'read' && action !== 'show' && !APPROVAL_ACTIONS.has(action))
    return
  event.waitUntil(
    deliverAction({
      type: 'slopbench:notification-action',
      action,
      notificationId,
      sessionId,
      requestId: `${notificationId}:${action}`,
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'slopbench:notification-action-ack') return
  const requestId = event.data.requestId
  if (typeof requestId !== 'string') return
  event.waitUntil(
    caches
      .open(ACTION_CACHE)
      .then((cache) => cache.delete(actionUrl(requestId))),
  )
})

function actionUrl(requestId) {
  return new URL(
    `${ACTION_PATH}${encodeURIComponent(requestId)}`,
    self.location.origin,
  )
}

/** Chooses one page so background approvals do not run in every tab. */
async function deliverAction(action) {
  const cache = await caches.open(ACTION_CACHE)
  await cache.put(
    actionUrl(action.requestId),
    new Response(JSON.stringify(action)),
  )
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  const client =
    windows.find((window) => window.focused) ||
    windows.find((window) => window.visibilityState === 'visible') ||
    windows[0]
  if (client) {
    client.postMessage(action)
    if (action.action === 'show') return client.focus()
    return
  }
  // Dismiss stays quiet; approval clicks open a page to authenticate and apply it.
  if (action.action === 'read' || !action.sessionId) return
  return self.clients.openWindow(
    new URL(
      `/?id=${encodeURIComponent(action.sessionId)}`,
      self.location.origin,
    ).href,
  )
}
