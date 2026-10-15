import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type AnimatedSessionRowProps = {
  closing: boolean
  opening: boolean
  children: ReactNode
}

/** Animates each row's measured height without replacing list virtualization. */
export function AnimatedSessionRow({
  closing,
  opening,
  children,
}: AnimatedSessionRowProps) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none',
        closing ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
        opening && 'starting:grid-rows-[0fr] starting:opacity-0',
      )}
      inert={closing}
      aria-hidden={closing || undefined}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
