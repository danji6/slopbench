import { Accordion, Button } from '@/components/ui'
import { Collapsible, useCollapsible } from '@/components/ui/collapsible'
import { useScrollIntoView } from '@/hooks/chat/scroll-into-view'
import { cn } from '@/lib/utils'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { useGrowOnly } from './grow-only'
import { useMessageList } from './message-list/message-list-context'

const TRIGGER_FOCUS =
  'has-[>div>[data-block-trigger]:focus-visible]:border-ring'

export type CollapsibleBlockProps = React.ComponentPropsWithoutRef<'div'> & {
  label: React.ReactNode
  leadingIcon?: React.ReactNode
  actions?: React.ReactNode
  canExpand?: boolean
  /** When false, the body is always shown and the header is non-interactive. */
  collapsible?: boolean
  /** Animate the label with a shimmer. */
  shimmer?: boolean
  /** When it turns true, scrolls the block into view above the dock. */
  reveal?: boolean
  /** Reveal on every open by default, or use 'manual' for header toggles only. */
  revealOnOpen?: boolean | 'manual'
  /** Inset surfaces pad header and body together; inset-row keeps collapsed row alignment. */
  surface?: boolean | 'inset' | 'inset-row'
  /** Compact header height and no outer margin, for stacking inside a group. */
  dense?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  fullWidth?: boolean
  footer?: React.ReactNode
  onExpand?: () => void
  headerClassName?: string
  triggerClassName?: string
  bodyClassName?: string
  labelClassName?: string
  /** Make the chevron icon absolutely positioned on the right. */
  floatingChevron?: boolean
  /** Replaces the expand toggle as the header click action (hides the chevron). */
  onLabelClick?: () => void
}

export function CollapsibleBlock({
  label,
  leadingIcon,
  actions,
  canExpand = true,
  collapsible = true,
  shimmer = false,
  reveal = false,
  revealOnOpen = true,
  surface = false,
  dense = false,
  defaultOpen = false,
  open,
  onOpenChange,
  fullWidth = false,
  footer,
  onExpand,
  className,
  headerClassName,
  triggerClassName,
  bodyClassName,
  labelClassName,
  floatingChevron,
  onLabelClick,
  children,
  ...rest
}: CollapsibleBlockProps) {
  const [openedManually, setOpenedManually] = useState(false)
  const blockRef = useRef<HTMLDivElement>(null)
  const contentId = useId()
  const messageList = useMessageList()
  const releaseHeight = useGrowOnly()?.release
  const revealExpansion = revealOnOpen === 'manual' ? openedManually : revealOnOpen // prettier-ignore

  if (open === false && openedManually) setOpenedManually(false)

  // Re-measure retained row heights when the header density changes.
  useLayoutEffect(() => {
    releaseHeight?.()
  }, [dense, releaseHeight])

  useScrollIntoView({
    active: reveal,
    blockRef,
  })

  const insetRow = surface === 'inset-row'
  const insetSurface = surface === 'inset' || insetRow
  const rowMinH = dense ? undefined : 'min-h-9'
  const body = children && (
    <div
      className={cn(
        collapsible ? 'chat-block-body' : 'chat-block-list',
        insetSurface && 'chat-block-body-inset',
        bodyClassName,
      )}
    >
      {children}
    </div>
  )

  const shellClassName = cn(
    'group overflow-x-auto rounded-none border border-transparent transition-all',
    TRIGGER_FOCUS,
    dense ? 'mb-0' : 'mb-2',
    fullWidth ? 'w-full' : 'w-fit max-w-full',
    surface &&
      'data-[open=true]:bg-m3-surface-container-low data-[open=true]:border-border rounded-2xl',
    insetSurface &&
      'chat-block-inset rounded-none data-[open=true]:rounded-(--work-surface-radius)',
    surface === 'inset' && 'border-0 data-[open=true]:border',
    insetRow && 'chat-block-inset-row',
    className,
  )

  if (!collapsible) {
    return (
      <>
        <div
          ref={blockRef}
          data-open="true"
          data-full-width={fullWidth ? '' : undefined}
          className={shellClassName}
          {...rest}
        >
          <div
            className={cn(
              'flex items-center px-(--work-body-padding)',
              rowMinH,
              insetSurface && 'p-0',
              headerClassName,
            )}
          >
            <Header
              leadingIcon={leadingIcon}
              label={label}
              shimmer={shimmer}
              dense={dense}
              labelClassName={labelClassName}
            />
            {actions}
          </div>
          {body}
        </div>
        {footer}
      </>
    )
  }

  return (
    <>
      <div ref={blockRef}>
        <Collapsible
          defaultOpen={defaultOpen}
          open={open}
          onOpenChange={(next) => {
            messageList?.onLayoutChange()
            if (revealOnOpen === 'manual') setOpenedManually(next)
            onOpenChange?.(next)
            if (next) onExpand?.()
          }}
          data-full-width={fullWidth ? '' : undefined}
          className={shellClassName}
          {...rest}
        >
          <div
            className={cn(
              'flex items-center px-(--work-body-padding)',
              rowMinH,
              insetSurface && 'p-0',
              open && 'chat-block-header-expanded',
              headerClassName,
            )}
          >
            <Trigger
              className={cn(
                insetSurface &&
                  'py-0 focus-visible:ring-1 focus-visible:ring-inset',
                insetRow && 'py-(--work-header-padding-y)',
                triggerClassName,
              )}
              contentId={contentId}
              leadingIcon={leadingIcon}
              label={label}
              canExpand={canExpand}
              shimmer={shimmer}
              dense={dense}
              labelClassName={labelClassName}
              floatingChevron={floatingChevron}
              onLabelClick={onLabelClick}
            />
            {actions}
          </div>
          <Content
            id={contentId}
            blockRef={blockRef}
            revealOnOpen={revealExpansion}
          >
            {body}
          </Content>
        </Collapsible>
      </div>
      {footer}
    </>
  )
}

