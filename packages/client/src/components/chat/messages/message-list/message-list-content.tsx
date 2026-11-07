import { RippleButton, WavyProgressCircle } from '@/components/ui'
import { useVirtualizedLayout } from '@/hooks/chat/message-list/virtualized-layout'
import { noteExpansion } from '@/lib/chat/note-state'
import type { RowTransition } from '@/lib/chat/row-expansion-state'
import type { MessageRow } from '@/lib/chat/rows'
import { workExpansion } from '@/lib/chat/work-state'
import { cn } from '@/lib/utils'
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
  useMemo,
  useRef,
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
  const root = useRef<HTMLDivElement>(null)
  const transitionLayout = { rows, root, virtualizer: virtuaRef }
  const workTransitions = useRowTransitions(workExpansion, transitionLayout)
  const noteTransitions = useRowTransitions(noteExpansion, transitionLayout)

  const transitions = useMemo(
    () => new Map([...workTransitions, ...noteTransitions]),
    [workTransitions, noteTransitions],
  )

  const layout = useVirtualizedLayout({
    rows,
    transitions,
    virtualizer: virtuaRef,
  })

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
        ref={root}
        className="mx-auto"
        style={
          hasHeaderContainer
            ? { ...innerStyle, minHeight: layout.minHeight }
            : { ...innerStyle, ...topPaddingStyle, minHeight: layout.minHeight }
        }
      >
        <VirtualizedRowsContext value={rows}>
          <RowTransitionsContext value={transitions}>
            <WindowVirtualizer
              ref={virtuaRef}
              data={rows}
              item={VirtualizedItem}
              shift={shiftItems || layout.shift}
              onResize={layout.onResize}
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

/** Chooses gaps whose values live in styles/messages.css. */
function getRowSpacing(row?: MessageRow, previousRow?: MessageRow) {
  if (!row || row.kind === 'footer') return

  const isNoteRow = row.kind === 'hidden' && row.noteGroupId
  if (isNoteRow) return 'h-(--work-row-gap)'

  const startsSenderGroup =
    previousRow && !row.grouped && previousRow.messageId !== row.messageId
  const isSummary = row.kind === 'group' && row.summary
  if (startsSenderGroup) {
    return isSummary
      ? 'h-(--message-compaction-gap)'
      : 'h-(--message-sender-gap)'
  }

  const isWorkRow =
    row.kind === 'group' && row.workId && !row.promotedToolCallIds
  if (isWorkRow) return 'h-(--work-row-gap)'
  if (!previousRow) return
  if (isSummary) return 'h-(--message-section-gap)'

  const bordersNote = row.kind === 'hidden' || previousRow.kind === 'hidden'
  if (bordersNote) return 'h-(--message-section-gap)'

  const startsNotes = row.kind === 'note-group'
  if (startsNotes) return 'h-(--message-section-gap)'

  const startsContent = row.kind === 'group' && !row.workId
  const followsContent = previousRow.kind === 'group' && !previousRow.workId
  const followsWork =
    previousRow.kind === 'work' ||
    (previousRow.kind === 'group' && !!previousRow.workId)
  const contentBoundary =
    (startsContent && followsWork) || (row.kind === 'work' && followsContent)
  if (contentBoundary) return 'h-(--message-section-gap)'
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
  const nextRow = rows[index + 1]
  const continuesWork =
    nextRow?.kind === 'group' &&
    row?.kind === 'group' &&
    nextRow.workId === row.workId &&
    !nextRow.promotedToolCallIds

  const spacing = getRowSpacing(row, previousRow)
  const content = (
    <>
      {spacing && <div aria-hidden className={spacing} />}
      {children}
    </>
  )

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
      {row?.kind === 'group' && row.workId ? (
        <VirtualizedRowTransition
          state={
            row.promotedToolCallIds
              ? undefined
              : transitions.get(row.workId)?.phase
          }
        >
          {row.promotedToolCallIds ? (
            content
          ) : (
            <div
              className={cn('chat-work-row', !continuesWork && 'chat-work-end')}
            >
              <div className="border-border/60 border-l">{content}</div>
            </div>
          )}
        </VirtualizedRowTransition>
      ) : row?.kind === 'hidden' && row.noteGroupId ? (
        <VirtualizedRowTransition
          state={transitions.get(row.noteGroupId)?.phase}
        >
          <div className="border-border/60 border-l pl-(--message-group-inset)">
            {content}
          </div>
        </VirtualizedRowTransition>
      ) : (
        content
      )}
    </div>
  )
}
