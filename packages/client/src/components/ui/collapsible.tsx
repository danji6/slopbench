import { cn } from '@/lib/utils'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

import { Accordion } from './accordion'
import { RippleButton, type RippleButtonProps } from './ripple-button'

type CollapsibleContextValue = {
  isOpen: boolean
  toggle: () => void
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null)

function useCollapsible() {
  const ctx = useContext(CollapsibleContext)
  if (!ctx)
    throw new Error(
      'Collapsible components must be used within CollapsibleRoot',
    )
  return ctx
}

type CollapsibleRootProps = React.ComponentProps<'div'> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function CollapsibleRoot({
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  children,
  ...props
}: CollapsibleRootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const toggle = useCallback(() => {
    const next = !isOpen
    if (!isControlled) {
      setUncontrolledOpen(next)
    }
    onOpenChange?.(next)
  }, [isOpen, isControlled, onOpenChange])

  const value = useMemo(() => ({ isOpen, toggle }), [isOpen, toggle])

  return (
    <CollapsibleContext.Provider value={value}>
      <div
        data-slot="collapsible-root"
        data-open={isOpen}
        className={cn('flex flex-col rounded-xl', className)}
        {...props}
      >
        {children}
      </div>
    </CollapsibleContext.Provider>
  )
}

function CollapsibleTrigger({
  className,
  children,
  onClick,
  ...props
}: RippleButtonProps) {
  const { isOpen, toggle } = useCollapsible()

  return (
    <RippleButton
      variant="stealth"
      size="lg"
      data-slot="collapsible-trigger"
      className={cn(
        'focus-visible:border-ring hover:bg-m3-surface-container-high group/collapsible flex w-full items-center justify-between rounded-none border border-transparent font-bold transition-colors outline-none focus-visible:border focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      onClick={(e) => {
        toggle()
        onClick?.(e)
      }}
      {...props}
    >
      {children}
      <Accordion.Icon
        isExpanded={isOpen}
        className="text-muted-foreground group-hover/collapsible:text-foreground ml-auto transition-colors"
      />
    </RippleButton>
  )
}

type CollapsibleContentProps = React.ComponentProps<'div'> & {
  outerClassName?: string
}

function CollapsibleContent({
  className,
  outerClassName,
  children,
  ...props
}: CollapsibleContentProps) {
  const { isOpen } = useCollapsible()

  return (
    <div
      data-slot="collapsible-content"
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out',
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        outerClassName,
      )}
      style={{
        gridTemplateRows: isOpen ? '1fr' : '0fr',
      }}
      {...props}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn('flex flex-col gap-1.5 px-4 py-2 pt-1.5', className)}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export const Collapsible = Object.assign(CollapsibleRoot, {
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
})

export { useCollapsible }
export type { CollapsibleRootProps, CollapsibleContentProps }
