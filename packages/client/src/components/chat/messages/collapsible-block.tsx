import { Accordion, Button } from '@/components/ui'
import { Collapsible, useCollapsible } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'

import { useGrowOnly } from './grow-only'
import { useMessageList } from './message-list/message-list-context'
import { useScrollIntoView } from './scroll-into-view'

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
  /** Scroll the block into view whenever it opens. Disable to reveal only via `reveal`. */
  revealOnOpen?: boolean
  /** Adds a Surface-like border and background while expanded. */
  surface?: boolean
  /** Compact header height and no outer margin, for stacking inside a group. */
  dense?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  fullWidth?: boolean
  footer?: React.ReactNode
  onExpand?: () => void
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
  labelClassName,
  floatingChevron,
  onLabelClick,
  children,
  ...rest
}: CollapsibleBlockProps) {
  const blockRef = useRef<HTMLDivElement>(null)
  const messageList = useMessageList()
  const bottomPadding = messageList?.bottomPadding ?? 0
  const topPadding = messageList?.topPadding ?? 0

  useScrollIntoView({
    active: reveal,
    blockRef,
    scrollRef: messageList?.scrollRef,
    onBeforeScroll: messageList?.releaseFollow,
    bottomPadding,
    topPadding,
  })

  const rowMinH = dense ? 'min-h-7' : 'min-h-9'

  const shellClassName = cn(
    'group has-focus-visible:ring-ring overflow-x-auto rounded-2xl border border-transparent transition-all has-focus-visible:ring-1 has-[[contenteditable]:focus]:ring-0',
    dense ? 'mb-0' : 'mb-2',
    fullWidth ? 'w-full' : 'w-fit max-w-full',
    surface &&
      'data-[open=true]:bg-m3-surface-container-low data-[open=true]:border-border',
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
          <div className={cn('flex items-center px-2.5', rowMinH)}>
            <Header
              leadingIcon={leadingIcon}
              label={label}
              shimmer={shimmer}
              dense={dense}
              labelClassName={labelClassName}
            />
            {actions}
          </div>
          {children}
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
            onOpenChange?.(next)
            messageList?.onLayoutChange()
            if (next) onExpand?.()
          }}
          data-full-width={fullWidth ? '' : undefined}
          className={shellClassName}
          {...rest}
        >
          <div
            className={cn('flex items-center px-2.5', rowMinH, open && 'pb-2')}
          >
            <Trigger
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
            scrollRef={messageList?.scrollRef}
            blockRef={blockRef}
            releaseFollow={messageList?.releaseFollow}
            revealOnOpen={revealOnOpen}
            bottomPadding={bottomPadding}
            topPadding={topPadding}
          >
            {children}
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
        dense ? 'min-h-7 py-1' : 'min-h-9 py-2',
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
      onClick={onLabelClick ?? (canExpand ? toggle : undefined)}
      className={cn(
        'flex min-w-0 shrink grow items-center justify-start gap-2 rounded-none text-left whitespace-normal focus-visible:ring-0',
        dense ? 'min-h-7 py-1' : 'min-h-9 py-2',
        floatingChevron && 'relative',
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
  children,
  scrollRef,
  blockRef,
  releaseFollow,
  revealOnOpen = true,
  bottomPadding = 0,
  topPadding = 0,
}: {
  children?: React.ReactNode
  scrollRef?: React.RefObject<HTMLElement | null>
  blockRef: React.RefObject<HTMLDivElement | null>
  releaseFollow?: () => void
  revealOnOpen?: boolean
  bottomPadding?: number
  topPadding?: number
}) {
  const { isOpen } = useCollapsible()
  const [present, setPresent] = useState(isOpen)
  const [expanded, setExpanded] = useState(isOpen)

  // Let the enclosing grow-only row shrink back as this block collapses
  const release = useGrowOnly()?.release
  const wasOpen = useRef(isOpen)
  useEffect(() => {
    if (wasOpen.current && !isOpen) release?.()
    wasOpen.current = isOpen
  }, [isOpen, release])

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
    scrollRef,
    onBeforeScroll: releaseFollow,
    bottomPadding,
    topPadding,
  })

  if (!present) return null

  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out',
        expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === 'grid-template-rows' &&
          !isOpen
        ) {
          setPresent(false)
        }
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
