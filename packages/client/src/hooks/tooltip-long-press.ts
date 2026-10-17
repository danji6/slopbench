import type { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { useEffect, useRef } from 'react'

const MOVE_TOLERANCE = 10
const CLICK_SUPPRESSION_DELAY = 500

type ActivePress = {
  pointerId: number
  startX: number
  startY: number
  opened: boolean
}

export type TooltipLongPressOptions = {
  enabled: boolean
  delay: number
  closeDelay: number
  handle: TooltipPrimitive.Handle<unknown>
  triggerId: string
}

type PreventableFocusEvent = React.FocusEvent<HTMLElement> & {
  preventBaseUIHandler?: () => void
}

/** Adds a cancellable touch long-press interaction to a tooltip trigger. */
export function useTooltipLongPress({
  enabled,
  delay,
  closeDelay,
  handle,
  triggerId,
}: TooltipLongPressOptions): React.HTMLAttributes<HTMLElement> {
  const activePress = useRef<ActivePress | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const suppressionTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const suppressClick = useRef(false)

  function clearTimer(
    timer: React.RefObject<ReturnType<typeof setTimeout> | null>,
  ) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  function cancelPress(close = false) {
    clearTimer(openTimer)
    if (close && activePress.current?.opened) handle.close()
    activePress.current = null
  }

  function suppressReleasedClick() {
    suppressClick.current = true
    clearTimer(suppressionTimer)
    suppressionTimer.current = setTimeout(() => {
      suppressClick.current = false
    }, CLICK_SUPPRESSION_DELAY)
  }

  useEffect(() => {
    if (!enabled) return

    const cancelForScroll = () => {
      clearTimer(openTimer)
      if (activePress.current?.opened) handle.close()
      activePress.current = null
    }
    window.addEventListener('scroll', cancelForScroll, true)
    return () => {
      window.removeEventListener('scroll', cancelForScroll, true)
      clearTimer(openTimer)
      if (activePress.current?.opened && handle.isOpen) handle.close()
      activePress.current = null
      clearTimer(closeTimer)
      clearTimer(suppressionTimer)
      suppressClick.current = false
    }
  }, [enabled, handle])

  if (!enabled) return {}

  return {
    onPointerDown(event) {
      if (event.pointerType !== 'touch' || event.button !== 0) return

      cancelPress(true)
      clearTimer(closeTimer)
      activePress.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        opened: false,
      }
      openTimer.current = setTimeout(() => {
        if (!activePress.current) return
        activePress.current.opened = true
        handle.open(triggerId)
      }, delay)
    },
    onPointerMove(event) {
      const press = activePress.current
      if (!press || event.pointerId !== press.pointerId) return

      const moved = Math.hypot(
        event.clientX - press.startX,
        event.clientY - press.startY,
      )
      if (moved > MOVE_TOLERANCE) cancelPress(true)
    },
    onPointerUp(event) {
      const press = activePress.current
      if (!press || event.pointerId !== press.pointerId) return

      clearTimer(openTimer)
      activePress.current = null
      if (!press.opened) return

      suppressReleasedClick()
      clearTimer(closeTimer)
      closeTimer.current = setTimeout(() => handle.close(), closeDelay)
    },
    onPointerCancel() {
      cancelPress(true)
    },
    onFocus(event) {
      if (activePress.current) {
        ;(event as PreventableFocusEvent).preventBaseUIHandler?.()
      }
    },
    onClickCapture(event) {
      if (!suppressClick.current) return
      suppressClick.current = false
      clearTimer(suppressionTimer)
      event.preventDefault()
      event.stopPropagation()
    },
    onContextMenu(event) {
      if (activePress.current || suppressClick.current) event.preventDefault()
    },
  }
}
