import { cn } from '@/lib/utils'
import { Collapsible } from '@base-ui/react/collapsible'
import { EyeOffIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type SpoilerProps = {
  children: ReactNode
  label?: string
}

/** Conceals inline content until the user reveals it. */
export function Spoiler({ children, label = 'spoiler' }: SpoilerProps) {
  return (
    <Collapsible.Root render={<span />} className="wrap-anywhere">
      <Collapsible.Trigger
        nativeButton={false}
        render={(props, { open }) => (
          <span
            {...props}
            aria-label={`${open ? 'Hide' : 'Reveal'} ${label}`}
            className={cn(
              'focus-visible:outline-ring cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2',
              open
                ? 'text-muted-foreground hover:text-foreground inline-flex align-middle'
                : 'bg-muted-foreground/40 hover:bg-muted-foreground/55 box-decoration-clone px-0.5',
            )}
          >
            {open ? (
              <EyeOffIcon aria-hidden className="size-3.5" />
            ) : (
              <span inert aria-hidden className="opacity-0">
                {children}
              </span>
            )}
          </span>
        )}
      />
      <Collapsible.Panel render={<span />} className="ms-1.5">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
