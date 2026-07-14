import { Tooltip } from './tooltip'

export type QuickTooltipProps = {
  text: string
  side?: 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start'
  delay?: number
  children?: React.ReactElement
}

export function QuickTooltip({
  text,
  side = 'top',
  delay = 200,
  children,
}: QuickTooltipProps) {
  return (
    <Tooltip>
      <Tooltip.Trigger render={children} delay={delay} />
      <Tooltip.Content side={side}>{text}</Tooltip.Content>
    </Tooltip>
  )
}
