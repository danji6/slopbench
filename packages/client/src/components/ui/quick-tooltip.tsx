import { Tooltip } from './tooltip'

export type QuickTooltipProps = {
  text: string
  side?: 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start'
  delay?: number
  className?: string
  children?: React.ReactElement
}

export function QuickTooltip({
  text,
  side = 'top',
  delay = 200,
  className,
  children,
}: QuickTooltipProps) {
  return (
    <Tooltip>
      <Tooltip.Trigger render={children} delay={delay} />
      <Tooltip.Content side={side} className={className}>
        {text}
      </Tooltip.Content>
    </Tooltip>
  )
}
