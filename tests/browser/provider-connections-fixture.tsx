import { ModelSettings } from '@/components/chat/entities/user/model-settings'
import type { SettingsFormValues } from '@/components/chat/entities/user/settings-schema'
import { defaultSettingsValues } from '@/components/chat/entities/user/user-settings-values'
import { ModelPicker } from '@/components/chat/models/model-picker'
import { Input, RippleButton } from '@/components/ui'
import '@/globals.css'
import { useUserSettingsPersistence } from '@/hooks/chat/user-settings-persistence'
import { providerForm } from '@/lib/provider-settings'
import { api } from '@sb/convex/_generated/api'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider, useQuery } from 'convex/react'
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
  const settings = useQuery(api.settings.get)
  const form = useForm<SettingsFormValues>({
    defaultValues: {
      ...defaultSettingsValues(),
      displayName: 'Unrelated settings',
    },
  })
  const persist = useUserSettingsPersistence({
    pendingAvatar: null,
    avatarCleared: false,
    setPendingAvatar: () => {},
    setAvatarCleared: () => {},
    form,
    draft: { clear() {} },
  })
  const name = useWatch({ control: form.control, name: 'displayName' })
  return (
    <main className="bg-background text-foreground min-h-screen p-4">
      <form
        onSubmit={form.handleSubmit(async (values) => {
          await persist(values)
          setSaved(values.displayName)
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
              titleModel: settings?.titleModel ?? null,
              titleSystemPrompt:
                settings?.titleSystemPrompt ??
                defaultSettingsValues().titleSystemPrompt,
              providers: (connections ?? []).map(providerForm),
            })
          }
        >
          Cancel settings
        </RippleButton>
      </form>
      <output aria-label="Global saved value">{saved}</output>
      <output aria-label="Saved title model">
        {settings?.titleModel ?? 'None'}
      </output>
      <output aria-label="Saved title prompt">
        {settings?.titleSystemPrompt}
      </output>
      <output aria-label="Settings draft dirty">
        {String(form.formState.isDirty)}
      </output>
      <output aria-label="Saved connection count">{connections?.length}</output>
      <RippleButton onClick={failProviderDiscovery}>
        Simulate discovery failure
      </RippleButton>
      <ModelPicker
        aria-label="Composer model"
        value={model}
        onValueChange={setModel}
      />
      <output aria-label="Selected reference">{model}</output>
    </main>
  )
}
