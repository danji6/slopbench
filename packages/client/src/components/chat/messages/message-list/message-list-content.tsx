import { RippleButton, WavyProgressCircle } from '@/components/ui'
import type { MessageRow } from '@/lib/chat/rows'
import { AnimatePresence, motion } from 'motion/react'
import {
  type CSSProperties,
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

const CONTENT_FADE_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const

const VirtualizedRowsContext = createContext<readonly MessageRow[]>([])

type MessageListContentProps = {
  /** Whether the list has finished positioning and may fade into view. */
  revealed: boolean
  isEmpty: boolean
  showLoadingIndicator: boolean
  /** Loading overlay style. Inset is passed here to keep it centered. */
  overlayStyle?: CSSProperties
  emptyStyle?: CSSProperties
  messages: MessageRowsProps
}

export function MessageListContent({
  revealed,
  isEmpty,
  showLoadingIndicator,
  overlayStyle,
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
      <motion.div
        className="w-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 1 : 0 }}
        transition={CONTENT_FADE_TRANSITION}
      >
        <MessageRows {...messages} />
      </motion.div>
      <AnimatePresence>
        {!revealed && (
          <LoadingOverlay
            key="loading"
            showIndicator={showLoadingIndicator}
            style={overlayStyle}
          />
        )}
      </AnimatePresence>
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
  style?: CSSProperties
}

/** Viewport-anchored loading overlay shown while the list positions itself. */
function LoadingOverlay({ showIndicator, style }: LoadingOverlayProps) {
  return (
    <motion.div
      className="pointer-events-none fixed inset-x-0 z-10 flex items-center justify-center"
      style={style}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={CONTENT_FADE_TRANSITION}
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
  hasNewer,
  shiftItems,
  onLoadMore,
  onLoadNewer,
  renderRow,
  virtuaRef,
}: MessageRowsProps) {
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
          <WindowVirtualizer
            ref={virtuaRef}
            data={rows}
            item={VirtualizedItem}
            shift={shiftItems}
          >
            {renderRow}
          </WindowVirtualizer>
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
}: {
  onClick: () => void
  label: string
}) {
  return (
    <div className="flex justify-center">
      <RippleButton variant="input" onClick={onClick}>
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
  const row = rows[index]
  const previousRow = rows[index - 1]

  // Spacing for certain rows (e.g. summary blocks)
  const spacing =
    row !== undefined &&
    index > 0 &&
    row.kind !== 'footer' &&
    previousRow?.messageId !== row.messageId

  return (
    <div
      ref={ref}
      data-slot="virtualized-item"
      data-row-kind={row?.kind}
      data-message-id={row?.messageId}
      data-row-key={row?.key}
      data-segment-index={row?.kind === 'group' ? row.segmentIndex : undefined}
      style={style}
    >
      {spacing && <div aria-hidden className={row.grouped ? 'h-3' : 'h-10'} />}
      {children}
    </div>
  )
}
