import { md } from '@/components/markdown'
import { SettingsList } from '@/components/ui'
import type { Control } from 'react-hook-form'
import { Controller } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

type InferenceField =
  | 'temperature'
  | 'topP'
  | 'frequencyPenalty'
  | 'presencePenalty'
  | 'repeatPenalty'

type InferenceSliderProps = {
  control: Control<AgentFormValues>
  name: InferenceField
  label: string
  help: React.ReactNode
  defaultValue: number
  minValue: number
  maxValue: number
  step: number
}

/** A parameter the agent may leave to the provider's own default. */
function InferenceSlider({ control, name, ...props }: InferenceSliderProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <SettingsList.Slider
          {...props}
          optional
          value={field.value ?? undefined}
          onChange={(v: number | undefined) => field.onChange(v ?? null)}
        />
      )}
    />
  )
}

export function InferenceSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  return (
    <>
      <InferenceSlider
        control={control}
        name="temperature"
        label="Temperature"
        help={md`
          Controls output randomness. Higher values produce more varied
          responses; lower values are more focused and deterministic.
        `}
        defaultValue={1}
        minValue={0}
        maxValue={2}
        step={0.01}
      />

      <InferenceSlider
        control={control}
        name="topP"
        label="Top P"
        help={md`
          Controls how the model picks the next word in a sentence. Instead of
          looking at every possible word, it only considers the most likely
          ones that together add up to a certain percentage. A lower value
          means fewer word choices are considered, making the output more
          focused and predictable.
        `}
        defaultValue={1}
        minValue={0}
        maxValue={1}
        step={0.01}
      />

      <InferenceSlider
        control={control}
        name="frequencyPenalty"
        label="Frequency Penalty"
        help={md`
          Reduces the likelihood of the model repeating a token proportionally
          to how many times it has already appeared.
        `}
        defaultValue={0}
        minValue={-2}
        maxValue={2}
        step={0.01}
      />

      <InferenceSlider
        control={control}
        name="presencePenalty"
        label="Presence Penalty"
        help={md`
          Penalises any token that has appeared at all, regardless of
          frequency. Encourages the model to use new words.
        `}
        defaultValue={0}
        minValue={-2}
        maxValue={2}
        step={0.01}
      />

      <InferenceSlider
        control={control}
        name="repeatPenalty"
        label="Repeat Penalty"
        help={md`
          Multiplicative penalty applied to repeated tokens. 1.0 = no penalty;
          higher values discourage repetition.

          This is an Ollama-specific setting. If you're using Ollama,
          frequency and presence penalties are ignored and this is used
          instead.
        `}
        defaultValue={1.1}
        minValue={0.5}
        maxValue={2}
        step={0.05}
      />
    </>
  )
}
