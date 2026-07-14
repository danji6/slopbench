import { RippleButton } from '@/components/ui'
import type { RippleButtonProps } from '@/components/ui'
import { cn } from '@/lib/utils'
import { SquarePenIcon } from 'lucide-react'

export type SessionOptionsProps = Omit<
  RippleButtonProps,
  'variant' | 'size'
> & {
  collapsed?: boolean
}

export function NewSessionButton({
  collapsed,
  className,
  ...props
}: SessionOptionsProps) {
  return (
    <RippleButton
      variant={collapsed ? 'stealth' : 'outline'}
      size={collapsed ? 'icon' : 'sm'}
      className={cn(
        !collapsed &&
          'focus-visible:border-ring h-11 w-full justify-center font-bold focus-visible:border focus-visible:ring-0',
        className,
      )}
      {...props}
    >
      <SquarePenIcon />
      {!collapsed && 'New Session'}
    </RippleButton>
  )
}
