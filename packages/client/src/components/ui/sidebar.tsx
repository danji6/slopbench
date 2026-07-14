import { useBreakpoint } from '@/hooks'
import { cn } from '@/lib/utils'
import { PanelLeftIcon, PanelRightIcon, PinIcon } from 'lucide-react'
import { motion } from 'motion/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Collapsible } from './collapsible'
import type { CollapsibleRootProps } from './collapsible'
import { Drawer } from './drawer'
import { RippleButton, type RippleButtonProps } from './ripple-button'
import { Surface } from './surface'

type SidebarContextValue = {
  side: 'left' | 'right'
  isMobile: boolean
  isOpen: boolean
  width: number
  toggle: () => void
  pinned: boolean
  togglePinned: () => void
  open: () => void
  close: (ignorePin?: boolean) => void
  rootRef: React.RefObject<HTMLDivElement | null>
}

type SidebarShellProps = React.ComponentProps<'div'>

type SidebarRootProps = {
  children?: React.ReactNode
  side?: 'left' | 'right'
  width?: number
  pinned?: boolean
  defaultPinned?: boolean
  onPinnedChange?: (pinned: boolean) => void
  defaultCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

type SidebarPanelProps = {
  children: React.ReactNode
  className?: string
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

type ShellRef = React.RefObject<HTMLDivElement | null>

const SidebarShellContext = createContext<ShellRef | null>(null)

type SidebarLayer = 'collapsed' | 'expanded'

const SidebarLayerContext = createContext<SidebarLayer | null>(null)

const STATE_LAYER_TRANSITION = {
  duration: 0,
  ease: 'easeInOut',
} as const

const STATE_LAYER_EXIT_TRANSITION = {
  duration: 0.2,
  ease: 'easeInOut',
} as const

const COLLAPSED_ENTER_TRANSITION = {
  duration: 0,
  ease: 'easeInOut',
} as const

function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('Must be used within SidebarRoot')
  return ctx
}

function useOptionalSidebar() {
  return useContext(SidebarContext)
}

function useLayerActive() {
  const { isOpen } = useSidebar()
  const layer = useContext(SidebarLayerContext)
  if (!layer) return true
  return layer === 'expanded' ? isOpen : !isOpen
}

/**
 * Compose example:
 *
 *   <Sidebar side="left" width={64}>
 *     <Sidebar.Panel>
 *       <Sidebar.Collapsed>
 *         <Sidebar.Header className="items-center">
 *           <Sidebar.Toggle />
 *         </Sidebar.Header>
 *         <Sidebar.Content className="items-center">
 *            ...
 *         </Sidebar.Content>
 *         <Sidebar.Footer className="items-center">
 *            ...
 *         </Sidebar.Footer>
 *       </Sidebar.Collapsed>
 *       <Sidebar.Expanded>
 *         <Sidebar.Header>
 *           <Sidebar.Toggle />
 *         </Sidebar.Header>
 *         <Sidebar.Content>
 *           <Sidebar.Section>...</Sidebar.Section>
 *         </Sidebar.Content>
 *         <Sidebar.Footer>...</Sidebar.Footer>
 *       </Sidebar.Expanded>
 *     </Sidebar.Panel>
 *   </Sidebar>
 *
 * Read state anywhere below the root with `useSidebar()`.
 */
function SidebarShell({ className, children, ...props }: SidebarShellProps) {
  const shellRef = useRef<HTMLDivElement>(null)

  return (
    <SidebarShellContext.Provider value={shellRef}>
      <div ref={shellRef} className={cn('flex flex-row', className)} {...props}>
        {children}
      </div>
    </SidebarShellContext.Provider>
  )
}

function SidebarRoot({
  side = 'left',
  pinned,
  defaultPinned = false,
  onPinnedChange,
  defaultCollapsed = true,
  onCollapsedChange,
  width = 64,
  children,
}: SidebarRootProps) {
  const isMobile = useBreakpoint('lg')
  const [isOpen, setIsOpen] = useState(!defaultCollapsed)
  const [internalPinned, setInternalPinned] = useState(defaultPinned)
  const localRef = useRef<HTMLDivElement>(null)
  const rootRef = useContext(SidebarShellContext) ?? localRef

  const isPinned = pinned !== undefined ? pinned : internalPinned

  const togglePinned = useCallback(() => {
    const next = !isPinned
    if (pinned === undefined) {
      setInternalPinned(next)
    }
    onPinnedChange?.(next)
  }, [isPinned, pinned, onPinnedChange])

  const open = useCallback(() => {
    setIsOpen(true)
    onCollapsedChange?.(false)
  }, [onCollapsedChange])

  const close = useCallback(
    (ignorePin?: boolean) => {
      if (!ignorePin && isPinned) return
      setIsOpen(false)
      onCollapsedChange?.(true)
    },
    [isPinned, onCollapsedChange],
  )

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      onCollapsedChange?.(!next)
      return next
    })
  }, [onCollapsedChange])

  return (
    <SidebarContext.Provider
      value={{
        side,
        isMobile,
        isOpen,
        width,
        pinned: isPinned,
        togglePinned,
        toggle,
        open,
        close,
        rootRef,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

function SidebarPanelInner({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full w-(--sidebar-width) shrink-0 flex-col">
      {children}
    </div>
  )
}

function SidebarPanelDesktop({
  isOpen,
  children,
  className,
}: SidebarPanelProps & { isOpen: boolean }) {
  const { side, close, rootRef, pinned, width } = useSidebar()
  const sidebarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen || pinned) return

    const listener = (event: MouseEvent | TouchEvent) => {
      const sidebar = sidebarRef.current
      const root = rootRef.current
      const target = event.target as Node

      if (!sidebar || !root) return
      if (sidebar.contains(target)) return

      // Don't close if clicking on another sidebar
      if ((target as HTMLElement).closest?.('[data-slot="sidebar-panel"]'))
        return

      if (root.contains(target)) close()
    }

    document.addEventListener('mousedown', listener)
    document.addEventListener('touchstart', listener)

    return () => {
      document.removeEventListener('mousedown', listener)
      document.removeEventListener('touchstart', listener)
    }
  }, [isOpen, close, rootRef, pinned])

  return (
    <Surface
      ref={sidebarRef}
      data-slot="sidebar-panel"
      data-side={side}
      data-collapsed={!isOpen}
      style={
        {
          '--sidebar-width': `calc(var(--spacing) * ${width})`,
        } as React.CSSProperties
      }
      className={cn(
        'sticky top-0 flex h-dvh shrink-0 flex-col self-start overflow-hidden rounded-none border-0 px-0 py-0 transition-[width,background-color] duration-200 ease-in-out',
        side === 'left' ? 'border-r' : 'border-l',
        !isOpen ? 'w-16 bg-transparent' : 'w-(--sidebar-width)',
        className,
      )}
    >
      <SidebarPanelInner>{children}</SidebarPanelInner>
    </Surface>
  )
}

