import { RippleButton, WavyProgressCircle } from '@/components/ui'
import { noteExpansion } from '@/lib/chat/note-state'
import type { RowTransition } from '@/lib/chat/row-expansion-state'
import type { MessageRow } from '@/lib/chat/rows'
import { shiftsOnlyAtStart } from '@/lib/chat/window-row-shift'
import { workExpansion } from '@/lib/chat/work-state'
import { AnimatePresence, motion } from 'motion/react'
import {
  type CSSProperties,
  Fragment,
  type ReactElement,
  type ReactNode,
  type RefObject,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  type CustomItemComponentProps,
  WindowVirtualizer,
  type WindowVirtualizerHandle,
} from 'virtua'

import { EmptyMessage } from '../../empty-message'
import {
  VirtualizedRowTransition,
  useRowTransitions,
} from '../virtualized-row-transition'

const CONTENT_FADE_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const

const VirtualizedRowsContext = createContext<readonly MessageRow[]>([])
const RowTransitionsContext = createContext<ReadonlyMap<string, RowTransition>>(
  new Map(),
)

export type OverlayInset = { top: number; bottom: number }

type MessageListContentProps = {
  /** Whether the list has finished positioning and may fade into view. */
  revealed: boolean
  isEmpty: boolean
  showLoadingIndicator: boolean
  /** Viewport insets the loading overlay has to stay clear of. */
  overlayInset: OverlayInset
  emptyStyle?: CSSProperties
  messages: MessageRowsProps
}

export function MessageListContent({
  revealed,
  isEmpty,
  showLoadingIndicator,
  overlayInset,
  emptyStyle,
  messages,
}: MessageListContentProps) {
  if (isEmpty) {
    return (
      <ContentFade className="flex flex-1 flex-col justify-center">
        <EmptyMessage style={emptyStyle} />
      </ContentFade>
    )
  }

  return (
    <>
      <AnimatePresence>
        {!revealed && (
          <LoadingOverlay
            key="loading"
            showIndicator={showLoadingIndicator}
            inset={overlayInset}
          />
        )}
      </AnimatePresence>
      <motion.div
        // Query container for the avatar gutter
        className="@container w-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 1 : 0 }}
        transition={CONTENT_FADE_TRANSITION}
      >
        <MessageRows {...messages} />
      </motion.div>
    </>
  )
}

/** Enables frame-dependent cross-fade animation that would otherwise be skipped. */
function ContentFade({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  const [enter, setEnter] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: enter ? 1 : 0 }}
      exit={{ opacity: 0 }}
      transition={CONTENT_FADE_TRANSITION}
    >
      {children}
    </motion.div>
  )
}

type LoadingOverlayProps = {
  showIndicator: boolean
  inset: OverlayInset
}

/**
 * Loading overlay shown while the list positions itself, centered in the band
 * of viewport the list is visible through.
 */
