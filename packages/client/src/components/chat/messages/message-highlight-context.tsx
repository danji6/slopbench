import { createOptionalContext } from '@/hooks/context'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useMessageList } from './message-list-context'

export type HighlightTarget = {
  messageId: string
  /** The segment holding the block, or null for the whole message. */
  segmentIndex: number | null
  /** The block to highlight, or null to highlight the whole message. */
  groupIndex: number | null
}

export type MessageHighlightValue = {
  target: HighlightTarget | null
  setTarget: React.Dispatch<React.SetStateAction<HighlightTarget | null>>
  registerElement: (
    target: HighlightTarget,
    element: HTMLElement | null,
  ) => void
}

export const [MessageHighlightContext, useMessageHighlight] =
  createOptionalContext<MessageHighlightValue>()

type RegisteredElement = {
  target: HighlightTarget
  element: HTMLElement
}

type HighlightRect = {
  top: number
  left: number
  width: number
  height: number
}

type MeasuredHighlightRect = HighlightRect & {
  key: string
}

const HIGHLIGHT_PAD_X = 8
const HIGHLIGHT_PAD_Y = 12

function keyForTarget(target: HighlightTarget): string {
  if (target.groupIndex === null) return `${target.messageId}:message`
  return `${target.messageId}:s${target.segmentIndex ?? 0}:${target.groupIndex}`
}

export function MessageHighlightProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [target, setTarget] = useState<HighlightTarget | null>(null)
  const [rect, setRect] = useState<MeasuredHighlightRect | null>(null)
  const [registryVersion, setRegistryVersion] = useState(0)
  const elementsRef = useRef(new Map<string, RegisteredElement>())
  const messageList = useMessageList()

  const registerElement = useCallback(
    (target: HighlightTarget, element: HTMLElement | null) => {
      const key = keyForTarget(target)
      if (element) {
        elementsRef.current.set(key, { target, element })
      } else {
        elementsRef.current.delete(key)
      }
      setRegistryVersion((version) => version + 1)
    },
    [],
  )

  useLayoutEffect(() => {
    if (!target) return

    const activeTarget = target
    const activeKey = keyForTarget(activeTarget)
    let frame: number | undefined

    function measure() {
      frame = undefined
      const next = measureTarget(
        activeTarget,
        elementsRef.current,
        messageList?.scrollRef.current,
      )
      setRect(next ? { ...next, key: activeKey } : null)
    }

    function scheduleMeasure() {
      if (frame !== undefined) return
      frame = requestAnimationFrame(measure)
    }

    scheduleMeasure()

    const observer = new ResizeObserver(scheduleMeasure)
    const elements = getTargetElements(activeTarget, elementsRef.current)
    for (const element of elements) observer.observe(element)
    if (messageList?.scrollRef.current) {
      observer.observe(messageList.scrollRef.current)
    }

    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, true)

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
    }
  }, [target, registryVersion, messageList?.scrollRef])

  const value = useMemo(
    () => ({ target, setTarget, registerElement }),
    [target, registerElement],
  )
  const activeRect = target && rect?.key === keyForTarget(target) ? rect : null

  return (
    <MessageHighlightContext.Provider value={value}>
      <MessageHighlightOverlay rect={activeRect} />
      {children}
    </MessageHighlightContext.Provider>
  )
}

function getTargetElements(
  target: HighlightTarget,
  elements: Map<string, RegisteredElement>,
): HTMLElement[] {
  if (target.groupIndex !== null) {
    const element = elements.get(keyForTarget(target))?.element
    return element ? [element] : []
  }

  return Array.from(elements.values())
    .filter((entry) => entry.target.messageId === target.messageId)
    .map((entry) => entry.element)
}

function measureTarget(
  target: HighlightTarget,
  elements: Map<string, RegisteredElement>,
  scrollElement?: HTMLElement | null,
): HighlightRect | null {
  const rects = getTargetElements(target, elements)
    .filter((element) => element.isConnected)
    .map((element) => expandRect(element.getBoundingClientRect()))
    .filter((rect) => rect.width > 0 && rect.height > 0)

  if (!rects.length) return null

  const first = rects[0]
  const union = rects.slice(1).reduce(
    (acc, rect) => ({
      top: Math.min(acc.top, rect.top),
      left: Math.min(acc.left, rect.left),
      right: Math.max(acc.right, rect.right),
      bottom: Math.max(acc.bottom, rect.bottom),
    }),
    {
      top: first.top,
      left: first.left,
      right: first.right,
      bottom: first.bottom,
    },
  )

  const viewport = getViewportRect(scrollElement)
  const clipped = {
    top: Math.max(union.top, viewport.top),
    left: Math.max(union.left, viewport.left),
    right: Math.min(union.right, viewport.right),
    bottom: Math.min(union.bottom, viewport.bottom),
  }

  if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) {
    return null
  }

  return {
    top: clipped.top,
    left: clipped.left,
    width: clipped.right - clipped.left,
    height: clipped.bottom - clipped.top,
  }
}

function expandRect(rect: DOMRect): DOMRect {
  return new DOMRect(
    rect.left - HIGHLIGHT_PAD_X,
    rect.top - HIGHLIGHT_PAD_Y,
    rect.width + HIGHLIGHT_PAD_X * 2,
    rect.height + HIGHLIGHT_PAD_Y * 2,
  )
}

function getViewportRect(element?: HTMLElement | null) {
  if (
    !element ||
    element === document.documentElement ||
    element === document.body
  ) {
    return {
      top: 0,
      left: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    }
  }

  return element.getBoundingClientRect()
}

function MessageHighlightOverlay({ rect }: { rect: HighlightRect | null }) {
  return (
    <AnimatePresence initial={false}>
      {rect && (
        <motion.div
          key="message-highlight"
          aria-hidden
          initial={{
            opacity: 0,
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
          animate={{
            opacity: 1,
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className="bg-m3-surface-container/70 ring-m3-outline-variant/40 pointer-events-none fixed z-0 rounded-xl ring-1"
        />
      )}
    </AnimatePresence>
  )
}
