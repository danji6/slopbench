import { getNavPaddingPx } from '@/hooks/nav-padding'
import type { MessageRow } from '@/lib/chat/rows'
import { trackUntilSettled } from '@/lib/scroll-settle'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ScrollDeps } from './deps'

type AnchorAround = (target: {
  _id: string
  _creationTime: number
  segmentIndex?: number
}) => void

type SeekOptions = {
  anchorAround: AnchorAround
  rows: MessageRow[]
}

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
    anchored: boolean
  } | null>(null)
  const [seekTick, setSeekTick] = useState(0)
  // Prepare a message scroll event
  const requestScrollToMessage = useCallback(
    (id: string, creationTime?: number, segmentIndex?: number) => {
      pendingTargetRef.current = {
        id,
        creationTime,
        segmentIndex,
        anchored: false,
      }
      holdPosition() // disable autoscroller
      setSeekTick((tick) => tick + 1)
    },
    [holdPosition],
  )

  const seekSettleRef = useRef<(() => void) | null>(null)
  // Scroll to a message until it settles below the nav padding
  const scrollToMessageSettled = useCallback(
    (id: string) => {
      seekSettleRef.current?.()
      const topPaddingPx = getNavPaddingPx(topPadding)

      seekSettleRef.current = trackUntilSettled(() => {
        const index = rowsRef.current.findIndex((row) => row.messageId === id)
        if (index < 0) return null

        const el = document.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(id)}"]`,
        )
        // Bring it closer if it's not mounted yet
        if (!el) {
          virtuaRef.current?.scrollToIndex(index, {
            align: 'start',
            offset: -topPaddingPx,
          })
          return null
        }

        const delta = el.getBoundingClientRect().top - topPaddingPx
        if (Math.abs(delta) > 1) window.scrollBy({ top: delta })
        return delta
      })
    },
    [topPadding, rowsRef, virtuaRef],
  )
  useEffect(() => () => seekSettleRef.current?.(), [])

  // Resolve a pending scroll target, anchoring the window around it if needed
  useEffect(() => {
    const target = pendingTargetRef.current
    if (!target) return

    if (rows.some((row) => row.messageId === target.id)) {
      pendingTargetRef.current = null
      scrollToMessageSettled(target.id)
      return
    }

    if (!target.anchored && target.creationTime !== undefined) {
      target.anchored = true
      anchorAround({
        _id: target.id,
        _creationTime: target.creationTime,
        segmentIndex: target.segmentIndex,
      })
      return
    }

    if (!target.anchored) pendingTargetRef.current = null
  }, [seekTick, rows, scrollToMessageSettled, anchorAround])

  return { scrollToMessage, requestScrollToMessage }
}
