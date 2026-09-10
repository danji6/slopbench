import { RippleButton, useOptionalSidebar } from '@/components/ui'
import type { RippleButtonProps } from '@/components/ui'
import { cn } from '@/lib/utils'
import { SquarePenIcon } from 'lucide-react'
import type { MouseEvent } from 'react'

export type SessionOptionsProps = Omit<
  RippleButtonProps,
  'variant' | 'size'
> & {
  collapsed?: boolean
}

export function NewSessionButton({
  collapsed,
  onClick,
  className,
  ...props
}: SessionOptionsProps) {
  const sidebar = useOptionalSidebar()

  function handleClick(ev: MouseEvent<HTMLButtonElement>) {
    onClick?.(ev)
    sidebar?.close()
  }

  return (
    <RippleButton
      variant={collapsed ? 'stealth' : 'outline'}
      size={collapsed ? 'icon' : 'sm'}
      onClick={handleClick}
      className={cn(
        collapsed
          ? 'text-muted-foreground'
          : 'focus-visible:border-ring h-11 w-full justify-center font-bold focus-visible:border focus-visible:ring-0',
        className,
      )}
      {...props}
    >
      <SquarePenIcon />
      {!collapsed && 'New Session'}
    </RippleButton>
  )
}
