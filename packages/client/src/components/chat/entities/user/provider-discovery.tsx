import { Input, RippleButton } from '@/components/ui'
import { providerInput } from '@/lib/provider-settings'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { discoveredFields } from '@sb/core/discovered-model'
import type { DiscoveredModel } from '@sb/core/model-discovery'
import { providerFeatures } from '@sb/core/provider-registry'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'

import { AccountControls } from './providers/account-controls'
import type { ProviderFormValues } from './settings-schema'

type Props = {
  provider: ProviderFormValues
  onChange: (patch: Partial<ProviderFormValues>) => void
}

export function ProviderDiscovery({ provider, onChange }: Props) {
  const providerId = provider.connectionId as Id<'modelProviders'> | undefined

  const catalog = useQuery(
    api.providers.catalog,
    providerId ? { providerId } : 'skip',
  )
  const previewCatalog = useQuery(
    api.providers.previewCatalog,
    provider.previewId
      ? { previewId: provider.previewId as Id<'discoveryPreviews'> }
      : 'skip',
  )
  const saved = useQuery(
    api.providers.get,
    providerId ? { providerId } : 'skip',
  )

  const discover = useAction(api.actions.providerConnections.discover)
  const preview = useAction(api.actions.providerConnections.preview)
  const details = useAction(api.actions.providerConnections.details)
  const previewDetails = useAction(api.actions.providerConnections.previewDetails) // prettier-ignore

  const ensure = useMutation(api.providers.ensureConnection)

  const creating = useRef<Promise<Id<'modelProviders'>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(50)
  const features = providerFeatures(provider.id, provider.auth)

  const current = useRef(provider)
  useEffect(() => {
    current.current = provider
  }, [provider])

  function ensureConnection() {
    if (providerId) return Promise.resolve(providerId)
    if (!creating.current) {
      creating.current = ensure({
        key: provider.id,
        auth: provider.auth ?? 'apiKey',
        clientId: provider._clientId!,
      })
        .then((id) => {
          onChange({ connectionId: id, configRevision: 0 })
          return id
        })
        .finally(() => {
          creating.current = null
        })
    }
    return creating.current
  }

  async function refresh(manual = true) {
    if (busy) return
    setBusy(true)
    setFailure(undefined)
    const snapshot = current.current

    try {
      const draftNetwork =
        !saved ||
        provider.apiKey !== undefined ||
        (provider.baseURL || '') !== (saved.baseURL || '') ||
        (provider.extraHeaders || '') !== (saved.extraHeaders || '')

      if (!features.accountSignIn && draftNetwork) {
        const result = await preview({ ...providerInput(provider), providerId })
        // A request for an old draft cannot replace the current preview
        if (sameNetwork(snapshot, current.current))
          onChange({
            previewId: result.previewId,
            models: current.current.models.map((model) => {
              const discovered = result.models.find(
                (row) => row.id === model.id,
              )
              return {
                ...model,
                ...(discovered ? discoveredFields(discovered) : {}),
                available:
                  model.source === 'discovered'
                    ? !!discovered
                    : model.available,
              }
            }),
          })
      } else if (providerId) {
        const result = await discover({ providerId, force: true })
        if (manual && result.error) setFailure(result.error)
      }
    } catch {
      if (manual)
        setFailure(
          'Model discovery failed. Check the connection settings and retry.',
        )
    } finally {
      setBusy(false)
    }
  }

  const source = provider.previewId ? previewCatalog?.models : catalog?.models
  const choices = (source ?? []).filter(
    (model) => !provider.models.some((row) => row.id === model.id),
  )
  const filtered = choices.filter((model) =>
    `${model.label ?? ''} ${model.id}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )

  async function enable(model: DiscoveredModel) {
    let enriched = model

    if (features.modelDetails) {
      try {
        enriched = provider.previewId
          ? ((await previewDetails({
              ...providerInput(provider),
              providerId,
              previewId: provider.previewId as Id<'discoveryPreviews'>,
              modelId: model.id,
            })) ?? model)
          : providerId
            ? ((await details({ providerId, modelId: model.id })) ?? model)
            : model
      } catch {
        // Metadata is optional; the model remains selectable
      }
    }

    const latest = current.current
    if (
      !sameNetwork(provider, latest) ||
      latest.models.some((row) => row.id === model.id)
    ) {
      return
    }

    const models: ProviderFormValues['models'] = [
      ...latest.models,
      {
        id: model.id,
        ...discoveredFields(enriched),
        source: 'discovered',
        available: true,
        _clientId: crypto.randomUUID(),
      },
    ]
    current.current = { ...latest, models }
    onChange({ models })
  }

  return (
    <div className="flex flex-col gap-2">
      <AccountControls
        provider={provider.id}
        auth={provider.auth}
        providerId={providerId}
        ensureConnection={ensureConnection}
        onConnected={() => refresh(false)}
      />
      {features.discovery && (
        <>
          <RippleButton
            variant="input"
            size="sm"
            disabled={
              busy ||
              catalog?.refreshing ||
              (!providerId && features.accountSignIn)
            }
            onClick={() => void refresh()}
          >
            {busy || catalog?.refreshing ? 'Refreshing…' : 'Refresh models'}
          </RippleButton>
          {!!catalog?.refreshedAt && (
            <p className="text-muted-foreground text-xs">
              Last refreshed: {new Date(catalog.refreshedAt).toLocaleString()}
            </p>
          )}
          {failure && (
            <p role="alert" className="text-destructive text-sm">
              {failure} Cached models are preserved.
            </p>
          )}
          {!!choices.length && (
            <>
              <Input
                value={search}
                placeholder={`Search ${choices.length} discovered models…`}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setLimit(50)
                }}
              />
              <div className="flex max-h-64 flex-wrap gap-1 overflow-auto">
                {filtered.slice(0, limit).map((model) => (
                  <RippleButton
                    key={model.id}
                    aria-label={`Enable ${model.label ?? model.id}`}
                    variant="surface"
                    size="sm"
                    className="w-fit max-w-full justify-start"
                    onClick={() => void enable(model)}
                  >
                    {model.label ?? model.id}
                  </RippleButton>
                ))}
              </div>
              {filtered.length > limit && (
                <RippleButton
                  size="sm"
                  variant="stealth"
                  onClick={() => setLimit((value) => value + 50)}
                >
                  Load more models
                </RippleButton>
              )}
            </>
          )}
          {!!source && !choices.length && (
            <p className="text-muted-foreground text-xs">
              All discovered models are configured, or the provider returned an
              empty catalog.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function sameNetwork(a: ProviderFormValues, b: ProviderFormValues) {
  return (
    a.id === b.id &&
    a.auth === b.auth &&
    a.apiKey === b.apiKey &&
    a.baseURL === b.baseURL &&
    a.extraHeaders === b.extraHeaders
  )
}
