import { Select, type SelectTriggerProps, Switch } from '@/components/ui'
import { useBreakpoint } from '@/hooks'
import { normalizeReasoningEffort } from '@/hooks/chat'
import type { ReasoningEffort, UIModel } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { BrainIcon } from 'lucide-react'

const REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
]

export type ReasoningPickerProps = SelectTriggerProps & {
  value: ReasoningEffort
  onValueChange: (value: ReasoningEffort) => void
  model: UIModel | null
  /** Hide the label on mobile. */
  compactMobile?: boolean
}

export function ReasoningPicker({
  disabled,
  className,
  value,
  onValueChange,
  model,
  compactMobile,
  ...props
}: ReasoningPickerProps) {
  const isMobile = useBreakpoint('sm') && !!compactMobile

  const reasoning = normalizeReasoningEffort(value, model?.reasoning)

  const supported =
    model?.reasoning?.type === 'effort'
      ? new Set(model.reasoning.efforts)
      : new Set(['low', 'medium', 'high'])
  const options = REASONING_OPTIONS.filter(
    (option) =>
      option.value === 'auto' ||
      option.value === 'none' ||
      supported.has(option.value),
  )
  const items = options.map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const selectedLabel = options.find(
    (option) => option.value === (reasoning ?? 'auto'),
  )?.label

  if (model?.reasoning?.type === 'none') return null

  if (model?.reasoning?.type === 'binary') {
    const checked = reasoning !== 'none'
    return (
      <div className="flex w-full pl-2.5">
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onValueChange(next ? 'auto' : 'none')}
          aria-label="Enable reasoning"
        />
      </div>
    )
  }

  return (
    <Select
      items={items}
      value={reasoning ?? 'auto'}
      onValueChange={(value) => onValueChange(value as ReasoningEffort)}
      disabled={disabled}
    >
      <Select.Trigger
        size={isMobile ? 'icon' : 'default'}
        className={cn('text-muted-foreground', className)}
        aria-label="Select reasoning effort"
        {...props}
      >
        <BrainIcon />
        {!isMobile && selectedLabel}
      </Select.Trigger>
      <Select.Content
        alignItemWithTrigger={false}
        className="w-[calc(min(fit-content,100%,120px))]"
      >
        <Select.Group>
          <Select.Label>Reasoning effort</Select.Label>
          {items.map((item) => (
            <Select.Item key={item.value} value={item.value}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Group>
      </Select.Content>
    </Select>
  )
}
