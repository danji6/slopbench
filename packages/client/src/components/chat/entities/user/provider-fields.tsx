import { md } from '@/components/markdown'
import {
  Combobox,
  HelpPopoverLabel,
  Input,
  Label,
  RippleButton,
} from '@/components/ui'
import {
  PROVIDER_AUTH_LABELS,
  type ProviderAuth,
} from '@sb/core/provider-registry'
import { EyeIcon, EyeOffIcon } from 'lucide-react'

import type { ProviderOption } from './provider-types'

type ProviderTypeFieldProps = {
  providers?: ProviderOption[]
  value: string
  showCustomInput: boolean
  providerId: string
  typeError?: string
  onChange: (value: string) => void
  onCustomNameChange: (id: string) => void
}

export function ProviderTypeField({
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

export function ProviderApiKeyField({
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

export function ProviderBaseURLField({
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

type ProviderAuthFieldProps = {
  methods: ProviderAuth[]
  value: ProviderAuth
  onChange: (value: ProviderAuth) => void
}

/** Chooses an authentication method advertised by the provider. */
export function ProviderAuthField({
  methods,
  value,
  onChange,
}: ProviderAuthFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-muted-foreground text-sm">Access method</Label>
      <Combobox
        value={value}
        onValueChange={(value) => {
          if (value === 'apiKey' || value === 'chatgpt') onChange(value)
        }}
        noDeselect
      >
        <Combobox.Trigger
          variant="input"
          className="w-full max-w-64 justify-between"
        >
          <Combobox.DisplayValue>
            {(value) => PROVIDER_AUTH_LABELS[value as ProviderAuth]}
          </Combobox.DisplayValue>
        </Combobox.Trigger>
        <Combobox.Content align="start">
          <Combobox.List>
            {methods.map((method) => (
              <Combobox.Item key={method} value={method}>
                {PROVIDER_AUTH_LABELS[method]}
              </Combobox.Item>
            ))}
          </Combobox.List>
        </Combobox.Content>
      </Combobox>
    </div>
  )
}
