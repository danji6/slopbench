import { TooltipButton, type TooltipButtonProps } from '@/components/ui'

export function MenuButton(props: TooltipButtonProps) {
  return (
    <TooltipButton
      variant="stealth"
      size="icon"
      tooltipSide="top"
      className="size-8 rounded-full"
      {...props}
    />
  )
}
