import { api } from '@sb/convex/_generated/api'
import type { IntegrationSettingsArgs } from '@sb/convex/types'
import { updateDisabledSkills } from '@sb/core/skills/names'
import type { OptimisticLocalStore } from 'convex/browser'

/** Projects skill changes into every cached integration list until Convex confirms them. */
export function optimisticallyUpdateIntegrationSkills(
  store: OptimisticLocalStore,
  { integrationId, skill, ...patch }: IntegrationSettingsArgs,
) {
  for (const { args, value } of store.getAllQueries(api.integrations.list)) {
    if (!value) continue
    const next = value.map((row) => {
      if (row._id !== integrationId) return row
      return {
        ...row,
        ...patch,
        ...(skill && {
          disabledSkills: updateDisabledSkills(
            row.disabledSkills,
            skill.name,
            skill.enabled,
          ),
        }),
      }
    })
    store.setQuery(api.integrations.list, args, next)
  }
}
