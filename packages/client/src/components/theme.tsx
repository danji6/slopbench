import { cn, debounce } from '@/lib/utils'
import { getFormat } from 'colord'
import { useEffect, useMemo, useState } from 'react'
import { HexColorPicker } from 'react-colorful'

import { Input, Popover, RippleButton } from './ui'
import { RefreshButton } from './ui/refresh-button'

type ColorInputRowProps = {
  value: string
  onColorChange: (color: string) => void
  onReset?: () => void
}

function ColorInputRow({ value, onColorChange, onReset }: ColorInputRowProps) {
  return (
    <div className="focus-within:ring-ring flex w-full max-w-50 rounded-full transition-shadow focus-within:ring-1">
      {onReset && (
        <RippleButton
          onClick={onReset}
          size="icon"
          className="size-11 shrink-0 rounded-l-full rounded-r-none pl-1"
        >
          ↩
        </RippleButton>
      )}
      <Input
        value={value}
        onChange={(e) => onColorChange(e.target.value)}
        className={cn(
          'w-full border-x-0 text-center focus-visible:ring-0',
          onReset ? 'rounded-none' : 'rounded-l-full rounded-r-none',
        )}
        data-vaul-no-drag
      />
      <RefreshButton
        onClick={() =>
          onColorChange(
            '#' +
              Math.floor(Math.random() * 0xffffff)
                .toString(16)
                .padStart(6, '0'),
          )
        }
        className="size-11 shrink-0 rounded-l-none rounded-r-full pr-1"
      />
    </div>
  )
}

type ThemeColorSettingProps = {
  value: string
  onChange: (color: string) => void
  onClear?: () => void
}

export function ThemeColorSetting({
  value,
  onChange,
  onClear,
}: ThemeColorSettingProps) {
  const [pickerColor, setPickerColor] = useState(value || '#6750a4')

  const emitColor = useMemo(() => debounce(onChange, 150), [onChange])
  useEffect(() => () => emitColor.cancel(), [emitColor])

  function handleColorPick(newColor: string) {
    setPickerColor(newColor)
    if (getFormat(newColor) === 'hex') {
      emitColor(newColor)
    }
  }

  const hasColor = !!(value && getFormat(value) === 'hex')

  return (
    <Popover>
      <Popover.Trigger
        render={
          <RippleButton
            variant="input"
            className="flex min-w-32 items-center pl-2 font-mono text-sm"
          />
        }
      >
        <span
          className={cn(
            'size-6 shrink-0 rounded-full border border-transparent',
            !hasColor && 'border-input',
          )}
          style={{ backgroundColor: hasColor ? value : 'var(--muted)' }}
        />
        <span
          className={cn(
            'text-s flex-1 text-center font-mono',
            !hasColor && 'text-muted-foreground',
          )}
        >
          {hasColor ? value : 'No color'}
        </span>
      </Popover.Trigger>
      <Popover.Content className="w-auto p-3" align="end">
        <HexColorPicker
          color={pickerColor}
          onChange={handleColorPick}
          suppressHydrationWarning
        />
        <div className="mt-2">
          <ColorInputRow
            value={pickerColor}
            onColorChange={handleColorPick}
            onReset={onClear}
          />
        </div>
      </Popover.Content>
    </Popover>
  )
}
