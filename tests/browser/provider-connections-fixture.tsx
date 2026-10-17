import { ModelSettings } from '@/components/chat/entities/user/model-settings'
import type { SettingsFormValues } from '@/components/chat/entities/user/settings-schema'
import { defaultSettingsValues } from '@/components/chat/entities/user/user-settings-values'
import { ModelPicker } from '@/components/chat/models/model-picker'
import { Input, RippleButton } from '@/components/ui'
import '@/globals.css'
import { providerForm, providerSaveInput } from '@/lib/provider-settings'
import { api } from '@sb/convex/_generated/api'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import {
  failProviderDiscovery,
  providerConnectionsClient,
} from './provider-connections-client'

export function ProviderConnectionsFixture() {
  return (
    <ConvexProvider client={providerConnectionsClient}>
      <ConvexQueryCacheProvider>
        <Settings />
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
function Settings() {
  const [saved, setSaved] = useState('')
  const [model, setModel] = useState('')
  const connections = useQuery(api.providers.list)
  const save = useMutation(api.providers.save)
  const form = useForm<SettingsFormValues>({
    defaultValues: {
      ...defaultSettingsValues(),
      displayName: 'Unrelated settings',
    },
  })
  const name = useWatch({ control: form.control, name: 'displayName' })
  return (
    <main className="bg-background text-foreground min-h-screen p-4">
      <form
        onSubmit={form.handleSubmit(async (values) => {
          const result = await save({
            connections: values.providers.map(providerSaveInput),
            removed: (values.removedProviders ?? []).map((row) => ({
              ...row,
              providerId: row.providerId as never,
            })),
          })
          setSaved(values.displayName)
          form.reset({
            ...values,
            removedProviders: [],
            providers: values.providers.map((row) => {
              const saved = result.find(
                (item) => item.clientId === (row._clientId ?? row.connectionId),
              )!
              return {
                ...row,
                connectionId: saved.providerId,
                configRevision: saved.configRevision,
                previewId: undefined,
                apiKey: undefined,
              }
            }),
          })
        })}
      >
        <Input
          aria-label="Unrelated setting"
          value={name}
          onChange={(event) => form.setValue('displayName', event.target.value)}
        />
        <ModelSettings
          form={form}
          providers={[
            {
              value: 'openai',
              label: 'OpenAI',
              requiresBaseURL: false,
              defaultReasoning: { type: 'effort', efforts: ['low', 'high'] },
            },
          ]}
        />
        <RippleButton type="submit">Save global settings</RippleButton>
        <RippleButton
          type="button"
          onClick={() =>
            form.reset({
              ...defaultSettingsValues(),
              providers: (connections ?? []).map(providerForm),
            })
          }
        >
          Cancel settings
        </RippleButton>
      </form>
      <output aria-label="Global saved value">{saved}</output>
      <output aria-label="Saved connection count">{connections?.length}</output>
      <RippleButton onClick={failProviderDiscovery}>
        Simulate discovery failure
      </RippleButton>
      <ModelPicker value={model} onValueChange={setModel} />
      <output aria-label="Selected reference">{model}</output>
    </main>
  )
}
