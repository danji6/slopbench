import {
  ConfirmDialog,
  Input,
  Label,
  SettingsCollapsible,
  Switch,
  TrashButton,
} from '@/components/ui'
import { generateId } from '@/lib/utils'
import {
  type ProviderAuth,
  providerDefinition,
  providerFeatures,
} from '@sb/core/provider-registry'
import type { ReasoningTier } from '@sb/core/types'
import { useState } from 'react'

import { ProviderExtraHeaders } from './provider-extra-headers'
import {
  ProviderApiKeyField,
  ProviderAuthField,
  ProviderBaseURLField,
  ProviderTypeField,
} from './provider-fields'
import { ProviderModelList } from './provider-model-list'
import type { ProviderOption } from './provider-types'
import type {
  ModelEntryFormValues,
  ProviderFormValues,
} from './settings-schema'

type ProviderCardProps = {
  provider: ProviderFormValues
  defaultOpen?: boolean
  providers?: ProviderOption[]
  typeError?: string
  baseURLError?: string
  onChange: (patch: Partial<ProviderFormValues>) => void
  onRemove: () => void
  saved?: boolean
  children?: React.ReactNode
}

export function ProviderCard({
  provider,
  defaultOpen = false,
  providers,
  typeError,
  baseURLError,
  onChange,
  onRemove,
  saved,
  children,
}: ProviderCardProps) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const [expandedModelIds, setExpandedModelIds] = useState<Set<string>>(() => new Set()) // prettier-ignore
  const [showKey, setShowKey] = useState(false)

  const features = providerFeatures(provider.id, provider.auth)
  const authentication = providerDefinition(provider.id).authentication
  const knownProvider = providers?.find((t) => t.value === provider.id)
  const isTypeCustom = !!provider.id && !knownProvider

  const [userSelectedOther, setUserSelectedOther] = useState(isTypeCustom)
  const [prevType, setPrevType] = useState(provider.id)
  if (prevType !== provider.id) {
    setPrevType(provider.id)
    if (knownProvider) setUserSelectedOther(false)
  }

  const showCustomInput = isTypeCustom || userSelectedOther

  const comboboxValue = knownProvider
    ? provider.id
    : showCustomInput
      ? '_other'
      : ''

  const providerLabel =
    provider.name || knownProvider?.label || provider.id || 'New connection'
  const requiresBaseURL = knownProvider?.requiresBaseURL ?? true

  function handleProviderChange(value: string) {
    if (value === '_other') {
      setUserSelectedOther(true)
      onChange({ id: '', auth: 'apiKey' })
    } else {
      setUserSelectedOther(false)
      onChange({ id: value || '', auth: 'apiKey' })
    }
  }

  function addModel() {
    const clientId = generateId()
    const reasoning = knownProvider?.defaultReasoning ?? {
      type: 'effort' as const,
      efforts: ['low', 'medium', 'high'] as ReasoningTier[],
    }

    onChange({
      models: [
        { id: '', contextWindow: 256_000, reasoning, _clientId: clientId },
        ...provider.models,
      ],
    })
    setExpandedModelIds((current) => new Set(current).add(clientId))
    setExpanded(true)
  }

  function updateModel(idx: number, patch: Partial<ModelEntryFormValues>) {
    onChange({
      models: provider.models.map((m, i) =>
        i === idx ? { ...m, ...patch } : m,
      ),
    })
  }

  function removeModel(idx: number) {
    const modelId = provider.models[idx]?._clientId
    if (modelId) {
      setExpandedModelIds((current) => {
        const next = new Set(current)
        next.delete(modelId)
        return next
      })
    }
    onChange({ models: provider.models.filter((_, i) => i !== idx) })
  }

  function setModelExpanded(modelId: string, isExpanded: boolean) {
    setExpandedModelIds((current) => {
      const next = new Set(current)
      if (isExpanded) next.add(modelId)
      else next.delete(modelId)
      return next
    })
  }

  return (
    <SettingsCollapsible
      open={expanded}
      onOpenChange={setExpanded}
      label={providerLabel}
      labelClassName={!provider.enabled ? 'text-muted-foreground' : undefined}
      actions={
        <ProviderCardActions
          enabled={provider.enabled}
          modelCount={provider.models.length}
          onToggleEnabled={(v) => onChange({ enabled: v })}
          onRemove={onRemove}
        />
      }
      contentClassName="gap-3.5"
      unmountOnClose
    >
      <Label className="text-sm">Connection name</Label>
      <Input
        value={provider.name ?? ''}
        placeholder="e.g. OpenAI"
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <fieldset disabled={saved} className="flex flex-col gap-2">
        <ProviderTypeField
          providers={providers}
          value={comboboxValue}
          showCustomInput={showCustomInput}
          providerId={provider.id}
          typeError={typeError}
          onChange={handleProviderChange}
          onCustomNameChange={(id) => onChange({ id })}
        />

        {Object.keys(authentication).length > 1 && (
          <ProviderAuthField
            methods={Object.keys(authentication) as ProviderAuth[]}
            value={provider.auth ?? 'apiKey'}
            onChange={(auth) =>
              onChange({
                auth,
                models: [],
                baseURL: undefined,
                extraHeaders: undefined,
                apiKey: undefined,
              })
            }
          />
        )}
      </fieldset>
      {!features.fixedEndpoint && (
        <>
          <ProviderApiKeyField
            value={provider.apiKey}
            hasKey={provider.hasKey}
            showKey={showKey}
            onToggleKey={() => setShowKey((v) => !v)}
            onChange={(apiKey) => onChange({ apiKey })}
          />

          <ProviderBaseURLField
            providerId={provider.id}
            isCustom={comboboxValue === '_other'}
            requiresBaseURL={requiresBaseURL}
            value={provider.baseURL}
            error={baseURLError}
            onChange={(baseURL) => onChange({ baseURL })}
          />

          <ProviderExtraHeaders
            editorId={provider._clientId ?? provider.id}
            value={provider.extraHeaders ?? ''}
            onChange={(value) => onChange({ extraHeaders: value || undefined })}
          />
        </>
      )}
      {children}
      <ProviderModelList
        catalogOnly={features.catalogOnly}
        models={provider.models}
        editorId={provider._clientId ?? provider.id}
        defaultReasoning={knownProvider?.defaultReasoning}
        binaryReasoningParameter={
          knownProvider?.binaryReasoningParameter ??
          providerFormBinaryParameter(provider.id)
        }
        expandedModelIds={expandedModelIds}
        onAdd={addModel}
        onUpdate={updateModel}
        onRemove={removeModel}
        onExpandedChange={setModelExpanded}
      />
    </SettingsCollapsible>
  )
}

type ProviderCardActionsProps = {
  enabled: boolean
  modelCount: number
  onToggleEnabled: (enabled: boolean) => void
  onRemove: () => void
  saved?: boolean
  children?: React.ReactNode
}

function ProviderCardActions({
  enabled,
  modelCount,
  onToggleEnabled,
  onRemove,
}: ProviderCardActionsProps) {
  return (
    <>
      <span className="text-muted-foreground text-sm">
        {modelCount} model{modelCount !== 1 ? 's' : ''}
      </span>
      <Switch
        size="sm"
        checked={enabled}
        onCheckedChange={onToggleEnabled}
        aria-label="Enable provider"
      />
      <ConfirmDialog
        variant="destructive"
        title="Remove provider?"
        description="This will remove the provider and all its models."
        confirmText="Remove"
        cancelText="Cancel"
        onConfirm={onRemove}
      >
        <TrashButton aria-label="Remove provider" />
      </ConfirmDialog>
    </>
  )
}

/** Keeps provider form defaults usable while newer metadata is loading. */
function providerFormBinaryParameter(providerId: string) {
  return providerId === 'ollama' ? 'think' : undefined
}
