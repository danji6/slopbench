import { Select, type SelectTriggerProps } from '@/components/ui'
import { useBreakpoint } from '@/hooks'
import { useModelSettings } from '@/hooks/chat'
import type { ReasoningEffort } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { BrainIcon } from 'lucide-react'
import { useMemo } from 'react'

const REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export type ReasoningPickerProps = SelectTriggerProps & {
  /** Controlled mode: current reasoning effort */
  value?: ReasoningEffort
  /** Controlled mode: called with the new reasoning effort */
  onValueChange?: (value: ReasoningEffort) => void
  /** Hide the label on mobile */
  compactMobile?: boolean
}

export function ReasoningPicker({
  disabled,
  className,
  value: controlledValue,
  onValueChange: controlledOnChange,
  compactMobile,
  ...props
}: ReasoningPickerProps) {
  const isMobile = useBreakpoint('sm') && !!compactMobile

  const {
    reasoningEffort: uncontrolledReasoning,
    setReasoningEffort: setUncontrolledReasoning,
    initialModel,
  } = useModelSettings()

  const isControlled =
    controlledValue !== undefined || controlledOnChange !== undefined

  const reasoning = isControlled ? controlledValue : uncontrolledReasoning

  const setReasoning = isControlled
    ? (v: ReasoningEffort) => controlledOnChange?.(v)
    : setUncontrolledReasoning

  const { items, selectedLabel } = useMemo(
    () => ({
      items: REASONING_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
      })),
      selectedLabel: REASONING_OPTIONS.find(
        (o) => o.value === (reasoning ?? 'auto'),
      )?.label,
    }),
    [reasoning],
  )

  if (initialModel) {
    return null
  }

  return (
    <Select
      items={items}
      value={reasoning ?? 'auto'}
      onValueChange={(value) => setReasoning(value as ReasoningEffort)}
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