function LoadingOverlay({ showIndicator, inset }: LoadingOverlayProps) {
  return (
    <motion.div
      className="pointer-events-none sticky z-10 h-0"
      style={{ top: inset.top }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={CONTENT_FADE_TRANSITION}
    >
      <div
        className="absolute inset-x-0 flex items-center justify-center"
        style={{ height: `calc(100dvh - ${inset.top + inset.bottom}px)` }}
      >
        <AnimatePresence>
          {showIndicator && (
            <motion.div
              key="loading-indicator"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={CONTENT_FADE_TRANSITION}
            >
              <WavyProgressCircle size={64} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

type MessageRowsProps = {
  rows: readonly MessageRow[]
  hasHeaderContainer: boolean
  innerStyle?: CSSProperties
  topPadding?: number
  topPaddingStyle: CSSProperties
  header?: ReactNode
  hasMore: boolean
  isLoadingOlder?: boolean
  hasNewer: boolean
  /** Whether virtua should shift to preserve position. */
  shiftItems: boolean
  onLoadMore: () => void
  onLoadNewer: () => void
  renderRow: (row: MessageRow) => ReactElement
  virtuaRef: RefObject<WindowVirtualizerHandle | null>
}

function MessageRows({
  rows,
  hasHeaderContainer,
  innerStyle,
  topPadding,
  topPaddingStyle,
  header,
  hasMore,
  isLoadingOlder,
  hasNewer,
  shiftItems,
  onLoadMore,
  onLoadNewer,
  renderRow,
  virtuaRef,
}: MessageRowsProps) {
  const [layout, setLayout] = useState({ rows, shift: false })
  if (layout.rows !== rows) {
    setLayout({ rows, shift: shiftsOnlyAtStart(layout.rows, rows) })
  }
  const workTransitions = useRowTransitions(workExpansion)
  const noteTransitions = useRowTransitions(noteExpansion)
  const transitions = new Map([...workTransitions, ...noteTransitions])
  return (
    <>
      {hasHeaderContainer && (
        <div
          className="mx-auto w-full pb-8"
          style={{
            ...innerStyle,
            ...(topPadding && {
              paddingTop: `calc(var(--spacing)*${topPadding})`,
            }),
          }}
        >
          {!hasMore && header}
          {hasMore && (
            <LoadWindowButton
              onClick={onLoadMore}
              label="Load older messages"
              loading={isLoadingOlder}
            />
          )}
        </div>
      )}
      <div
        className="mx-auto"
        style={
          hasHeaderContainer
            ? innerStyle
            : { ...innerStyle, ...topPaddingStyle }
        }
      >
        <VirtualizedRowsContext value={rows}>
          <RowTransitionsContext value={transitions}>
            <WindowVirtualizer
              ref={virtuaRef}
              data={rows}
              item={VirtualizedItem}
              shift={shiftItems || layout.shift}
            >
              {(row) => <Fragment key={row.key}>{renderRow(row)}</Fragment>}
            </WindowVirtualizer>
          </RowTransitionsContext>
        </VirtualizedRowsContext>
      </div>
      {hasNewer && (
        <div className="mx-auto w-full pt-8" style={innerStyle}>
          <LoadWindowButton onClick={onLoadNewer} label="Load newer messages" />
        </div>
      )}
    </>
  )
}

function LoadWindowButton({
  onClick,
  label,
  loading = false,
}: {
  onClick: () => void
  label: string
  loading?: boolean
}) {
  return (
    <div className="flex justify-center">
      <RippleButton
        variant="input"
        onClick={onClick}
        disabled={loading}
        aria-busy={loading}
        data-load-older={label === 'Load older messages' ? '' : undefined}
      >
        {loading && <WavyProgressCircle size={16} />}
        {label}
      </RippleButton>
    </div>
  )
}

function VirtualizedItem({
  style,
  index,
  children,
  ref,
}: CustomItemComponentProps) {
  const rows = useContext(VirtualizedRowsContext)
  const transitions = useContext(RowTransitionsContext)
  const row = rows[index]
  const previousRow = rows[index - 1]

  // Separate messages only when they start a new sender group.
  const spacing =
    row !== undefined &&
    index > 0 &&
    !row.grouped &&
    row.kind !== 'footer' &&
    !(row.kind === 'hidden' && row.noteGroupId) &&
    previousRow?.messageId !== row.messageId

  // The gutter avatar overhangs its header row into the band of the row below.
  // Without this, Virtua would make the avatar unclickable because it uses
  // `contain: layout` on every item.
  const overhang = row?.kind === 'header' ? { ...style, zIndex: 1 } : style

  return (
    <div
      ref={ref}
      data-slot="virtualized-item"
      data-row-kind={row?.kind}
      data-message-id={row?.messageId}
      data-row-key={row?.key}
      data-note-group-id={row?.kind === 'hidden' ? row.noteGroupId : undefined}
      data-work-id={row?.kind === 'group' ? row.workId : undefined}
      data-segment-index={row?.kind === 'group' ? row.segmentIndex : undefined}
      style={overhang}
    >
      {spacing && <div aria-hidden className="h-10" />}
      {row?.kind === 'group' && row.workId ? (
        <VirtualizedRowTransition
          state={
            row.promotedToolCallIds
              ? undefined
              : transitions.get(row.workId)?.phase
          }
        >
          {children}
        </VirtualizedRowTransition>
      ) : row?.kind === 'hidden' && row.noteGroupId ? (
        <VirtualizedRowTransition
          state={transitions.get(row.noteGroupId)?.phase}
        >
          <div className="border-border/60 border-l py-1 pl-3">{children}</div>
        </VirtualizedRowTransition>
      ) : (
        children
      )}
    </div>
  )
}
