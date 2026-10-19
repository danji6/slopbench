import type { NotificationWorkerAction } from '@sb/core/notification-actions'

const ACTION_CACHE = 'slopbench-notification-actions-v2'

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
  const failures: unknown[] = []
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    const action: unknown = await response?.json().catch(() => null)
    if (!isWorkerAction(action)) {
      await cache.delete(request)
      continue
    }
    try {
      await apply(action)
      await cache.delete(request)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length)
    throw new AggregateError(
      failures,
      'Some notification actions could not be applied',
    )
}

/** Clears a delivered action only after the server has handled it. */
export function acknowledgeWorkerAction(action: NotificationWorkerAction) {
  if (!action.requestId) return
  navigator.serviceWorker.controller?.postMessage({
    type: 'slopbench:notification-action-ack',
    requestId: action.requestId,
  })
}
