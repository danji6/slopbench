import { getNavPaddingPx } from '@/hooks/nav-padding'
import type { MessageRow } from '@/lib/chat/rows'
import { trackUntilSettled } from '@/lib/scroll-settle'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ScrollDeps } from '../deps'

type AnchorAround = (target: {
  _id: string
  _creationTime: number
  segmentIndex?: number
}) => void

type SeekOptions = {
  anchorAround: AnchorAround
  rows: MessageRow[]
}

export type SeekTargetOptions = {
  /** Offset (px) of the anchor row's top from the nav-padding line. */
  offset?: number
  /** Stable key of the exact row to align to, for sub-message precision. */
  rowKey?: string
  /** Called once the target has been reached and its position has settled. */
  onSettled?: () => void
  /** Called when the message can't be located even after anchoring the window. */
  onNotFound?: () => void
}

/** Resolves the row to align to, preferring the exact saved row over the message. */
function resolveAlignTarget(
  rows: MessageRow[],
  id: string,
  rowKey: string | undefined,
): { index: number; selector: string } | null {
  if (rowKey !== undefined) {
    const keyIndex = rows.findIndex((row) => row.key === rowKey)
    if (keyIndex >= 0) {
      return {
        index: keyIndex,
        selector: `[data-row-key="${CSS.escape(rowKey)}"]`,
      }
    }
  }
  const messageIndex = rows.findIndex((row) => row.messageId === id)
  if (messageIndex < 0) return null
  return {
    index: messageIndex,
    selector: `[data-message-id="${CSS.escape(id)}"]`,
  }
}

/** How long to wait for an anchored window to surface the target before giving up. */
const NOT_FOUND_TIMEOUT_MS = 4000

/** Scrolls to a specific message, anchoring the window around it if unloaded. */
export function useSeek(deps: ScrollDeps, { anchorAround, rows }: SeekOptions) {
  const { scroller, virtuaRef, rowsRef, topPadding } = deps
  const { holdPosition } = scroller

  const scrollToMessage = useCallback(
    (id: string) => {
      const index = rows.findIndex((row) => row.messageId === id)
      if (index < 0) return
      virtuaRef.current?.scrollToIndex(index, {
        align: 'nearest',
        offset: -getNavPaddingPx(topPadding),
      })
    },
    [rows, topPadding, virtuaRef],
  )

  const pendingTargetRef = useRef<{
    id: string
    creationTime?: number
    segmentIndex?: number
    offset: number
    rowKey?: string
    onSettled?: () => void
    onNotFound?: () => void
    anchored: boolean
  } | null>(null)
  const [seekTick, setSeekTick] = useState(0)

  const notFoundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearNotFoundTimer = useCallback(() => {
    if (notFoundTimerRef.current !== null) {
      clearTimeout(notFoundTimerRef.current)
      notFoundTimerRef.current = null
    }
  }, [])
  const abandonTarget = useCallback(() => {
    clearNotFoundTimer()
    const target = pendingTargetRef.current
    pendingTargetRef.current = null
    target?.onNotFound?.()
  }, [clearNotFoundTimer])

  // Prepare a message scroll event
  const requestScrollToMessage = useCallback(
    (
      id: string,
      creationTime?: number,
      segmentIndex?: number,
      options?: SeekTargetOptions,
    ) => {
      clearNotFoundTimer()
      pendingTargetRef.current = {
        id,
        creationTime,
        segmentIndex,
        offset: options?.offset ?? 0,
        rowKey: options?.rowKey,
        onSettled: options?.onSettled,
        onNotFound: options?.onNotFound,
        anchored: false,
      }
      holdPosition() // disable autoscroller
      setSeekTick((tick) => tick + 1)
    },
    [holdPosition, clearNotFoundTimer],
  )

  const seekSettleRef = useRef<(() => void) | null>(null)
  // Scroll to a message until its top settles at the target offset below the nav padding
  const scrollToMessageSettled = useCallback(
    (id: string, offset: number, onSettled?: () => void, rowKey?: string) => {
      seekSettleRef.current?.()
      const topPaddingPx = getNavPaddingPx(topPadding)

      seekSettleRef.current = trackUntilSettled(
        () => {
          const resolved = resolveAlignTarget(rowsRef.current, id, rowKey)
          if (!resolved) return null

          const el = document.querySelector<HTMLElement>(resolved.selector)
          // Bring it closer if it's not mounted yet
          if (!el) {
            virtuaRef.current?.scrollToIndex(resolved.index, {
              align: 'start',
              offset: -topPaddingPx,
            })
            return null
          }

          const delta = el.getBoundingClientRect().top - topPaddingPx - offset
          if (Math.abs(delta) > 1) window.scrollBy({ top: delta })
          return delta
        },
        { onDone: onSettled },
      )
    },
    [topPadding, rowsRef, virtuaRef],
  )
  useEffect(() => () => seekSettleRef.current?.(), [])
  useEffect(() => clearNotFoundTimer, [clearNotFoundTimer])

  // Resolve a pending scroll target, anchoring the window around it if needed
  useEffect(() => {
    const target = pendingTargetRef.current
    if (!target) return

    const loaded =
      target.segmentIndex === undefined
        ? rows.some((row) => row.messageId === target.id)
        : rows.some(
            (row) =>
              row.messageId === target.id &&
              row.kind === 'group' &&
              row.segmentIndex === target.segmentIndex,
          )

    if (loaded) {
      clearNotFoundTimer()
      pendingTargetRef.current = null
      scrollToMessageSettled(
        target.id,
        target.offset,
        target.onSettled,
        target.rowKey,
      )
      return
    }

    if (!target.anchored && target.creationTime !== undefined) {
      target.anchored = true
      // Give up if the anchored window never surfaces the message
      notFoundTimerRef.current = setTimeout(abandonTarget, NOT_FOUND_TIMEOUT_MS)
      anchorAround({
        _id: target.id,
        _creationTime: target.creationTime,
        segmentIndex: target.segmentIndex,
      })
      return
    }

    if (!target.anchored) abandonTarget()
  }, [
    seekTick,
    rows,
    scrollToMessageSettled,
    anchorAround,
    abandonTarget,
    clearNotFoundTimer,
  ])

  return { scrollToMessage, requestScrollToMessage }
}
