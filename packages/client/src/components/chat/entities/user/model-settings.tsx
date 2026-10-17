import { RippleButton, SettingsList } from '@/components/ui'
import { useModelProviders } from '@/hooks/chat/integrations'
import { useProviderDiscoveryCoordinator } from '@/hooks/chat/provider-discovery'
import { useProviderSettingsSync } from '@/hooks/chat/provider-settings'
import { networkChanged } from '@/lib/provider-settings'
import { generateId } from '@/lib/utils'
import { type UseFormReturn, useWatch } from 'react-hook-form'

import { ProviderCard } from './provider-card'
import { ProviderDiscovery } from './provider-discovery'
import type { ProviderOption } from './provider-types'
import type { ProviderFormValues, SettingsFormValues } from './settings-schema'

type Props = {
  providers?: ProviderOption[]
  form: UseFormReturn<SettingsFormValues>
}

export function ModelSettings({ providers, form }: Props) {
  const connections = useModelProviders()

  useProviderSettingsSync(form, connections)
  useProviderDiscoveryCoordinator(true)

  const values = useWatch({ control: form.control, name: 'providers' })

  function patch(index: number, update: Partial<ProviderFormValues>) {
    const current = form.getValues('providers')
    const value = current[index]
    const next = {
      ...value,
      ...(networkChanged(value, update) ? { previewId: undefined } : {}),
      ...update,
    }
    form.setValue(
      'providers',
      current.map((row, i) => (i === index ? next : row)),
      { shouldDirty: true },
    )
  }

  function remove(index: number) {
    const current = form.getValues('providers')
    const value = current[index]
    if (value.connectionId)
      form.setValue(
        'removedProviders',
        [
          ...(form.getValues('removedProviders') ?? []),
          {
            providerId: value.connectionId,
            configRevision: value.configRevision ?? 0,
          },
        ],
        { shouldDirty: true },
      )
    form.setValue(
      'providers',
      current.filter((_, i) => i !== index),
      { shouldDirty: true },
    )
  }

  function handleAdd() {
    form.setValue(
      'providers',
      [
        ...form.getValues('providers'),
        {
          id: '',
          name: '',
          auth: 'apiKey',
          models: [],
          enabled: true,
          hasKey: false,
          _clientId: generateId(),
        },
      ],
      { shouldDirty: true },
    )
  }

  return (
    <SettingsList className="pb-4">
      <SettingsList.Item
        unclickable
        unhoverable
        orientation="vertical"
        label="Provider connections"
        description="Configure AI providers and their models."
      >
        <div className="flex flex-col gap-2">
          {values.map((value, index) => (
            <ProviderCard
              key={value._clientId ?? value.connectionId}
              provider={value}
              saved={!!value.connectionId}
              defaultOpen={!value.connectionId}
              providers={providers}
              onChange={(update) => patch(index, update)}
              onRemove={() => remove(index)}
            >
              <ProviderDiscovery
                provider={value}
                onChange={(update) => patch(index, update)}
              />
            </ProviderCard>
          ))}
          <RippleButton
            variant="input"
            size="sm"
            disabled={!connections}
            onClick={handleAdd}
          >
            Add connection
          </RippleButton>
        </div>
      </SettingsList.Item>
    </SettingsList>
  )
}
