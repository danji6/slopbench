import { md } from '@/components/markdown'
import { SettingsList } from '@/components/ui'
import type { Control } from 'react-hook-form'
import { Controller } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

export function InferenceSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  return (
    <>
      <Controller
        control={control}
        name="temperature"
        render={({ field }) => (
          <SettingsList.Slider
            label="Temperature"
            help={md`
              Controls output randomness. Higher values produce more varied
              responses; lower values are more focused and deterministic.
            `}
            optional
            value={field.value}
            defaultValue={1}
            minValue={0}
            maxValue={2}
            step={0.01}
            onChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="topP"
        render={({ field }) => (
          <SettingsList.Slider
            label="Top P"
            help={md`
              Controls how the model picks the next word in a sentence. Instead of
              looking at every possible word, it only considers the most likely
              ones that together add up to a certain percentage. A lower value
              means fewer word choices are considered, making the output more
              focused and predictable.
            `}
            optional
            value={field.value}
            defaultValue={1}
            minValue={0}
            maxValue={1}
            step={0.01}
            onChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="frequencyPenalty"
        render={({ field }) => (
          <SettingsList.Slider
            label="Frequency Penalty"
            help={md`
              Reduces the likelihood of the model repeating a token proportionally
              to how many times it has already appeared.
            `}
            optional
            value={field.value}
            defaultValue={0}
            minValue={-2}
            maxValue={2}
            step={0.01}
            onChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="presencePenalty"
        render={({ field }) => (
          <SettingsList.Slider
            label="Presence Penalty"
            help={md`
              Penalises any token that has appeared at all, regardless of
              frequency. Encourages the model to use new words.
            `}
            optional
            value={field.value}
            defaultValue={0}
            minValue={-2}
            maxValue={2}
            step={0.01}
            onChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="repeatPenalty"
        render={({ field }) => (
          <SettingsList.Slider
            label="Repeat Penalty"
            help={md`
              Multiplicative penalty applied to repeated tokens. 1.0 = no penalty;
              higher values discourage repetition.

              This is an Ollama-specific setting. If you're using Ollama,
              frequency and presence penalties are ignored and this is used
              instead.
            `}
            optional
            value={field.value}
            defaultValue={1.1}
            minValue={0.5}
            maxValue={2}
            step={0.05}
            onChange={field.onChange}
          />
        )}
      />
    </>
  )
}
