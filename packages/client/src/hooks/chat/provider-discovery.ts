import { api } from '@sb/convex/_generated/api'
import { providerFeatures } from '@sb/core/provider-registry'
import { useAction, useQuery } from 'convex/react'
import { useEffect } from 'react'

const checked = new Map<string, number>()

/** Shared across picker/settings consumers; server leases also coordinate tabs. */
export function useProviderDiscoveryCoordinator(active: boolean) {
  const connections = useQuery(api.providers.list, active ? {} : 'skip')
  const discover = useAction(api.actions.providerConnections.discover)

  useEffect(() => {
    if (!active) return
    for (const row of connections ?? []) {
      if (!row.enabled || !providerFeatures(row.id, row.auth).discovery)
        continue
      const key = `${row._id}:${row.configRevision}`
      if (Date.now() - (checked.get(key) ?? 0) < 60_000) continue
      checked.set(key, Date.now())
      void discover({ providerId: row._id }).catch(() => {})
    }
  }, [active, connections, discover])
}
