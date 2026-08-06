import { md } from '@/components/markdown'
import { Input, SettingsList } from '@/components/ui'

import { OverrideLabel } from './agent/override-section'

export function ShellSettings({
  value,
  onChange,
  override = false,
}: {
  value: string
  onChange: (value: string) => void
  /** Marks the field as an agent override of the user's value. */
  override?: boolean
}) {
  const label = <span className="font-semibold">Shell</span>

  return (
    <SettingsList>
      <SettingsList.Item
        label={override ? <OverrideLabel>{label}</OverrideLabel> : label}
        description={
          override
            ? 'A program name or a path. Empty uses your own setting.'
            : 'A program name or a path. Empty uses the system default.'
        }
        help={md`
          Configure this when you want to use a different shell than the system's
          default (bash on Linux and Mac, PowerShell on Windows).
        `}
        orientation="vertical"
        unclickable
        unhoverable
      >
        <Input
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder="bash"
          variant="outline"
          className="h-9 max-w-70 font-mono text-sm"
        />
      </SettingsList.Item>
    </SettingsList>
  )
}
