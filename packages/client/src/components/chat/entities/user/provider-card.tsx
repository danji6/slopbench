import { md } from '@/components/markdown'
import {
  Accordion,
  Collapsible,
  Combobox,
  ConfirmDialog,
  HelpPopoverLabel,
  Input,
  Label,
  RippleButton,
  Switch,
  useCollapsible,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ReasoningTier } from '@sb/core/types'
import { EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import { ModelRow } from './model-entry'
import { ProviderExtraHeaders } from './provider-extra-headers'
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
}

export function ProviderCard({
  provider,
  defaultOpen = false,
  providers,
  typeError,
  baseURLError,
  onChange,
  onRemove,
}: ProviderCardProps) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const [showKey, setShowKey] = useState(false)

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

  const providerLabel = knownProvider?.label ?? (provider.id || 'New Provider')
  const requiresBaseURL = knownProvider?.requiresBaseURL ?? true

  function handleProviderChange(value: string) {
    if (value === '_other') {
      setUserSelectedOther(true)
      onChange({ id: '' })
    } else {
      setUserSelectedOther(false)
      onChange({ id: value || '' })
    }
  }

  function addModel() {
    const reasoning = knownProvider?.defaultReasoning ?? {
      type: 'effort' as const,
      efforts: ['low', 'medium', 'high'] as ReasoningTier[],
    }
    onChange({ models: [{ id: '', reasoning }, ...provider.models] })
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
    onChange({ models: provider.models.filter((_, i) => i !== idx) })
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="bg-m3-surface-container-low border-input w-full rounded-2xl border"
    >
      <ProviderCardHeader
        label={providerLabel}
        enabled={provider.enabled}
        modelCount={provider.models.length}
        onToggleEnabled={(v) => onChange({ enabled: v })}
        onRemove={onRemove}
      />

      <Collapsible.Content className="gap-3.5">
        <ProviderTypeField
          providers={providers}
          value={comboboxValue}
          showCustomInput={showCustomInput}
          providerId={provider.id}
          typeError={typeError}
          onChange={handleProviderChange}
          onCustomNameChange={(id) => onChange({ id })}
        />

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

        <ProviderModelList
          models={provider.models}
          editorId={provider._clientId ?? provider.id}
          defaultReasoning={knownProvider?.defaultReasoning}
          binaryReasoningParameter={
            knownProvider?.binaryReasoningParameter ??
            providerFormBinaryParameter(provider.id)
          }
          onAdd={addModel}
          onUpdate={updateModel}
          onRemove={removeModel}
        />
      </Collapsible.Content>
    </Collapsible>
  )
}

type ProviderCardHeaderProps = {
  label: string
  enabled: boolean
  modelCount: number
  onToggleEnabled: (enabled: boolean) => void
  onRemove: () => void
}

function ProviderCardHeader({
  label,
  enabled,
  modelCount,
  onToggleEnabled,
  onRemove,
}: ProviderCardHeaderProps) {
  return (
    <div className="flex items-center gap-4 px-2 py-1">
      <ExpandToggle />
      <span
        className={cn(
          'text-md flex-1 font-semibold',
          !enabled && 'text-muted-foreground',
        )}
      >
        {label}
      </span>
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
        <RippleButton
          variant="stealth"
          size="icon"
          aria-label="Remove provider"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon />
        </RippleButton>
      </ConfirmDialog>
    </div>
  )
}

type ProviderTypeFieldProps = {
  providers?: ProviderOption[]
  value: string
  showCustomInput: boolean
  providerId: string
  typeError?: string
  onChange: (value: string) => void
  onCustomNameChange: (id: string) => void
}

function ProviderTypeField({
  providers,
  value,
  showCustomInput,
  providerId,
  typeError,
  onChange,
  onCustomNameChange,
}: ProviderTypeFieldProps) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-sm">Provider</Label>
        <Combobox value={value} onValueChange={onChange} noDeselect>
          <Combobox.Trigger
            variant="input"
            className="w-full max-w-64 justify-between"
            disabled={!providers}
          >
            <Combobox.DisplayValue placeholder="Select provider…">
              {(val) => {
                if (!val) return undefined
                if (val === '_other') return 'Other…'
                if (!providers) return 'Loading…'
                return providers.find((t) => t.value === val)?.label ?? val
              }}
            </Combobox.DisplayValue>
          </Combobox.Trigger>
          <Combobox.Content align="start" className="w-56">
            {providers && (
              <Combobox.List>
                {providers.map((t) => (
                  <Combobox.Item key={t.value} value={t.value}>
                    {t.label}
                  </Combobox.Item>
                ))}
                <Combobox.Item value="_other">Other…</Combobox.Item>
              </Combobox.List>
            )}
          </Combobox.Content>
        </Combobox>
      </div>

      {showCustomInput && (
        <div className="flex flex-col gap-1">
          <Label className="text-muted-foreground text-sm">Provider name</Label>
          <Input
            className="font-mono text-sm"
            placeholder="e.g. SomeProvider"
            value={providerId}
            onChange={(e) => onCustomNameChange(e.target.value)}
          />
        </div>
      )}

      {typeError && <p className="text-destructive text-sm">{typeError}</p>}
    </>
  )
}