type LabelProps = {
  leadingIcon?: React.ReactNode
  label: React.ReactNode
  shimmer?: boolean
  className?: string
}

function Label({ leadingIcon, label, shimmer, className }: LabelProps) {
  return (
    <>
      {leadingIcon}
      <span
        className={cn(
          'min-w-0 text-xs wrap-anywhere',
          shimmer ? 'text-shimmer' : 'text-muted-foreground',
          className,
        )}
      >
        {label}
      </span>
    </>
  )
}

function Header({
  leadingIcon,
  label,
  shimmer,
  dense,
  labelClassName,
}: {
  leadingIcon?: React.ReactNode
  label: React.ReactNode
  shimmer?: boolean
  dense?: boolean
  labelClassName?: string
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 grow items-center gap-2',
        dense ? 'chat-work-header' : 'min-h-9 py-2',
      )}
    >
      <Label
        leadingIcon={leadingIcon}
        label={label}
        shimmer={shimmer}
        className={labelClassName}
      />
    </div>
  )
}

type TriggerProps = {
  className?: string
  contentId: string
  leadingIcon?: React.ReactNode
  label: React.ReactNode
  canExpand: boolean
  shimmer?: boolean
  dense?: boolean
  labelClassName?: string
  floatingChevron?: boolean
  onLabelClick?: () => void
}

function Trigger({
  className,
  contentId,
  leadingIcon,
  label,
  canExpand,
  shimmer,
  dense,
  labelClassName,
  floatingChevron,
  onLabelClick,
}: TriggerProps) {
  const { isOpen, toggle } = useCollapsible()
  const showChevron = canExpand && !onLabelClick

  return (
    <Button
      variant="plain"
      size={null}
      data-block-trigger=""
      aria-expanded={showChevron ? isOpen : undefined}
      aria-controls={showChevron ? contentId : undefined}
      onClick={onLabelClick ?? (canExpand ? toggle : undefined)}
      className={cn(
        'flex min-w-0 shrink grow items-center justify-start gap-2 rounded-none text-left whitespace-normal focus-visible:ring-0',
        dense ? 'chat-work-header' : 'min-h-9 py-2',
        floatingChevron && 'relative',
        className,
      )}
    >
      <Label
        leadingIcon={leadingIcon}
        label={label}
        shimmer={shimmer}
        className={labelClassName}
      />
      {showChevron && (
        <Accordion.Icon
          isExpanded={isOpen}
          className={cn(
            'text-muted-foreground shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
            floatingChevron && 'absolute right-1',
          )}
        />
      )}
    </Button>
  )
}

function Content({
  id,
  children,
  blockRef,
  revealOnOpen = true,
}: {
  id: string
  children?: React.ReactNode
  blockRef: React.RefObject<HTMLDivElement | null>
  revealOnOpen?: boolean
}) {
  const { isOpen } = useCollapsible()
  const contentRef = useRef<HTMLDivElement>(null)
  const [present, setPresent] = useState(isOpen)
  const [expanded, setExpanded] = useState(isOpen)
  const beginShrink = useGrowOnly()?.beginShrink

  useLayoutEffect(() => {
    if (isOpen || !present) return
    const finishShrink = beginShrink?.()
    let cancelled = false
    const animations = contentRef.current?.getAnimations() ?? []
    void Promise.allSettled(
      animations.map((animation) => animation.finished),
    ).then(() => {
      if (!cancelled) setPresent(false)
    })
    return () => {
      cancelled = true
      finishShrink?.()
    }
  }, [isOpen, present, beginShrink])

  if (isOpen && !present) setPresent(true)
  if (!isOpen && expanded) setExpanded(false)

  useEffect(() => {
    if (!isOpen) return
    const frame = requestAnimationFrame(() => setExpanded(true))
    return () => cancelAnimationFrame(frame)
  }, [isOpen])

  useScrollIntoView({
    active: isOpen && revealOnOpen,
    blockRef,
  })

  if (!present) return null

  return (
    <div
      ref={contentRef}
      id={id}
      inert={!isOpen}
      aria-hidden={!isOpen || undefined}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none',
        expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
