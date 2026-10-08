import { RippleButton } from '@/components/ui/ripple-button'
import { SettingsList } from '@/components/ui/settings-list'
import { Switch } from '@/components/ui/switch'
import { RotateCcwIcon } from 'lucide-react'

import { OverrideLabel } from './agent/override-section'

export const CODE_BLOCK_SETTINGS = [
  { name: 'codeBlockHighlighting', label: 'Show block highlighting' },
  { name: 'codeBlockLineNumbers', label: 'Code block line numbers' },
] as const

type CodeBlockSettingProps = {
  label: string
  value: boolean | null
  inheritedValue?: boolean
  onChange: (value: boolean | null) => void
}

/** Displays a code block preference with an optional reset to the user's value. */
export function CodeBlockSetting({
  label,
  value,
  inheritedValue,
  onChange,
}: CodeBlockSettingProps) {
  const overridable = inheritedValue !== undefined
  const checked = value ?? inheritedValue ?? true

  return (
    <SettingsList.Item
      label={overridable ? <OverrideLabel>{label}</OverrideLabel> : label}
      description={
        overridable && value == null ? 'Using your user setting.' : undefined
      }
      onClick={() => onChange(!checked)}
    >
      <div className="flex items-center gap-2">
        {overridable && value != null && (
          <RippleButton
            variant="stealth"
            size="icon-sm"
            title="Use user setting"
            aria-label={`Use user setting for ${label.toLowerCase()}`}
            onClick={(event) => {
              event.stopPropagation()
              onChange(null)
            }}
          >
            <RotateCcwIcon className="size-4" />
          </RippleButton>
        )}
        <Switch
          checked={checked}
          aria-label={label}
          onCheckedChange={onChange}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </SettingsList.Item>
  )
}
