import { RippleButton, SettingsList } from '@/components/ui'
import { generateId } from '@/lib/utils'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import type { Control, FieldErrors } from 'react-hook-form'
import { useFieldArray, useFormState, useWatch } from 'react-hook-form'

import { ProviderCard } from './provider-card'
import type { ProviderOption } from './provider-types'
import type { ProviderFormValues, SettingsFormValues } from './settings-schema'

export type {
  ModelEntryFormValues,
  ProviderFormValues,
} from './settings-schema'

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

  const [newProviderClientId, setNewProviderClientId] = useState<string | null>(null) // prettier-ignore
  const { errors } = useFormState({ control })
  const providerValues = useWatch({ control, name: 'providers' })
  const providerErrors = (errors.providers ?? []) as FieldErrors<ProviderFormValues>[] // prettier-ignore

  function addProvider() {
    const clientId = generateId()
    setNewProviderClientId(clientId)
    append({
      id: '',
      enabled: true,
      hasKey: false,
      models: [],
      _clientId: clientId,
    })
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
          {fields.map((field, index) => {
            const provider = providerValues[index] ?? field
            return (
              <ProviderCard
                key={field._clientId}
                provider={provider}
                defaultOpen={field._clientId === newProviderClientId}
                providers={providers}
                typeError={
                  providerErrors[index]?.id?.message as string | undefined
                }
                baseURLError={
                  providerErrors[index]?.baseURL?.message as string | undefined
                }
                onChange={(patch) => update(index, { ...provider, ...patch })}
                onRemove={() => remove(index)}
              />
            )
          })}
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
