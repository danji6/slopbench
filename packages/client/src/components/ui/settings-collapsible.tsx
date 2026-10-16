import { cn } from '@/lib/utils'
import { useId } from 'react'

import { Accordion } from './accordion'
import {
  Collapsible,
  type CollapsibleRootProps,
  useCollapsible,
} from './collapsible'
import { RippleButton } from './ripple-button'

type SettingsCollapsibleProps = CollapsibleRootProps & {
  label: React.ReactNode
  actions?: React.ReactNode
  disabled?: boolean
  labelClassName?: string
  contentClassName?: string
  unmountOnClose?: boolean
  variant?: 'default' | 'compact'
}

/** Shares the bordered surface and expandable header used by settings cards. */
export function SettingsCollapsible({
  label,
  actions,
  disabled,
  labelClassName,
  contentClassName,
  unmountOnClose,
  variant = 'default',
  className,
  children,
  ...props
}: SettingsCollapsibleProps) {
  const contentId = useId()
  const compact = variant === 'compact'

  return (
    <Collapsible
      className={cn(
        'bg-m3-surface-container-low border-input w-full rounded-2xl border',
        compact && 'bg-background/40 rounded-lg',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'grid min-w-0 items-center',
          compact ? 'gap-1' : 'gap-4',
          actions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
        )}
      >
        <h3 className="col-span-full row-start-1 grid min-w-0 grid-cols-subgrid">
          <SettingsCollapsibleTrigger
            contentId={contentId}
            disabled={disabled}
            labelClassName={labelClassName}
            compact={compact}
          >
            {label}
          </SettingsCollapsibleTrigger>
        </h3>
        {actions && (
          <div
            className={cn(
              'relative z-10 col-start-2 row-start-1 flex items-center gap-4 py-1',
              compact ? 'pr-1' : 'pr-2',
            )}
          >
            {actions}
          </div>
        )}
      </div>
      <Collapsible.Content
        id={contentId}
        className={contentClassName}
        unmountOnClose={unmountOnClose}
      >
        {children}
      </Collapsible.Content>
    </Collapsible>
  )
}

type SettingsCollapsibleTriggerProps = {
  contentId: string
  disabled?: boolean
  labelClassName?: string
  children: React.ReactNode
  compact: boolean
}

function SettingsCollapsibleTrigger({
  contentId,
  disabled,
  labelClassName,
  children,
  compact,
}: SettingsCollapsibleTriggerProps) {
  const { isOpen, toggle } = useCollapsible()

  return (
    <RippleButton
      variant="stealth"
      data-slot="collapsible-trigger"
      aria-expanded={isOpen}
      aria-controls={contentId}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        'col-span-full grid w-full min-w-0 grid-cols-subgrid text-left aria-expanded:rounded-b-none',
        compact ? 'h-12 rounded-lg px-3' : 'h-11 rounded-2xl px-2',
      )}
    >
      <span
        className={cn('flex min-w-0 items-center', compact ? 'gap-2' : 'gap-4')}
      >
        <span
          className={cn(
            'flex shrink-0 items-center justify-center',
            compact ? 'order-last ml-auto size-4' : 'size-8',
          )}
        >
          <Accordion.Icon
            isExpanded={isOpen}
            className="text-muted-foreground size-4"
          />
        </span>
        <span
          className={cn(
            'truncate font-semibold',
            compact ? 'text-sm' : 'text-md',
            labelClassName,
          )}
        >
          {children}
        </span>
      </span>
    </RippleButton>
  )
}