type ProviderApiKeyFieldProps = {
  value?: string
  hasKey: boolean
  showKey: boolean
  onToggleKey: () => void
  onChange: (apiKey: string) => void
}

function ProviderApiKeyField({
  value,
  hasKey,
  showKey,
  onToggleKey,
  onChange,
}: ProviderApiKeyFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-muted-foreground text-sm">
        API Key <span className="opacity-60">(optional)</span>
      </Label>
      <div className="flex items-center gap-4">
        <Input
          type={showKey ? 'text' : 'password'}
          className="flex-1 font-mono text-sm"
          placeholder={hasKey ? '(Already set)' : 'sk-...'}
          // Undefined keeps the stored key, while an empty string clears it
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <RippleButton
          variant="surface"
          size="icon"
          className="text-muted-foreground size-9 shrink-0"
          onClick={onToggleKey}
          aria-label={showKey ? 'Hide key' : 'Show key'}
        >
          {showKey ? (
            <EyeOffIcon className="size-4" />
          ) : (
            <EyeIcon className="size-4" />
          )}
        </RippleButton>
      </div>
    </div>
  )
}

type ProviderBaseURLFieldProps = {
  providerId: string
  isCustom: boolean
  requiresBaseURL: boolean
  value?: string
  error?: string
  onChange: (baseURL: string | undefined) => void
}

function ProviderBaseURLField({
  providerId,
  isCustom,
  requiresBaseURL,
  value,
  error,
  onChange,
}: ProviderBaseURLFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      {isCustom ? (
        <HelpPopoverLabel
          className="text-muted-foreground text-sm"
          help={md`
            When picking a custom provider, the system treats it
            as OpenAI-compatible. Add '/responses' at the end of
            the URL to use the responses API.
          `}
        >
          Base URL <span className="opacity-60">(required)</span>
        </HelpPopoverLabel>
      ) : (
        <Label className="text-muted-foreground text-sm">
          Base URL
          <span className="opacity-60">
            {requiresBaseURL ? ' (required)' : ' (optional)'}
          </span>
        </Label>
      )}
      <Input
        className="font-mono text-sm"
        placeholder={
          providerId === 'ollama'
            ? 'http://localhost:11434/api'
            : 'https://api.example.com/v1'
        }
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        aria-invalid={!!error}
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}

type ProviderModelListProps = {
  models: ModelEntryFormValues[]
  editorId: string
  defaultReasoning?: ProviderOption['defaultReasoning']
  binaryReasoningParameter?: string
  onAdd: () => void
  onUpdate: (index: number, patch: Partial<ModelEntryFormValues>) => void
  onRemove: (index: number) => void
}

function ProviderModelList({
  models,
  editorId,
  defaultReasoning,
  binaryReasoningParameter,
  onAdd,
  onUpdate,
  onRemove,
}: ProviderModelListProps) {
  return (
    <div className="flex flex-col gap-3">
      <Label className="text-muted-foreground text-sm">Models</Label>
      <RippleButton
        variant="input"
        size="sm"
        className="self-start text-sm"
        onClick={onAdd}
      >
        <PlusIcon />
        Add model
      </RippleButton>
      {models.length > 0 && (
        <div className="flex flex-col gap-1">
          {models.map((model, idx) => (
            <ModelRow
              key={idx}
              model={model}
              editorId={`${editorId}-${idx}`}
              defaultReasoning={defaultReasoning}
              binaryReasoningParameter={binaryReasoningParameter}
              onChange={(patch) => onUpdate(idx, patch)}
              onRemove={() => onRemove(idx)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Keeps provider form defaults usable while newer metadata is loading. */
function providerFormBinaryParameter(providerId: string) {
  return providerId === 'ollama' ? 'think' : undefined
}

function ExpandToggle() {
  const { isOpen, toggle } = useCollapsible()
  return (
    <RippleButton
      variant="stealth"
      size="icon"
      className="size-8"
      onClick={toggle}
      aria-label={isOpen ? 'Collapse' : 'Expand'}
    >
      <Accordion.Icon
        isExpanded={isOpen}
        className="text-muted-foreground size-4"
      />
    </RippleButton>
  )
}
