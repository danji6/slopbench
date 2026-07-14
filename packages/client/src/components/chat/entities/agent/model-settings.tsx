import { SettingsList } from '@/components/ui'
import type { Control } from 'react-hook-form'
import { Controller } from 'react-hook-form'

import { ModelPicker, ReasoningPicker } from '../../models'
import type { AgentFormValues } from './agent-form'
import { InferenceSettings } from './inference-settings'

export function ModelSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  return (
    <SettingsList>
      <SettingsList.Item
        label="Model"
        description="The model this agent uses to generate responses."
        unclickable
        unhoverable
      >
        <Controller
          control={control}
          name="modelId"
          render={({ field }) => (
            <ModelPicker
              variant="input"
              value={field.value ?? ''}
              onValueChange={(v) => field.onChange(v || undefined)}
            />
          )}
        />
      </SettingsList.Item>
      <SettingsList.Item
        label="Reasoning"
        description="How much effort the model spends reasoning before answering."
        unclickable
        unhoverable
      >
        <Controller
          control={control}
          name="reasoningEffort"
          render={({ field }) => (
            <ReasoningPicker
              variant="input"
              value={field.value ?? 'auto'}
              onValueChange={(v) => field.onChange(v)}
            />
          )}
        />
      </SettingsList.Item>
      <InferenceSettings control={control} />
    </SettingsList>
  )
}
