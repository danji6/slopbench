import { Input } from '@/components/ui'
import { RotateCcwIcon } from 'lucide-react'

import type { McpServerFormValues } from './settings-schema'

type Props = {
  item: McpServerFormValues
  onChange: (patch: Partial<McpServerFormValues>) => void
}

const settings = [
  {
    key: 'startupTimeoutMs',
    label: 'MCP startup timeout',
    defaultValue: 30_000,
    max: 300_000,
  },
  {
    key: 'requestTimeoutMs',
    label: 'MCP inactivity timeout',
    defaultValue: 300_000,
    max: 86_400_000,
  },
  {
    key: 'maxTotalTimeoutMs',
    label: 'MCP absolute timeout',
    defaultValue: 1_800_000,
    max: 86_400_000,
  },
] as const

/** Edits startup, inactivity and absolute deadlines independently. */
export function McpTimeouts({ item, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2 px-1">
      {settings.map(({ key, label, defaultValue, max }) => (
        <div key={key} className="flex items-center gap-1">
          <label className="text-muted-foreground flex flex-1 items-center justify-between gap-2 text-xs">
            {label} (ms)
            <Input
              type="number"
              aria-label={label}
              min={100}
              max={max}
              value={item[key] ?? ''}
              className="h-8 w-32 shrink-0 px-3 text-xs"
              onValueChange={(value) =>
                onChange({ [key]: value ? Number(value) : undefined })
              }
            />
          </label>
          <button
            type="button"
            aria-label={`Reset ${label} to default`}
            title={`Reset to ${defaultValue.toLocaleString()} ms`}
            disabled={item[key] === defaultValue}
            className="text-muted-foreground hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
            onClick={() => onChange({ [key]: defaultValue })}
          >
            <RotateCcwIcon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
