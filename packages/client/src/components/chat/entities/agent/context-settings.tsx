import { md } from '@/components/markdown'
import { SettingsList } from '@/components/ui'
import type { Control } from 'react-hook-form'
import { Controller, useWatch } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

export function ContextSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  const trimContext = useWatch({ control, name: 'trimContext' })

  return (
    <SettingsList>
      <Controller
        control={control}
        name="shareUserDisplayNames"
        render={({ field }) => (
          <SettingsList.Switch
            label="Share user display names"
            description="Let this agent see the names of users in the conversation."
            help={md`
              When enabled, each user message is prefixed with the sender's display
              name so this agent can tell different users apart.
            `}
            checked={field.value ?? false}
            onCheckedChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="shareAgentDisplayNames"
        render={({ field }) => (
          <SettingsList.Switch
            label="Share agent display names"
            description="Let this agent see the names of other agents in the conversation."
            help={md`
              When enabled, messages from other agents are prefixed with their
              display name so this agent can tell them apart.
            `}
            checked={field.value ?? false}
            onCheckedChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="maskOtherAgents"
        render={({ field }) => (
          <SettingsList.Switch
            label="Mask other agents as users"
            description="Present other agents' messages as user turns."
            help={md`
              When enabled, only this agent's own past replies are shown as the
              assistant, while every other agent's messages are masked as user
              turns before the request is sent to the provider.
            `}
            checked={field.value ?? false}
            onCheckedChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="outputTokens"
        render={({ field }) => (
          <SettingsList.NumberInput
            label="Output tokens"
            description="Maximum number of tokens to output in a single response."
            help={md`
              How many tokens the model is allowed to generate in a single
              response.
            `}
            value={field.value}
            defaultValue={-1}
            minValue={0}
            maxValue={1000000}
            step={1024}
            onChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="trimContext"
        render={({ field }) => (
          <SettingsList.Switch
            label="Trim context"
            description="Ensure the configured context window isn't exceeded."
            help={md`
              When enabled, older messages are automatically discarded when the
              total context exceeds the configured window size.

              Enabling this is not recommended when the provider uses prompt
              caching.
            `}
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="contextWindow"
        render={({ field }) => (
          <SettingsList.NumberInput
            disabled={!trimContext}
            label="Context Window"
            help={md`
              The maximum number of tokens to keep in context when 'Trim Context'
              is enabled.
            `}
            value={field.value}
            defaultValue={-1}
            minValue={0}
            maxValue={1000000}
            step={1024}
            onChange={field.onChange}
          />
        )}
      />
    </SettingsList>
  )
}
