import { SettingsList } from '@/components/ui'
import { normalizeReasoningEffort, useModels } from '@/hooks/chat'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { ModelPicker, ReasoningPicker } from '../../models'
import type { AgentFormValues } from './agent-form'
import { InferenceSettings } from './inference-settings'

export function ModelSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  const { field: modelField } = useController({
    control,
    name: 'modelId',
  })
  const { field: reasoningField } = useController({
    control,
    name: 'reasoningEffort',
  })

  const { models } = useModels()
  const model =
    models.find((candidate) => candidate.id === modelField.value) ?? null

  function setModel(modelId: string) {
    modelField.onChange(modelId || null)
    const selected = models.find((candidate) => candidate.id === modelId)
    reasoningField.onChange(
      normalizeReasoningEffort(
        reasoningField.value ?? undefined,
        selected?.reasoning,
      ),
    )
  }

  return (
    <SettingsList>
      <SettingsList.Item
        label="Model"
        description="The model this agent uses to generate responses."
        unclickable
        unhoverable
      >
        <ModelPicker
          variant="input"
          value={modelField.value ?? ''}
          onValueChange={setModel}
        />
      </SettingsList.Item>
      {model?.reasoning?.type !== 'none' && (
        <SettingsList.Item
          label="Reasoning"
          description={
            model?.reasoning?.type === 'binary'
              ? 'Enable reasoning for this model.'
              : 'How much effort the model spends reasoning before answering.'
          }
          unclickable
          unhoverable
        >
          <ReasoningPicker
            variant="input"
            value={reasoningField.value ?? 'auto'}
            onValueChange={reasoningField.onChange}
            model={model}
          />
        </SettingsList.Item>
      )}
      <InferenceSettings control={control} />
    </SettingsList>
  )
}