function SidebarPanelMobile({
  isOpen,
  onClose,
  children,
  className,
}: SidebarPanelProps & {
  isOpen: boolean
  onClose: () => void
}) {
  const { side } = useSidebar()

  return (
    <Drawer.Root
      direction={side}
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
    >
      <Drawer.Content
        data-slot="sidebar-panel"
        data-collapsed={!isOpen}
        className={cn('flex flex-col pt-6', className)}
      >
        <SidebarPanelInner>{children}</SidebarPanelInner>
      </Drawer.Content>
    </Drawer.Root>
  )
}

function SidebarPanel({ children, className }: SidebarPanelProps) {
  const { isMobile, isOpen, close } = useSidebar()

  if (isMobile) {
    return (
      <SidebarPanelMobile isOpen={isOpen} onClose={close} className={className}>
        {children}
      </SidebarPanelMobile>
    )
  }

  return (
    <SidebarPanelDesktop isOpen={isOpen} className={className}>
      {children}
    </SidebarPanelDesktop>
  )
}

function SidebarExpanded({ children, className }: React.ComponentProps<'div'>) {
  const { isOpen, isMobile } = useSidebar()

  return (
    <motion.div
      data-slot="sidebar-expanded"
      inert={!isOpen}
      initial={false}
      animate={{
        opacity: isOpen ? 1 : 0,
        visibility: isOpen ? 'visible' : 'hidden',
      }}
      transition={isOpen ? STATE_LAYER_TRANSITION : STATE_LAYER_EXIT_TRANSITION}
      className={cn(
        'flex flex-col overflow-hidden',
        isMobile
          ? 'h-full w-full'
          : 'absolute inset-y-0 left-0 w-(--sidebar-width)',
        className,
      )}
    >
      <SidebarLayerContext.Provider value="expanded">
        {children}
      </SidebarLayerContext.Provider>
    </motion.div>
  )
}

