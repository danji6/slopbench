import { cn, isTouchDevice } from '@/lib/utils'
import type { Editor } from '@tiptap/react'
import { PencilIcon } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useMessage } from '../../message-context'
import { applyScript } from '../apply-script'
import { useMessageEdit } from '../message-edit-context'
import { MenuButton } from './menu-button'
import { ScriptManager } from './script-manager'
import { ScriptToolbarContent } from './script-toolbar'

type SelectionState = {
  text: string
  occurrenceIndex: number
  rect: DOMRect
}

const SELECTION_DEBOUNCE_MS = 100
const TOUCH_SELECTION_DEBOUNCE_MS = 200
const TOUCH_SELECTION_DELAY_MS = 200
const TOOLBAR_HEIGHT = 40
const TOOLBAR_GAP = 8
const VIEWPORT_PADDING = 8

export function BubbleMenu({
  children,
  editor,
}: {
  children: React.ReactNode
  editor?: Editor
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bubbleMenuRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const scriptsPopoverOpenRef = useRef(false)
  const restorePointerEventsTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const [menuInteractive, setMenuInteractive] = useState(true)
  const [menuVisible, setMenuVisible] = useState(true)
  const editCtx = useMessageEdit()
  const msgCtx = useMessage()
  const [scriptManagerOpen, setScriptManagerOpen] = useState(false)

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>

    function setMenuPointerEvents(enabled: boolean) {
      setMenuInteractive(enabled)
    }

    function restoreMenuPointerEvents(delay = 0) {
      if (restorePointerEventsTimerRef.current) {
        clearTimeout(restorePointerEventsTimerRef.current)
      }

      if (delay === 0) {
        setMenuPointerEvents(true)
        return
      }

      restorePointerEventsTimerRef.current = setTimeout(() => {
        setMenuPointerEvents(true)
      }, delay)
    }

    function suspendMenuPointerEvents() {
      setMenuPointerEvents(false)
      restoreMenuPointerEvents(TOUCH_SELECTION_DELAY_MS)
    }

    function onSelectionChange() {
      if (scriptsPopoverOpenRef.current) return

      clearTimeout(debounceTimer)

      const isTouch = isTouchDevice()
      setMenuPointerEvents(false)
      if (isTouch) setMenuVisible(false)

      debounceTimer = setTimeout(
        () => {
          restoreMenuPointerEvents()

          const sel = window.getSelection()
          const container = containerRef.current
          if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container) {
            setSelection(null)
            setMenuVisible(false)
            return
          }

          const range = sel.getRangeAt(0)
          if (!container.contains(range.startContainer)) {
            setSelection(null)
            setMenuVisible(false)
            return
          }

          const clamped = clampRangeToContainer(range, container)
          const text = clamped.toString().trim()
          if (!text) {
            setSelection(null)
            setMenuVisible(false)
            return
          }

          const rect = selectionRect(clamped)
          if (!rect) {
            setSelection(null)
            setMenuVisible(false)
            return
          }

          const normalize = (s: string) =>
            s
              .replace(/\s+/g, '')
              .replace(/[\u2018\u2019]/g, "'")
              .replace(/[\u201C\u201D]/g, '"')

          const strippedText = normalize(text)
          const beforeRange = document.createRange()
          beforeRange.selectNodeContents(container)
          beforeRange.setEnd(clamped.startContainer, clamped.startOffset)

          const strippedCharsBefore = normalize(beforeRange.toString()).length
          const strippedContainerText = normalize(container.textContent ?? '')

          let occurrenceIndex = 0
          let searchPos = 0

          while (searchPos < strippedCharsBefore) {
            const idx = strippedContainerText.indexOf(strippedText, searchPos)
            if (idx === -1 || idx >= strippedCharsBefore) break
            occurrenceIndex++
            searchPos = idx + strippedText.length
          }

          setSelection({ text, occurrenceIndex, rect })
          setMenuVisible(true)
        },
        isTouch ? TOUCH_SELECTION_DEBOUNCE_MS : SELECTION_DEBOUNCE_MS,
      )
    }

    function onTouchStart(event: TouchEvent) {
      if (scriptsPopoverOpenRef.current) return
      if (bubbleMenuRef.current?.contains(event.target as Node)) return
      if (isTouchDevice()) setMenuVisible(false)
      suspendMenuPointerEvents()
    }

    function onScroll(event: Event) {
      // Scrolling inside the menu itself must not dismiss the selection
      if (bubbleMenuRef.current?.contains(event.target as Node)) return
      clearTimeout(debounceTimer)
      if (!scriptsPopoverOpenRef.current) setSelection(null)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('touchstart', onTouchStart, {
      passive: true,
      capture: true,
    })
    window.addEventListener('scroll', onScroll, {
      passive: true,
      capture: true,
    })

    return () => {
      clearTimeout(debounceTimer)
      if (restorePointerEventsTimerRef.current) {
        clearTimeout(restorePointerEventsTimerRef.current)
      }
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('touchstart', onTouchStart, {
        capture: true,
      })
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [])

  function handleEdit(onEditorReady?: (editor: Editor) => void) {
    if (!selection || !editCtx || !msgCtx) return
    editCtx.startEditing(msgCtx.id, msgCtx.content, {
      selectedText: selection.text,
      occurrenceIndex: selection.occurrenceIndex,
      viewportTop: selection.rect.top,
      onEditorReady,
    })
    setSelection(null)
  }

  function handleManageScripts() {
    // Drop the underlying selection to avoid overlaps on mobile
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    setScriptManagerOpen(true)
  }

  const onScript = editor
    ? (code: string) => applyScript(editor, code)
    : (code: string) => handleEdit((e) => applyScript(e, code))

  const onEditorAction: (action: (e: Editor) => void) => void = editor
    ? (action) => action(editor)
    : handleEdit

  const actions: React.ReactNode[] = []
  if (!editor) {
    actions.push(
      <MenuButton
        key="edit"
        tooltip="Edit"
        onMouseDown={(e) => {
          e.preventDefault()
          handleEdit()
        }}
      >
        <PencilIcon />
      </MenuButton>,
    )
  }
  return (
    <div data-slot="bubble-menu-wrapper" ref={containerRef}>
      {children}
      <ScriptManager
        open={scriptManagerOpen}
        onOpenChange={setScriptManagerOpen}
      />
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {selection && menuVisible && (
              <BubbleMenuContent
                ref={bubbleMenuRef}
                key="viewer-bubble"
                rect={selection.rect}
                onScript={onScript}
                onEditorAction={onEditorAction}
                onScriptsPopoverOpenChange={(open) => {
                  scriptsPopoverOpenRef.current = open
                }}
                onManageScripts={handleManageScripts}
                interactive={menuInteractive}
                actions={actions}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}

type BubbleMenuContentProps = React.ComponentProps<'div'> & {
  rect: DOMRect
  onScript: (code: string) => void
  onEditorAction: (action: (editor: Editor) => void) => void
  onScriptsPopoverOpenChange: (open: boolean) => void
  onManageScripts: () => void
  interactive: boolean
  actions: React.ReactNode[]
}

function BubbleMenuContent({
  rect,
  onScript,
  onEditorAction,
  onScriptsPopoverOpenChange,
  onManageScripts,
  interactive,
  actions,
  className,
  style,
  ...props
}: BubbleMenuContentProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: TOOLBAR_HEIGHT })
  const viewport = getViewportBounds()

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return

    function updateSize() {
      const next = menu!.getBoundingClientRect()
      setSize({ width: next.width, height: next.height })
    }

    updateSize()

    const observer = new ResizeObserver(updateSize)
    observer.observe(menu)
    return () => observer.disconnect()
  }, [])

  const showBelow =
    rect.bottom + size.height + TOOLBAR_GAP + VIEWPORT_PADDING <=
    viewport.bottom

  const floatingTop = showBelow
    ? rect.bottom + TOOLBAR_GAP
    : Math.max(VIEWPORT_PADDING, rect.top - size.height - TOOLBAR_GAP)

  const touch = isTouchDevice()
  // On touch the toolbar is pinned to the top below the navbars
  const touchTop = Math.max(
    getMobileNavBottom() + TOOLBAR_GAP,
    viewport.top + VIEWPORT_PADDING,
  )
  const top = touch ? touchTop : floatingTop

  const centeredX = touch
    ? viewport.left + viewport.width / 2
    : rect.left + rect.width / 2

  const minLeft = viewport.left + VIEWPORT_PADDING

  const maxLeft =
    viewport.left +
    viewport.width -
    VIEWPORT_PADDING -
    Math.min(size.width, viewport.width - VIEWPORT_PADDING * 2)

  const left = clamp(centeredX - size.width / 2, minLeft, maxLeft)

  const maxWidth = Math.max(0, viewport.width - VIEWPORT_PADDING * 2)

  return (
    <div
      ref={mergeRefs(menuRef, props.ref)}
      style={{
        position: 'fixed',
        top,
        left,
        width: 'max-content',
        maxWidth,
        pointerEvents: 'none',
        zIndex: 50,
        ...style,
      }}
      className={cn(
        interactive
          ? '[&_button]:pointer-events-auto'
          : '[&_button]:pointer-events-none',
        className,
      )}
      {...withoutRef(props)}
    >
      <ScriptToolbarContent
        onScript={onScript}
        onAction={onEditorAction}
        preventMouseDefault
        onScriptsPopoverOpenChange={onScriptsPopoverOpenChange}
        onManageScripts={onManageScripts}
        actions={actions}
        popoverSide={touch ? 'bottom' : 'top'}
      />
    </div>
  )
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** Bottom edge of the floating mobile nav pills, or 0 when none are mounted. */
function getMobileNavBottom(): number {
  let bottom = 0
  for (const el of document.querySelectorAll(
    '[data-slot="mobile-nav-toggle"]',
  )) {
    const rect = el.getBoundingClientRect()
    if (rect.height > 0) bottom = Math.max(bottom, rect.bottom)
  }
  return bottom
}

function getViewportBounds() {
  const visualViewport = window.visualViewport
  const left = visualViewport?.offsetLeft ?? 0
  const top = visualViewport?.offsetTop ?? 0
  const width = visualViewport?.width ?? window.innerWidth
  const height = visualViewport?.height ?? window.innerHeight

  return {
    bottom: top + height,
    height,
    left,
    top,
    width,
  }
}

function mergeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') {
        ref(value)
      } else {
        ref.current = value
      }
    }
  }
}

function withoutRef<T extends { ref?: React.Ref<unknown> }>(props: T) {
  const { ref: _ref, ...rest } = props
  return rest
}

function selectionRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rect
  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 || r.height > 0,
  )
  if (rects.length === 0) return null
  const top = Math.min(...rects.map((r) => r.top))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const left = Math.min(...rects.map((r) => r.left))
  const right = Math.max(...rects.map((r) => r.right))
  return new DOMRect(left, top, right - left, bottom - top)
}

function clampRangeToContainer(range: Range, container: HTMLElement): Range {
  const containerRange = document.createRange()
  containerRange.selectNodeContents(container)
  const clamped = range.cloneRange()
  if (clamped.compareBoundaryPoints(Range.END_TO_END, containerRange) > 0) {
    clamped.setEnd(containerRange.endContainer, containerRange.endOffset)
  }
  return clamped
}
