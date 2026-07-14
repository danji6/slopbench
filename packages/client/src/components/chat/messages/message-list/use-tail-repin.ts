import { useEffect, useLayoutEffect, useRef } from 'react'

import type { ScrollDeps } from './deps'

type TailRepinOptions = {
  lastMessageId: string | undefined
  lastVersion: number
  autoScroll: boolean
  isAtLiveTail: boolean
}

 /**
  * Re-pins to the bottom when the last message's version is changed. This
  * temporarily grows the list's sentinel to compensate for virtua's stale
  * cached total size during a message swap.
  */
export function useTailRepin(
  deps: ScrollDeps,
  { lastMessageId, lastVersion, autoScroll, isAtLiveTail }: TailRepinOptions,
) {
  const { scroller } = deps
  const { sentinelRef, setImmediate, scrollToBottom } = scroller
  const versionRepinRef = useRef<(() => void) | null>(null)
  const sentinelBaseRef = useRef<number | null>(null)
  const prevTailRef = useRef({ id: lastMessageId, version: lastVersion })

  useLayoutEffect(() => {
    const prev = prevTailRef.current
    prevTailRef.current = { id: lastMessageId, version: lastVersion }

    const isVersionSwap =
      prev.id === lastMessageId && prev.version !== lastVersion
    if (!isVersionSwap || !autoScroll || !isAtLiveTail || !lastMessageId) return

    versionRepinRef.current?.()

    const sentinel = sentinelRef.current

    // Pad the sentinel to compensate for virtua's unaccounted overflow
    const pad = (): number => {
      if (!sentinel) return 0

      const container = document.querySelector<HTMLElement>(
        '[data-slot="virtualized-item"]',
      )?.parentElement
      const msgEls = document.querySelectorAll<HTMLElement>(
        `[data-message-id="${CSS.escape(lastMessageId)}"]`,
      )
      if (!container || msgEls.length === 0) return 0

      let msgBottom = -Infinity
      for (const el of msgEls) {
        msgBottom = Math.max(msgBottom, el.getBoundingClientRect().bottom)
      }

      const overflow = Math.max(
        0,
        Math.round(msgBottom - container.getBoundingClientRect().bottom),
      )

      if (sentinelBaseRef.current === null) {
        sentinelBaseRef.current = sentinel.getBoundingClientRect().height
      }

      sentinel.style.height = `${sentinelBaseRef.current + overflow}px`

      return overflow
    }

    const restore = () => {
      if (sentinel) sentinel.style.height = ''
      sentinelBaseRef.current = null
      setImmediate(false)
    }

    setImmediate(true)
    pad()
    scrollToBottom(true)

    let raf = 0
    let frames = 0
    let zeroStreak = 0
    const tick = () => {
      const overflow = pad()
      scrollToBottom(true)
      zeroStreak = overflow <= 0 ? zeroStreak + 1 : 0
      if (zeroStreak >= 2 || ++frames > 60) {
        restore()
        scrollToBottom(true)
        raf = 0
        return
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    versionRepinRef.current = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      restore()
    }
  }, [
    lastMessageId,
    lastVersion,
    autoScroll,
    isAtLiveTail,
    setImmediate,
    scrollToBottom,
    sentinelRef,
  ])
  useEffect(() => () => versionRepinRef.current?.(), [])
}
