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
  SettingsList,
  Switch,
  useCollapsible,
} from '@/components/ui'
import { cn, expandNumber, generateId } from '@/lib/utils'
import { EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import type { Control, FieldErrors } from 'react-hook-form'
import { useFieldArray, useFormState } from 'react-hook-form'

import type {
  ModelEntryFormValues,
  ProviderFormValues,
  SettingsFormValues,
} from './settings-schema'

export type {
  ModelEntryFormValues,
  ProviderFormValues,
} from './settings-schema'

type ProviderOption = { value: string; label: string }

type ModelSettingsProps = {
  control: Control<SettingsFormValues>
  providers?: ProviderOption[]
}

export function ModelSettings({ control, providers }: ModelSettingsProps) {
  const { fields, append, remove, update } = useFieldArray<
    SettingsFormValues,
    'providers',
    'rhfKey'
  >({
    control,
    name: 'providers',
    keyName: 'rhfKey',
  })

  const [newProviderClientId, setNewProviderClientId] = useState<string | null>(
    null,
  )
  const { errors } = useFormState({ control })
  const providerErrors = (errors.providers ??
    []) as FieldErrors<ProviderFormValues>[]

  function addProvider() {
    const clientId = generateId()
    setNewProviderClientId(clientId)
    append({ id: '', enabled: true, models: [], _clientId: clientId })
  }

  return (
    <SettingsList className="pb-4">
      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Providers"
        description="Configure AI providers and their models."
      >
        <div className="flex flex-col gap-2">
          {fields.map((field, index) => (
            <ProviderCard
              key={field._clientId}
              provider={field}
              defaultOpen={field._clientId === newProviderClientId}
              providers={providers}
              typeError={
                providerErrors[index]?.id?.message as string | undefined
              }
              onChange={(patch) => {
                const { rhfKey: _, ...data } = field
                update(index, { ...data, ...patch })
              }}
              onRemove={() => remove(index)}
            />
          ))}
          <RippleButton
            variant="input"
            size="sm"
            className="mt-1 self-start"
            onClick={addProvider}
          >
            <PlusIcon />
            Add provider
          </RippleButton>
        </div>
      </SettingsList.Item>
    </SettingsList>
  )
}

type ProviderCardProps = {
  provider: ProviderFormValues
  defaultOpen?: boolean
  providers?: ProviderOption[]
  typeError?: string
  onChange: (patch: Partial<ProviderFormValues>) => void
  onRemove: () => void
}

function ProviderCard({
  provider,
  defaultOpen = false,
  providers,
  typeError,
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
    onChange({ models: [...provider.models, { id: '' }] })
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
      <div className="flex items-center gap-4 px-2 py-1">
        <ExpandToggle />
        <span
          className={cn(
            'text-md flex-1 font-semibold',
            !provider.enabled && 'text-muted-foreground',
          )}
        >
          {providerLabel}
        </span>
        <span className="text-muted-foreground text-sm">
          {provider.models.length} model
          {provider.models.length !== 1 ? 's' : ''}
        </span>
        <Switch
          size="sm"
          checked={provider.enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
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

      <Collapsible.Content className="gap-3.5">
        <div className="flex flex-col gap-1">
          <Label className="text-muted-foreground text-sm">Provider</Label>
          <Combobox
            value={comboboxValue}
            onValueChange={handleProviderChange}
            noDeselect
          >
            <Combobox.Trigger
              variant="input"
              className="w-full max-w-64 justify-between"
              disabled={!providers}
            >
              <Combobox.DisplayValue placeholder="Select provider...">
                {(val) => {
                  if (!val) return undefined
                  if (val === '_other') return 'Other...'
                  if (!providers) return 'Loading...'
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
                  <Combobox.Item value="_other">Other...</Combobox.Item>
                </Combobox.List>
              )}
            </Combobox.Content>
          </Combobox>
        </div>

        {showCustomInput && (
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-sm">
              Provider name
            </Label>
            <Input
              className="font-mono text-sm"
              placeholder="e.g. SomeProvider"
              value={provider.id}
              onChange={(e) => onChange({ id: e.target.value })}
            />
          </div>
        )}

        {typeError && <p className="text-destructive text-sm">{typeError}</p>}

        <div className="flex flex-col gap-1">
          <Label className="text-muted-foreground text-sm">API Key</Label>
          <div className="flex items-center gap-4">
            <Input
              type={showKey ? 'text' : 'password'}
              className="flex-1 font-mono text-sm"
              placeholder="sk-..."
              value={provider.apiKey ?? ''}
              onChange={(e) =>
                onChange({ apiKey: e.target.value || undefined })
              }
            />
            <RippleButton
              variant="surface"
              size="icon"
              className="text-muted-foreground size-9 shrink-0"
              onClick={() => setShowKey((v) => !v)}
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

        <div className="flex flex-col gap-1">
          {comboboxValue === '_other' ? (
            <HelpPopoverLabel
              className="text-muted-foreground text-sm"
              help={md`
                When picking a custom provider, the system treats it
                as OpenAI-compatible. Add '/responses' at the end of
                the URL to use the responses API.
              `}
            >
              Base URL
            </HelpPopoverLabel>
          ) : (
            <Label className="text-muted-foreground text-sm">
              Base URL
              <span className="opacity-60"> (optional)</span>
            </Label>
          )}
          <Input
            className="font-mono text-sm"
            placeholder={
              provider.id === 'ollama'
                ? 'http://localhost:11434/api'
                : 'https://api.example.com/v1'
            }
            value={provider.baseURL ?? ''}
            onChange={(e) => onChange({ baseURL: e.target.value || undefined })}
          />
        </div>

        <div className="flex flex-col gap-3">
          <Label className="text-muted-foreground text-sm">Models</Label>
          {provider.models.length > 0 && (
            <div className="flex flex-col gap-1">
              {provider.models.map((model, idx) => (
                <ModelRow
                  key={idx}
                  model={model}
                  onChange={(patch) => updateModel(idx, patch)}
                  onRemove={() => removeModel(idx)}
                />
              ))}
            </div>
          )}
          <RippleButton
            variant="input"
            size="sm"
            className="mb-1 self-start text-sm"
            onClick={addModel}
          >
            <PlusIcon />
            Add model
          </RippleButton>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
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

type ModelRowProps = {
  model: ModelEntryFormValues
  onChange: (patch: Partial<ModelEntryFormValues>) => void
  onRemove: () => void
}

type ContextWindowFieldProps = {
  value?: number
  onChange: (value: number | undefined) => void
}

function ContextWindowField({ value, onChange }: ContextWindowFieldProps) {
  const [text, setText] = useState(value?.toString() ?? '')
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setText(value?.toString() ?? '')
  }

  function commit(raw: string) {
    setText(raw)
    const trimmed = raw.trim()
    if (!trimmed) return onChange(undefined)
    try {
      onChange(Math.round(expandNumber(trimmed)))
    } catch {
      // Keep typing
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <HelpPopoverLabel
        className="text-muted-foreground text-sm"
        help={md`
          Maximum context tokens for this model. Only used for
          visual feedback. Accepts shorthand like \`128k\` or \`1m\`.
        `}
      >
        Context window <span className="opacity-60">(optional)</span>
      </HelpPopoverLabel>
      <Input
        className="h-9 max-w-32 font-mono text-sm"
        placeholder="e.g. 128k"
        value={text}
        onChange={(e) => commit(e.target.value)}
      />
    </div>
  )
}

function ModelRow({ model, onChange, onRemove }: ModelRowProps) {
  return (
    <div className="bg-background/40 flex items-center gap-4 rounded-lg border p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-sm">Model ID</Label>
          <Input
            className="h-9 font-mono text-sm"
            placeholder="e.g. model-id"
            value={model.id}
            onChange={(e) => onChange({ id: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-sm">
            Display name <span className="opacity-60">(optional)</span>
          </Label>
          <Input
            className="h-9 max-w-48 text-sm"
            placeholder="e.g. Model Name"
            value={model.label ?? ''}
            onChange={(e) => onChange({ label: e.target.value || undefined })}
          />
        </div>
        <ContextWindowField
          value={model.contextWindow}
          onChange={(contextWindow) => onChange({ contextWindow })}
        />
      </div>
      <RippleButton
        variant="surface"
        size="icon"
        className="text-muted-foreground hover:text-destructive size-10"
        onClick={onRemove}
        aria-label="Remove model"
      >
        <Trash2Icon />
      </RippleButton>
    </div>
  )
}
