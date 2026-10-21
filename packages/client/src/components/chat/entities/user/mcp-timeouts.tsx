import { SettingsInput } from '@/components/ui'
import { APP_NAME } from '@sb/core/const'

import type { McpServerFormValues } from './settings-schema'

type Props = {
  item: McpServerFormValues
  onChange: (patch: Partial<McpServerFormValues>) => void
}

const settings = [
  {
    key: 'startupTimeoutMs',
    label: 'MCP startup timeout',
    help: `How long ${APP_NAME} waits for the server to connect and finish initialization. Increase this if the server starts slowly. Default: 30 seconds.`,
    defaultValue: 30_000,
    max: 300_000,
  },
  {
    key: 'requestTimeoutMs',
    label: 'MCP inactivity timeout',
    help: `How long a tool call can go without a result or progress update before cancellation is requested. Each progress update restarts this timer. Default: 5 minutes.`,
    defaultValue: 300_000,
    max: 86_400_000,
  },
  {
    key: 'maxTotalTimeoutMs',
    label: 'MCP absolute timeout',
    help: `The maximum total time allowed for a tool call, even if it keeps reporting progress. Cancellation is requested when this limit is reached. Default: 30 minutes.`,
    defaultValue: 1_800_000,
    max: 86_400_000,
  },
] as const

/** Edits startup, inactivity and absolute deadlines independently. */
export function McpTimeouts({ item, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {settings.map(({ key, label, help, defaultValue, max }) => (
        <SettingsInput
          key={key}
          label={`${label} (ms)`}
          help={help}
          type="number"
          aria-label={label}
          min={100}
          max={max}
          value={item[key] ?? ''}
          onValueChange={(value) =>
            onChange({ [key]: value ? Number(value) : undefined })
          }
          onReset={() => onChange({ [key]: defaultValue })}
          resetDisabled={item[key] === defaultValue}
          resetTitle={`Reset to ${defaultValue.toLocaleString()} ms`}
        />
      ))}
    </div>
  )
}
