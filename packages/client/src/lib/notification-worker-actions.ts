import type { NotificationWorkerAction } from '@sb/core/notification-actions'

const ACTION_CACHE = 'slopbench-notification-actions-v2'
const LEGACY_CACHE = 'slopbench-notification-actions-v1'

export type ApplyWorkerAction = (
  action: NotificationWorkerAction,
) => Promise<void>

/** Accepts only known notification actions from the service worker. */
export function isWorkerAction(
  value: unknown,
): value is NotificationWorkerAction {
  if (!value || typeof value !== 'object') return false
  const action = value as NotificationWorkerAction
  return (
    action.type === 'slopbench:notification-action' &&
    typeof action.notificationId === 'string' &&
    ['read', 'show', 'allow', 'allow-session', 'deny'].includes(action.action)
  )
}

/** Applies durable clicks after authentication; failed actions remain retryable. */
export async function drainPendingWorkerActions(apply: ApplyWorkerAction) {
  if (!('caches' in window)) return
  const cache = await caches.open(ACTION_CACHE)
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    const action: unknown = await response?.json().catch(() => null)
    if (!isWorkerAction(action)) {
      await cache.delete(request)
      continue
    }
    await apply(action)
    await cache.delete(request)
  }
  // Old workers stored only read markers; never interpret them as approvals.
  const legacy = await caches.open(LEGACY_CACHE)
  for (const request of await legacy.keys()) {
    const marker = '/__notification_actions__/'
    const index = request.url.indexOf(marker)
    if (index !== -1) {
      await apply({
        type: 'slopbench:notification-action',
        action: 'read',
        notificationId: decodeURIComponent(
          request.url.slice(index + marker.length),
        ),
      })
    }
    await legacy.delete(request)
  }
}

/** Clears a delivered action only after the server has handled it. */
export function acknowledgeWorkerAction(action: NotificationWorkerAction) {
  if (!action.requestId) return
  navigator.serviceWorker.controller?.postMessage({
    type: 'slopbench:notification-action-ack',
    requestId: action.requestId,
  })
}
