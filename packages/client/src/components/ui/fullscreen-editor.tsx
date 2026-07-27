import { createUsableContext } from '@/hooks/context'
import type { FullscreenHandle } from '@/hooks/fullscreen'
import { useFullscreenView } from '@/hooks/fullscreen'
import { getFocusReturnTarget } from '@/lib/focus-return'
import type { HostFocus } from '@/lib/reparent'
import { hostBox, moveHost, trackHostFocus } from '@/lib/reparent'
import { cn } from '@/lib/utils'
import { ArrowLeftIcon, Maximize2Icon } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Dialog } from './dialog'
import { RippleButton } from './ripple-button'

const [FullscreenContext, useFullscreen] =
  createUsableContext<FullscreenHandle>('Fullscreen')

/** Frees a wrapped surface from its size limits. */
export const fullscreenFill =
  'group-data-[fullscreen]/fullscreen:max-h-none group-data-[fullscreen]/fullscreen:min-h-0 group-data-[fullscreen]/fullscreen:flex-1'

/** Turns a block into a column that fills the leftover height. */
export const fullscreenGrow =
  'group-data-[fullscreen]/fullscreen:flex group-data-[fullscreen]/fullscreen:min-h-0 group-data-[fullscreen]/fullscreen:flex-1 group-data-[fullscreen]/fullscreen:flex-col'

export type FullscreenEditorProps = {
  /** Stable id for this editor in the `?view=` path. */
  id: string
  /** The editor surface, which must render a single positioned box. */
  children: React.ReactNode
}

/**
 * Expands the editor surface it wraps to fill the browser window. The content
 * is moved rather than remounted to preserve its state.
 */
export function FullscreenEditor({ id, children }: FullscreenEditorProps) {
  const handle = useFullscreenView(id)
  const { active } = handle

  const [host] = useState(createHost)
  const inlineRef = useRef<HTMLDivElement | null>(null)
  const focusRef = useRef<HostFocus>(null)

  const [overlaySlot, setOverlaySlot] = useState<HTMLDivElement | null>(null)

  const attachInline = useCallback(
    (node: HTMLDivElement | null) => {
      inlineRef.current = node
      if (node && !host.parentElement) node.appendChild(host)
    },
    [host],
  )

  useLayoutEffect(() => {
    const focus = trackHostFocus(host)
    focusRef.current = focus
    return () => {
      focusRef.current = null
      focus.stop()
    }
  }, [host])

  useLayoutEffect(() => {
    const inline = inlineRef.current
    const slot = active ? overlaySlot : inline
    if (!inline || !slot) return

    // Empty spacing where the inline content was
    inline.style.height = active ? `${hostBox(host)?.offsetHeight ?? 0}px` : ''

    moveHost(host, slot)
    focusRef.current?.restore()
  }, [active, host, overlaySlot])

  return (
    <>
      <div
        data-slot="fullscreen-inline"
        ref={attachInline}
        className={active ? 'block' : 'contents'}
      />
      {createPortal(
        <div
          className="group/fullscreen contents"
          data-fullscreen={active || undefined}
        >
          <FullscreenContext value={handle}>{children}</FullscreenContext>
        </div>,
        host,
      )}
      {active && (
        <Dialog open onOpenChange={(open) => !open && handle.exit()}>
          <Dialog.Content
            aria-label="Expanded editor"
            showCloseButton={false}
            finalFocus={() =>
              focusRef.current?.target() ?? getFocusReturnTarget()
            }
            className="inset-0 z-51 flex h-svh w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 p-0"
          >
            <div
              ref={setOverlaySlot}
              data-slot="fullscreen-overlay"
              className="flex min-h-0 flex-1 flex-col overflow-hidden p-3"
            />
          </Dialog.Content>
        </Dialog>
      )}
    </>
  )
}

export type FullscreenToolbarProps = {
  /** Extra controls, rendered left of the expand/collapse button. */
  children?: React.ReactNode
  /** Class for the toolbar box (offsets). */
  className?: string
}

function FullscreenToolbar({ children, className }: FullscreenToolbarProps) {
  return (
    <div
      data-slot="fullscreen-toolbar"
      className={cn(
        'pointer-events-none sticky top-0 z-10 h-0',
        'group-data-fullscreen/fullscreen:h-auto group-data-fullscreen/fullscreen:p-2',
        className,
      )}
    >
      <div
        className={cn(
          'flex justify-end gap-1 p-1.5 opacity-0 transition-opacity *:pointer-events-auto',
          'group-focus-within/fullscreen:opacity-100 group-hover/fullscreen:opacity-100 pointer-coarse:opacity-100',
          'group-data-fullscreen/fullscreen:bg-m3-surface-container group-data-fullscreen/fullscreen:pointer-events-auto group-data-fullscreen/fullscreen:rounded-full group-data-fullscreen/fullscreen:opacity-100',
          'group-data-fullscreen/fullscreen:supports-backdrop-filter:bg-m3-surface-container/85 group-data-fullscreen/fullscreen:supports-backdrop-filter:backdrop-blur-md',
        )}
      >
        {children}
        <FullscreenToggle />
      </div>
    </div>
  )
}

function FullscreenToggle() {
  const { active, toggle } = useFullscreen()
  const label = active ? 'Back' : 'Full screen'

  return (
    <RippleButton
      data-slot="fullscreen-toggle"
      variant="stealth"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={toggle}
      className={cn(
        'bg-m3-surface-container-low/70 supports-backdrop-filter:backdrop-blur-md',
        'group-data-fullscreen/fullscreen:order-first group-data-fullscreen/fullscreen:mr-auto group-data-fullscreen/fullscreen:bg-transparent',
      )}
    >
      {active ? <ArrowLeftIcon /> : <Maximize2Icon />}
    </RippleButton>
  )
}

FullscreenEditor.Toolbar = FullscreenToolbar

function createHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.dataset.slot = 'fullscreen-host'
  host.style.display = 'contents'
  return host
}
