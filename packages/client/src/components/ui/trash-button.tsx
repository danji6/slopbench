import { cn } from '@/lib/utils'
import { Trash2Icon } from 'lucide-react'

import { RippleButton, type RippleButtonProps } from './ripple-button'

export type TrashButtonProps = Omit<RippleButtonProps, 'children'>

export function TrashButton({ className, ...props }: TrashButtonProps) {
  return (
    <RippleButton
      variant="stealth"
      size="icon"
      aria-label="Remove"
      {...props}
      className={cn('text-muted-foreground hover:text-destructive', className)}
    >
      <Trash2Icon />
    </RippleButton>
  )
}
