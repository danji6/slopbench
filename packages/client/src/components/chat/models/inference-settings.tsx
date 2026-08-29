import { md } from '@/components/markdown'
import { ParamSlider, SettingsList } from '@/components/ui'
import type { InferenceParameters } from '@sb/core/types'

type InferenceField = keyof InferenceParameters

type InferenceSetting = {
  name: InferenceField
  label: string
  help: React.ReactNode
  defaultValue: number
  minValue: number
  maxValue: number
  step: number
}

const INFERENCE_SETTINGS: InferenceSetting[] = [
  {
    name: 'temperature',
    label: 'Temperature',
    help: md`
Controls output randomness. Higher values are more varied; lower values are more focused.
    `,
    defaultValue: 1,
    minValue: 0,
    maxValue: 2,
    step: 0.01,
  },
  {
    name: 'topP',
    label: 'Top P',
    help: md`
Limits token choices to the most likely set. Lower values make output more focused and predictable.
    `,
    defaultValue: 1,
    minValue: 0,
    maxValue: 1,
    step: 0.01,
  },
  {
    name: 'frequencyPenalty',
    label: 'Frequency Penalty',
    help: md`
Reduces repetition in proportion to how often a token has already appeared.
    `,
    defaultValue: 0,
    minValue: -2,
    maxValue: 2,
    step: 0.01,
  },
  {
    name: 'presencePenalty',
    label: 'Presence Penalty',
    help: md`
Discourages tokens that have appeared at all and encourages new words.
    `,
    defaultValue: 0,
    minValue: -2,
    maxValue: 2,
    step: 0.01,
  },
  {
    name: 'repeatPenalty',
    label: 'Repeat Penalty',
    help: md`
Ollama-specific multiplicative repetition penalty. Frequency and presence penalties are ignored by Ollama.
    `,
    defaultValue: 1.1,
    minValue: 0.5,
    maxValue: 2,
    step: 0.05,
  },
]

type InferenceSettingsProps = {
  value?: InferenceParameters
  onChange: (value: InferenceParameters) => void
  density?: 'standard' | 'compact'
  disabled?: boolean
}

/** Controlled model inference parameters. */
export function InferenceSettings({
  value = {},
  onChange,
  density = 'standard',
  disabled,
}: InferenceSettingsProps) {
  function update(name: InferenceField, next: number | undefined) {
    const inference = { ...value, [name]: next }
    if (next === undefined) delete inference[name]
    onChange(inference)
  }

  if (density === 'compact') {
    return (
      <div className="flex flex-col gap-2">
        {INFERENCE_SETTINGS.map(({ name, ...props }) => (
          <ParamSlider
            key={name}
            {...props}
            optional
            thickness="xxs"
            value={value[name]}
            onChange={(next) => update(name, next)}
            disabled={disabled}
          />
        ))}
      </div>
    )
  }

  return (
    <SettingsList>
      {INFERENCE_SETTINGS.map(({ name, ...props }) => (
        <SettingsList.Slider
          key={name}
          {...props}
          optional
          value={value[name]}
          onChange={(next: number | undefined) => update(name, next)}
          disabled={disabled}
        />
      ))}
    </SettingsList>
  )
}
