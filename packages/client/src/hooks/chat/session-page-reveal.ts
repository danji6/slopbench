import type { SessionGroupPage } from '@/hooks/chat/sessions'
import { useReducedMotion } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

type PageReveal = {
  ids: string[]
  height: number
  phase: 'requested' | 'loading' | 'revealing'
}

type SessionPageRevealOptions = {
  ids: string[]
  page?: SessionGroupPage
  disabled: boolean
}

/** Reveals appended rows with one native height animation after a page request. */
export function useSessionPageReveal({
  ids,
  page,
  disabled,
}: SessionPageRevealOptions) {
  const ref = useRef<HTMLDivElement>(null)
  const pending = useRef<PageReveal | null>(null)
  const frame = useRef<number | null>(null)
  const animation = useRef<Animation | null>(null)
  const [revealing, setRevealing] = useState(false)
  const reducedMotion = useReducedMotion()

  const reset = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    animation.current?.cancel()
    ref.current?.style.removeProperty('height')
    ref.current?.style.removeProperty('overflow')
    frame.current = null
    animation.current = null
    pending.current = null
  }, [])

  useLayoutEffect(() => reset, [reset])

  const finish = useCallback(() => {
    reset()
    setRevealing(false)
  }, [reset])

  const reveal = useCallback(
    (element: HTMLDivElement, request: PageReveal) => {
      element.style.height = `${request.height}px`
      element.style.overflow = 'hidden'
      setRevealing(true)

      // Wait for the session store's layout effects to populate the new rows
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        animation.current = element.animate(
          [
            { height: `${request.height}px` },
            { height: `${element.scrollHeight}px` },
          ],
          { duration: 200, easing: 'ease-out' },
        )
        animation.current.onfinish = finish
      })
    },
    [finish],
  )

  useLayoutEffect(() => {
    const request = pending.current
    const element = ref.current
    if (!request || !element) return

    const samePrefix = request.ids.every((id, index) => ids[index] === id)
    const canceled = disabled || reducedMotion || !samePrefix
    const changedDuringReveal = request.phase === 'revealing' && ids.length !== request.ids.length // prettier-ignore
    if (canceled || changedDuringReveal) {
      finish()
      return
    }
    if (request.phase === 'revealing') return

    if (page?.status === 'LoadingMore') {
      request.phase = 'loading'
      return
    }
    if (ids.length <= request.ids.length) {
      const finishedLoading = request.phase === 'loading'
      if (finishedLoading || page?.status === 'Exhausted') reset()
      return
    }

    request.phase = 'revealing'
    request.ids = ids
    reveal(element, request)
  }, [ids, page?.status, disabled, reducedMotion, reset, finish, reveal])

  function loadMore() {
    if (!page || page.status !== 'CanLoadMore' || pending.current) return
    if (!disabled && !reducedMotion && ref.current) {
      pending.current = {
        ids,
        height: ref.current.getBoundingClientRect().height,
        phase: 'requested',
      }
    }
    page.loadMore(20)
  }

  return { ref, loadMore, revealing }
}
