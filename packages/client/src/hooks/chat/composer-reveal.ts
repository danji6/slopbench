import { useCallback, useEffect, useRef, useState } from 'react'

const SCROLL_KEYS = new Set([
  ' ',
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
])

type DockHold = {
  sessionId: string
  pending: ReadonlySet<symbol>
  retained: boolean
}

/** Holds the dock through an opted-in reveal and until transcript navigation. */
export function useComposerReveal(
  sessionId: string | undefined,
  isAtBottom: boolean,
) {
  const [hold, setHold] = useState<DockHold | null>(null)
  const visible = hold !== null && hold.sessionId === sessionId
  if (hold && !visible) setHold(null)

  const clear = useCallback(() => setHold(null), [])

  const begin = useCallback(() => {
    if (!sessionId) return
    const token = Symbol()
    setHold((current) => {
      const previous = current?.sessionId === sessionId ? current : null
      return {
        sessionId,
        pending: new Set([...(previous?.pending ?? []), token]),
        retained: previous?.retained ?? false,
      }
    })
    return (scrolled: boolean) => {
      setHold((current) => finishReveal(current, token, scrolled))
    }
  }, [sessionId])

  const keepVisible = useCallback(() => {
    if (!sessionId) return
    setHold((current) => ({
      sessionId,
      pending: current?.sessionId === sessionId ? current.pending : new Set(),
      retained: true,
    }))
  }, [sessionId])

  const wasAtBottom = useRef(isAtBottom)
  useEffect(() => {
    if (isAtBottom && !wasAtBottom.current) clear()
    wasAtBottom.current = isAtBottom
  }, [isAtBottom, clear])

  useEffect(() => {
    if (!visible) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY && isTranscriptGesture(event)) clear()
    }
    const onTouchMove = (event: TouchEvent) => {
      if (isTranscriptGesture(event)) clear()
    }
    const onKey = (event: KeyboardEvent) => {
      if (isTranscriptScrollKey(event)) clear()
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('keydown', onKey)
    }
  }, [visible, clear])

  return { visible, begin, clear, keepVisible }
}

function finishReveal(hold: DockHold | null, token: symbol, scrolled: boolean) {
  if (!hold?.pending.has(token)) return hold
  const pending = new Set(hold.pending)
  pending.delete(token)
  const retained = hold.retained || scrolled
  return pending.size || retained ? { ...hold, pending, retained } : null
}

function isTranscriptGesture(event: Event) {
  if (event.defaultPrevented) return false
  return !(
    event.target instanceof Element &&
    event.target.closest(
      '[data-slot="chat-dock"], [data-slot="terminal-wrapper"], [role="dialog"]',
    )
  )
}

function isTranscriptScrollKey(event: KeyboardEvent) {
  if (!SCROLL_KEYS.has(event.key) || !isTranscriptGesture(event)) return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return true
  if (target.isContentEditable || target.closest('input, textarea, select'))
    return false
  return event.key !== ' ' || !target.closest('button, [role="button"]')
}
