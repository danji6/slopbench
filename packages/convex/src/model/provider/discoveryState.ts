import { DISCOVERY_STALE_MS } from '@sb/core/model-discovery'

import type { ProviderDiscovery } from '../../types'

const LEASE_MS = 120_000

/** Reports whether an existing refresh still holds its lease. */
export function discoveryRefreshing(
  state?: ProviderDiscovery,
  now = Date.now(),
) {
  return !!state?.startedAt && now - state.startedAt < LEASE_MS
}

/** Applies refresh lease, rate limit, retry, cooldown, and freshness policies. */
export function canBeginDiscovery(
  state: ProviderDiscovery | undefined,
  force: boolean,
  now = Date.now(),
) {
  if (discoveryRefreshing(state, now)) return false
  if (state?.rateLimitedUntil && state.rateLimitedUntil > now) return false
  if (!force && state?.retryAt && state.retryAt > now) return false
  if (!force && state?.blocked) return false

  const cooldown = force ? 10_000 : 60_000
  if (state?.attemptedAt && now - state.attemptedAt < cooldown) return false
  const fresh =
    state?.refreshedAt && now - state.refreshedAt < DISCOVERY_STALE_MS
  return force || !fresh
}

/** Clears a refresh attempt while preserving its last completed catalog. */
export function cancelDiscovery(state?: ProviderDiscovery): ProviderDiscovery {
  return { ...state, attempt: undefined, startedAt: undefined }
}

/** Publishes a successful generation and clears failures and active work. */
export function completeDiscovery(
  generation: string,
  previous?: ProviderDiscovery,
): ProviderDiscovery {
  return {
    generation,
    refreshedAt: Date.now(),
    attemptedAt: previous?.attemptedAt,
  }
}
