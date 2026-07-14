import { cn, isTouchDevice } from '@/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_THUMB = 32
const HIDE_DELAY = 1200
const SCROLL_KEYS = new Set([
  ' ',
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
])

type Geometry = {
  scrollY: number
  scrollHeight: number
  viewport: number
  trackHeight: number
}

export function ChatScrollbar({ className }: { className?: string }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const geo = useScrollGeometry(trackRef)
  const [dragging, setDragging] = useState(false)
  const [active, poke] = useActivity(dragging)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const maxScroll = Math.max(0, geo.scrollHeight - geo.viewport)
  const scrollable = maxScroll > 1 && geo.trackHeight > 0
  const thumbHeight = Math.max(
    MIN_THUMB,
    geo.trackHeight * (geo.viewport / geo.scrollHeight),
  )
  const travel = geo.trackHeight - thumbHeight
  const thumbTop = maxScroll > 0 ? (geo.scrollY / maxScroll) * travel : 0

  useEffect(() => () => { dragCleanupRef.current?.()}, []) // prettier-ignore

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) poke()
    }

    window.addEventListener('wheel', poke, { passive: true })
    window.addEventListener('touchmove', poke, { passive: true })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('wheel', poke)
      window.removeEventListener('touchmove', poke)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [poke])

  const beginDrag = useCallback(
    (event: React.PointerEvent, startScroll: number) => {
      event.preventDefault()

      dragCleanupRef.current?.()

      const el = event.currentTarget as HTMLElement
      const pointerId = event.pointerId
      const startY = event.clientY
      const perPx = travel > 0 ? maxScroll / travel : 0

      setDragging(true)
      el.setPointerCapture(pointerId)

      const cleanup = () => {
        dragCleanupRef.current = null
        setDragging(false)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
        window.removeEventListener('pointercancel', onEnd)
        window.removeEventListener('blur', cleanup)
        el.removeEventListener('lostpointercapture', cleanup)
        if (el.hasPointerCapture(pointerId)) {
          el.releasePointerCapture(pointerId)
        }
      }

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return
        e.preventDefault()
        window.scrollTo({ top: startScroll + (e.clientY - startY) * perPx })
      }

      const onEnd = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return
        cleanup()
      }

      dragCleanupRef.current = cleanup
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onEnd)
      window.addEventListener('blur', cleanup)
      el.addEventListener('lostpointercapture', cleanup)
    },
    [maxScroll, travel],
  )

  const onThumbPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.stopPropagation()
      beginDrag(event, window.scrollY)
    },
    [beginDrag],
  )

  const onTrackPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (isTouchDevice()) return
      const track = trackRef.current
      if (!track || travel <= 0) return
      const clickY = event.clientY - track.getBoundingClientRect().top
      const target = Math.min(Math.max(clickY - thumbHeight / 2, 0), travel)
      const scrollTop = (target / travel) * maxScroll

      window.scrollTo({ top: scrollTop })
      beginDrag(event, scrollTop)
    },
    [beginDrag, maxScroll, travel, thumbHeight],
  )

  return (
    <div className="pointer-events-none sticky top-0 z-20 h-0">
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        onPointerEnter={poke}
        className={cn(
          'group absolute top-1 right-0.5 bottom-1 w-2.5 touch-none select-none',
          scrollable ? 'pointer-events-auto' : 'pointer-events-none',
          className,
        )}
        style={{ height: 'calc(100dvh - var(--spacing) * 2)' }}
      >
        <div
          onPointerDown={onThumbPointerDown}
          className={cn(
            'bg-primary absolute right-0 w-1 touch-none rounded-full transition-[opacity,width] duration-150 group-hover:w-2',
            !scrollable && 'opacity-0',
            scrollable && (dragging || active ? 'opacity-100' : 'opacity-0'),
            dragging && 'w-2',
          )}
          style={{
            height: thumbHeight || 0,
            transform: `translateY(${thumbTop}px)`,
          }}
        />
      </div>
    </div>
  )
}

function useScrollGeometry(trackRef: React.RefObject<HTMLDivElement | null>) {
  const [geo, setGeo] = useState<Geometry>({
    scrollY: 0,
    scrollHeight: 0,
    viewport: 0,
    trackHeight: 0,
  })

  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const doc = document.documentElement
      setGeo({
        scrollY: window.scrollY,
        scrollHeight: doc.scrollHeight,
        viewport: window.innerHeight,
        trackHeight: trackRef.current?.clientHeight ?? window.innerHeight,
      })
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }

    measure()

    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    const observer = new ResizeObserver(schedule)
    observer.observe(document.body)
    if (trackRef.current) observer.observe(trackRef.current)

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [trackRef])

  return geo
}

/** Reveals the thumb on activity and fades it after a short idle delay. */
function useActivity(keepAlive: boolean): [boolean, () => void] {
  const [active, setActive] = useState(false)
  const timer = useRef(0)

  const poke = useCallback(() => {
    setActive(true)
    clearTimeout(timer.current)
    if (!keepAlive)
      timer.current = window.setTimeout(() => setActive(false), HIDE_DELAY)
  }, [keepAlive])

  useEffect(() => () => clearTimeout(timer.current), [])

  return [active || keepAlive, poke]
}