function SidebarCollapsed({
  children,
  className,
}: React.ComponentProps<'div'>) {
  const { isOpen, isMobile } = useSidebar()

  if (isMobile) return null

  return (
    <motion.div
      data-slot="sidebar-collapsed"
      inert={isOpen}
      initial={false}
      animate={{
        opacity: isOpen ? 0 : 1,
        visibility: isOpen ? 'hidden' : 'visible',
      }}
      transition={
        isOpen ? STATE_LAYER_EXIT_TRANSITION : COLLAPSED_ENTER_TRANSITION
      }
      className={cn(
        'absolute inset-y-0 left-0 flex w-16 flex-col overflow-hidden',
        className,
      )}
    >
      <SidebarLayerContext.Provider value="collapsed">
        {children}
      </SidebarLayerContext.Provider>
    </motion.div>
  )
}

function SidebarItem({
  children,
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-item"
      className={cn(
        'flex w-full min-w-0 flex-col py-1 first:pt-2 last:pb-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function SidebarLabel({ children, className }: React.ComponentProps<'div'>) {
  return (
    <Sidebar.Item
      data-slot="sidebar-label"
      className={cn('font-bold lg:px-4', className)}
    >
      {children}
    </Sidebar.Item>
  )
}

type SidebarToggleProps = React.ComponentProps<'div'> &
  Pick<RippleButtonProps, 'variant' | 'size'>

function SidebarToggle({
  variant = 'stealth',
  size = 'icon',
  className,
  ...props
}: SidebarToggleProps) {
  const { toggle, isMobile, side, pinned, togglePinned, isOpen } = useSidebar()

  if (isMobile) return null

  const toggleButton = (
    <RippleButton
      onClick={toggle}
      variant={variant}
      size={size}
      className={className}
    >
      {side === 'left' ? <PanelLeftIcon /> : <PanelRightIcon />}
    </RippleButton>
  )

  if (!isOpen) {
    return (
      <Sidebar.Item data-slot="sidebar-toggle" className="w-auto" {...props}>
        {toggleButton}
      </Sidebar.Item>
    )
  }

  return (
    <Sidebar.Item data-slot="sidebar-toggle" {...props}>
      <div
        className={cn(
          'mb-1 flex items-center justify-between',
          side === 'right' && 'flex-row-reverse',
        )}
      >
        <RippleButton
          onClick={togglePinned}
          variant="stealth"
          size="icon"
          className={cn(
            'size-9 opacity-50 hover:opacity-100',
            pinned && 'text-primary opacity-100',
          )}
        >
          <PinIcon
            className={cn(
              'transition-transform',
              pinned && (side === 'left' ? 'rotate-45' : '-rotate-45'),
            )}
          />
        </RippleButton>
        {toggleButton}
      </div>
    </Sidebar.Item>
  )
}

function SidebarSection({
  label,
  children,
  className,
  ...props
}: CollapsibleRootProps & {
  label?: string
}) {
  return (
    <Collapsible
      defaultOpen
      className={cn('flex flex-col', className)}
      {...props}
    >
      <Collapsible.Trigger className="bg-m3-surface-container mx-0 w-full shrink-0 overflow-hidden border-x-0! font-bold whitespace-nowrap">
        {label}
      </Collapsible.Trigger>
      <Collapsible.Content
        className={cn('flex flex-col gap-2 px-0', className)}
      >
        {children}
      </Collapsible.Content>
    </Collapsible>
  )
}

function SidebarHeader({ children, className }: React.ComponentProps<'div'>) {
  const active = useLayerActive()

  return (
    <div
      data-slot="sidebar-header"
      inert={!active}
      style={{ opacity: active ? undefined : 0 }}
      className={cn('flex w-full flex-col gap-2 px-2', className)}
    >
      {children}
    </div>
  )
}

function SidebarContent({ children, className }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        'flex min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto py-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

function SidebarFooter({ children, className }: React.ComponentProps<'div'>) {
  const active = useLayerActive()

  return (
    <div
      data-slot="sidebar-footer"
      inert={!active}
      style={{ opacity: active ? undefined : 0 }}
      className={cn('mt-auto flex w-full flex-col gap-2 px-2 pb-2', className)}
    >
      {children}
    </div>
  )
}

export const Sidebar = Object.assign(SidebarRoot, {
  Shell: SidebarShell,
  Panel: SidebarPanel,
  Collapsed: SidebarCollapsed,
  Expanded: SidebarExpanded,
  Header: SidebarHeader,
  Content: SidebarContent,
  Footer: SidebarFooter,
  Item: SidebarItem,
  Label: SidebarLabel,
  Toggle: SidebarToggle,
  Section: SidebarSection,
})

export { useSidebar, useOptionalSidebar }

export type {
  SidebarRootProps,
  SidebarShellProps,
  SidebarPanelProps as SidebarContentProps,
}
