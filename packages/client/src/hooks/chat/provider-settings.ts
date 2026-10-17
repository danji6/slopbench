import type { SettingsFormValues } from '@/components/chat/entities/user/settings-schema'
import { providerForm } from '@/lib/provider-settings'
import type { ModelProviderView } from '@sb/convex/model/providers'
import { useEffect } from 'react'
import type { UseFormReturn } from 'react-hook-form'

/** Merges newly authenticated identities and refreshed metadata without replacing edits. */
export function useProviderSettingsSync(
  form: UseFormReturn<SettingsFormValues>,
  connections?: ModelProviderView[],
) {
  useEffect(() => {
    if (!connections) return
    const current = form.getValues('providers')

    const removed = new Set(
      form.getValues('removedProviders')?.map((row) => row.providerId),
    )

    const merged = current.map((draft) => {
      const saved = connections.find(
        (row) =>
          row._id === draft.connectionId ||
          (!!row.identityKey && row.identityKey === draft._clientId),
      )
      if (!saved) return draft
      return {
        ...draft,
        connectionId: saved._id,
        configRevision: draft.configRevision ?? saved.configRevision,
        hasKey: saved.hasKey,
        models: draft.previewId
          ? draft.models
          : draft.models.map((model) => {
              const remote = saved.models.find((row) => row.id === model.id)
              if (!remote) return model
              return {
                ...model,
                discovered: remote.discovered,
                available:
                  model.source === 'discovered'
                    ? remote.available
                    : model.available,
              }
            }),
      }
    })

    for (const saved of connections) {
      if (removed.has(saved._id)) continue
      const alreadyPresent = merged.some(
        (row) =>
          row.connectionId === saved._id ||
          (!!saved.identityKey && row._clientId === saved.identityKey),
      )
      if (!alreadyPresent) merged.push(providerForm(saved))
    }

    form.setValue('providers', merged, { shouldDirty: false })
  }, [connections, form])
}
