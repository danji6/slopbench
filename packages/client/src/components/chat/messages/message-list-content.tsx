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

import { EmptyMessage } from '../empty-message'

const CONTENT_FADE_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const

const contentClassName = {
  loading: 'flex flex-1 flex-col justify-center',
  empty: 'flex flex-1 flex-col justify-center',
  messages: 'w-full',
} as const

const VirtualizedRowsContext = createContext<readonly MessageRow[]>([])

export type MessageListContentState = keyof typeof contentClassName

type MessageListContentProps = {
  state: MessageListContentState
  showLoadingIndicator: boolean
  emptyStyle?: CSSProperties
  messages: MessageRowsProps
}

export function MessageListContent({
  state,
  showLoadingIndicator,
  emptyStyle,
  messages,
}: MessageListContentProps) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <ContentFade key={state} className={contentClassName[state]}>
        {state === 'loading' ? (
          <MessageListLoadingState showIndicator={showLoadingIndicator} />
        ) : state === 'empty' ? (
          <MessageListEmptyState style={emptyStyle} />
        ) : (
          <MessageRows {...messages} />
        )}
      </ContentFade>
    </AnimatePresence>
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

type MessageListLoadingStateProps = {
  showIndicator: boolean
}

function MessageListLoadingState({
  showIndicator,
}: MessageListLoadingStateProps) {
  return (
    <AnimatePresence>
      {showIndicator && (
        <motion.div
          key="loading-indicator"
          className="mx-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={CONTENT_FADE_TRANSITION}
        >
          <WavyProgressCircle size={64} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

type MessageListEmptyStateProps = {
  style?: CSSProperties
}

function MessageListEmptyState({ style }: MessageListEmptyStateProps) {
  return <EmptyMessage style={style} />
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
      style={style}
    >
      {spacing && <div aria-hidden className={row.grouped ? 'h-3' : 'h-10'} />}
      {children}
    </div>
  )
}
