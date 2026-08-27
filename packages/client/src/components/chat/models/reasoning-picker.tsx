import { Select, type SelectTriggerProps, Switch } from '@/components/ui'
import { useBreakpoint } from '@/hooks'
import { normalizeReasoningEffort, useModelSettings } from '@/hooks/chat'
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
  /** Controlled mode: current reasoning effort. */
  value?: ReasoningEffort
  /** Controlled mode: called with the new reasoning effort. */
  onValueChange?: (value: ReasoningEffort) => void
  /** Controlled model whose reasoning capabilities should be rendered. */
  model?: UIModel | null
  /** Hide the label on mobile. */
  compactMobile?: boolean
  /** Optional text shown beside a binary reasoning switch. */
  binaryLabel?: string
}

export function ReasoningPicker({
  disabled,
  className,
  value: controlledValue,
  onValueChange: controlledOnChange,
  model: controlledModel,
  compactMobile,
  binaryLabel,
  ...props
}: ReasoningPickerProps) {
  const isMobile = useBreakpoint('sm') && !!compactMobile

  const {
    reasoningEffort: uncontrolledReasoning,
    setReasoningEffort: setUncontrolledReasoning,
    initialModel,
    model: uncontrolledModel,
  } = useModelSettings()

  const isControlled =
    controlledValue !== undefined || controlledOnChange !== undefined
  const model =
    controlledModel === undefined ? uncontrolledModel : controlledModel

  const reasoning = normalizeReasoningEffort(
    isControlled ? controlledValue : uncontrolledReasoning,
    model?.reasoning,
  )

  const setReasoning = isControlled
    ? (v: ReasoningEffort) => controlledOnChange?.(v)
    : setUncontrolledReasoning

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

  if (initialModel) {
    return null
  }

  if (model?.reasoning?.type === 'none') return null

  if (model?.reasoning?.type === 'binary') {
    const checked = reasoning !== 'none'
    return (
      <label
        className={cn(
          'text-muted-foreground flex items-center gap-2 text-sm',
          className,
        )}
      >
        {!isMobile && binaryLabel}
        <Switch
          size="sm"
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => setReasoning(next ? 'auto' : 'none')}
          aria-label="Enable reasoning"
        />
      </label>
    )
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
